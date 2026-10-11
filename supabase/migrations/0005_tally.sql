-- Reading TallyPrime into the app. A small program on the office PC where Tally
-- runs reads Tally's ledgers, stock and vouchers and sends them here; nothing is
-- written back into Tally. The app then shows where Tally and the app differ,
-- and Accounts can bring invoices and credit notes that are only in Tally into
-- Payments with one click.
--
-- The program signs in with a sync key the owner makes on the Tally page. Only
-- the key's hash is stored. Its two functions (tally_bridge_*) are the only
-- ones a signed-out caller can run.
-- Nothing is deleted: a ledger or voucher that disappears from Tally is marked gone.

-- ---------------------------------------------------------------- settings
create table public.tally_settings (
  company_id uuid primary key references public.companies (id),
  enabled boolean not null default false,
  tally_company text,                 -- the company's exact name in Tally
  read_from date,                     -- vouchers dated before this aren't read
  key_hash bytea unique,
  key_hint text,
  key_created_at timestamptz,
  agent_seen_at timestamptz,
  agent_info jsonb not null default '{}'::jsonb,
  snapshot_at timestamptz,
  snapshot_counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- What each buyer and factory is called in Tally. Filled in by matching names
-- when Tally is read; Accounts can correct it.
alter table public.buyers add column tally_ledger text;
alter table public.factories add column tally_ledger text;

-- ---------------------------------------------------------------- the Tally mirror
create table public.tally_ledgers (
  company_id uuid not null references public.companies (id),
  name text not null,
  parent text,
  balance numeric(16, 2) not null default 0,   -- positive: they owe us (debit); negative: we owe them
  gstin text,
  seen_at timestamptz not null default now(),
  gone_at timestamptz,
  primary key (company_id, name)
);

create table public.tally_items (
  company_id uuid not null references public.companies (id),
  name text not null,
  parent text,
  unit text,
  qty numeric not null default 0,
  value numeric(16, 2) not null default 0,
  seen_at timestamptz not null default now(),
  gone_at timestamptz,
  primary key (company_id, name)
);

create table public.tally_vouchers (
  company_id uuid not null references public.companies (id),
  guid text not null,
  vtype text not null,               -- the voucher type's name in Tally
  kind text not null,                -- sales, credit_note, receipt, purchase, debit_note, payment or other
  number text,
  vdate date not null,
  party text,
  amount numeric(16, 2),
  reference text,
  narration text,
  bills jsonb not null default '[]'::jsonb,   -- [{name, amount}] bills the party line is set against
  seen_at timestamptz not null default now(),
  gone_at timestamptz,
  primary key (company_id, guid)
);
create index tally_vouchers_number_idx on public.tally_vouchers (company_id, kind, lower(btrim(number)));
create index tally_vouchers_party_idx on public.tally_vouchers (company_id, party, vdate);

-- "M/s Ozia Clothing Pvt. Ltd." and "OZIA CLOTHING" are the same name.
create function public.tally_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(replace(lower(coalesce(p, '')), '&', ' and '),
                          '\m(m/s|messrs|pvt|private|ltd|limited|llp|the|co|company)\M', ' ', 'g'),
           '[^a-z0-9]', '', 'g')
$$;

-- Sales, Credit Note, Receipt... from a voucher type's name. Tally lets types be
-- renamed ("GST Sales", "Sales - Export"), so this goes by the words in it.
create function public.tally_kind(p_vtype text) returns text
language sql immutable set search_path = '' as $$
  select case
    when v ~ 'credit ?note' then 'credit_note'
    when v ~ 'debit ?note' then 'debit_note'
    when v ~ 'order|quotation|delivery|receipt note|rejection|memo' then 'other'
    when v ~ 'sales?\M|sale invoice|tax invoice' then 'sales'
    when v ~ 'purchase' then 'purchase'
    when v ~ 'receipt' then 'receipt'
    when v ~ 'payment' then 'payment'
    else 'other' end
  from (select lower(coalesce(p_vtype, '')) as v) x
$$;

-- ---------------------------------------------------------------- the PC program
create function public.tally_company_for_key(p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid;
begin
  select company_id into v from public.tally_settings
  where p_key is not null and key_hash = sha256(convert_to(p_key, 'UTF8'));
  if v is null then
    raise exception 'The sync key is wrong or was replaced. Make a new key on the Tally page in Sourcingo OS.' using errcode = '28000';
  end if;
  return v;
end $$;

-- Check in: records what the program reports and returns what it should read.
create function public.tally_bridge_hello(p_key text, p_info jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.tally_company_for_key(p_key);
  s public.tally_settings;
begin
  update public.tally_settings set agent_seen_at = now(), agent_info = coalesce(p_info, '{}'::jsonb)
  where company_id = v_company returning * into s;
  return jsonb_build_object('enabled', s.enabled, 'company', s.tally_company, 'read_from', s.read_from,
                            'snapshot_at', s.snapshot_at, 'today', public.india_today());
end $$;

-- What Tally holds right now. p: {ledgers: [...], items: [...], vouchers: [...], from, to}.
-- Rows not sent this time are marked gone; vouchers only within from..to.
create function public.tally_bridge_snapshot(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.tally_company_for_key(p_key);
  v_now timestamptz := clock_timestamp();
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
  v_linked integer := 0;
  v_n integer;
  v_counts jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p -> 'ledgers') = 'array' then
    insert into public.tally_ledgers as t (company_id, name, parent, balance, gstin, seen_at, gone_at)
    select distinct on (btrim(x ->> 'name')) v_company, btrim(x ->> 'name'), nullif(x ->> 'parent', ''),
           coalesce(nullif(x ->> 'balance', '')::numeric, 0), nullif(upper(btrim(x ->> 'gstin')), ''), v_now, null
    from jsonb_array_elements(p -> 'ledgers') x
    where nullif(btrim(x ->> 'name'), '') is not null
    on conflict (company_id, name) do update set parent = excluded.parent, balance = excluded.balance,
      gstin = excluded.gstin, seen_at = excluded.seen_at, gone_at = null;
    update public.tally_ledgers set gone_at = v_now where company_id = v_company and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('ledgers', jsonb_array_length(p -> 'ledgers'));
  end if;

  if jsonb_typeof(p -> 'items') = 'array' then
    insert into public.tally_items (company_id, name, parent, unit, qty, value, seen_at, gone_at)
    select distinct on (btrim(x ->> 'name')) v_company, btrim(x ->> 'name'), nullif(x ->> 'parent', ''), nullif(x ->> 'unit', ''),
           coalesce(nullif(x ->> 'qty', '')::numeric, 0), coalesce(nullif(x ->> 'value', '')::numeric, 0), v_now, null
    from jsonb_array_elements(p -> 'items') x
    where nullif(btrim(x ->> 'name'), '') is not null
    on conflict (company_id, name) do update set parent = excluded.parent, unit = excluded.unit, qty = excluded.qty,
      value = excluded.value, seen_at = excluded.seen_at, gone_at = null;
    update public.tally_items set gone_at = v_now where company_id = v_company and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('items', jsonb_array_length(p -> 'items'));
  end if;

  if jsonb_typeof(p -> 'vouchers') = 'array' and v_from is not null and v_to is not null then
    insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, reference, narration, bills, seen_at, gone_at)
    select distinct on (x ->> 'guid') v_company, x ->> 'guid', coalesce(nullif(x ->> 'vtype', ''), 'Voucher'),
           public.tally_kind(x ->> 'vtype'), nullif(btrim(x ->> 'number'), ''), (x ->> 'date')::date, nullif(btrim(x ->> 'party'), ''),
           nullif(x ->> 'amount', '')::numeric, nullif(x ->> 'reference', ''), nullif(x ->> 'narration', ''),
           case when jsonb_typeof(x -> 'bills') = 'array' then x -> 'bills' else '[]'::jsonb end, v_now, null
    from jsonb_array_elements(p -> 'vouchers') x
    where nullif(x ->> 'guid', '') is not null and nullif(x ->> 'date', '') is not null
    on conflict (company_id, guid) do update set vtype = excluded.vtype, kind = excluded.kind, number = excluded.number,
      vdate = excluded.vdate, party = excluded.party, amount = excluded.amount, reference = excluded.reference,
      narration = excluded.narration, bills = excluded.bills, seen_at = excluded.seen_at, gone_at = null;
    update public.tally_vouchers set gone_at = v_now
    where company_id = v_company and vdate between v_from and v_to and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('vouchers', jsonb_array_length(p -> 'vouchers'), 'from', v_from, 'to', v_to);
  end if;

  -- Link buyers and factories to the ledger with the same name, when exactly one matches.
  update public.buyers b set tally_ledger = m.name
  from (
    select b2.id, min(l.name) as name
    from public.buyers b2
    left join public.buyer_names n on n.buyer_id = b2.id
    join public.tally_ledgers l on l.company_id = b2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
     and public.tally_norm(l.name) in (public.tally_norm(n.real_name), public.tally_norm(b2.code))
    where b2.company_id = v_company and b2.tally_ledger is null
    group by b2.id having count(*) = 1
  ) m
  where b.id = m.id;
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.factories f set tally_ledger = m.name
  from (
    select f2.id, min(l.name) as name
    from public.factories f2
    join public.tally_ledgers l on l.company_id = f2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
     and public.tally_norm(l.name) = public.tally_norm(f2.name)
    where f2.company_id = v_company and f2.tally_ledger is null
    group by f2.id having count(*) = 1
  ) m
  where f.id = m.id;
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.tally_settings set snapshot_at = v_now, agent_seen_at = v_now, snapshot_counts = v_counts
  where company_id = v_company;
  return v_counts || jsonb_build_object('linked', v_linked);
end $$;

-- ---------------------------------------------------------------- owner and Accounts
-- A new sync key, shown once. It replaces the old one, which stops working.
create function public.tally_new_key() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_key text := 'sgo_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_owner(v_company) then raise exception 'Only the owner can make a sync key.'; end if;
  insert into public.tally_settings (company_id, key_hash, key_hint, key_created_at)
  values (v_company, sha256(convert_to(v_key, 'UTF8')), right(v_key, 4), now())
  on conflict (company_id) do update set key_hash = excluded.key_hash, key_hint = excluded.key_hint,
    key_created_at = excluded.key_created_at, updated_at = now();
  return v_key;
end $$;

-- p: {tally_company, read_from, enabled}
create function public.tally_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_owner(v_company) then raise exception 'Only the owner can change the Tally settings.'; end if;
  if coalesce((p ->> 'enabled')::boolean, false) and nullif(btrim(p ->> 'tally_company'), '') is null then
    raise exception 'Enter the company''s name exactly as Tally shows it before switching reading on.';
  end if;
  insert into public.tally_settings (company_id, tally_company, read_from, enabled)
  values (v_company, nullif(btrim(p ->> 'tally_company'), ''), nullif(p ->> 'read_from', '')::date, coalesce((p ->> 'enabled')::boolean, false))
  on conflict (company_id) do update set tally_company = excluded.tally_company, read_from = excluded.read_from,
    enabled = excluded.enabled, updated_at = now();
end $$;

-- Say which Tally ledger a buyer or factory is. An empty name unlinks it.
create function public.tally_set_ledger(p_kind text, p_id uuid, p_ledger text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_name text := nullif(btrim(p_ledger), '');
  v_n integer;
begin
  if not public.is_finance(v_company) then raise exception 'Only Accounts and the owner can link Tally ledgers.'; end if;
  if p_kind = 'buyer' then
    update public.buyers set tally_ledger = v_name where id = p_id and company_id = v_company;
  elsif p_kind = 'factory' then
    update public.factories set tally_ledger = v_name where id = p_id and company_id = v_company;
  else
    raise exception 'Choose a buyer or a factory.';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That % no longer exists.', p_kind; end if;
end $$;

-- Bring invoices and credit notes that are only in Tally into Payments.
-- Runs with the caller's own rights, so the Payments rules all still apply.
-- Returns {invoices, credit_notes, skipped: [reason, ...]}.
create function public.tally_import(p_guids text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v record;
  v_buyer uuid;
  v_inv uuid;
  v_ref text;
  v_inv_n integer := 0;
  v_cn_n integer := 0;
  v_skipped text[] := '{}';
begin
  if not public.is_finance(v_company) then raise exception 'Only Accounts and the owner can bring in entries from Tally.'; end if;
  -- Invoices first, so credit notes against them can come in the same go.
  for v in
    select * from public.tally_vouchers
    where company_id = v_company and guid = any (p_guids) and gone_at is null and kind in ('sales', 'credit_note')
    order by kind = 'credit_note', vdate, number
  loop
    if v.number is null then
      v_skipped := v_skipped || format('A %s dated %s has no number in Tally.', v.vtype, v.vdate);
      continue;
    end if;
    select id into v_buyer from public.buyers where company_id = v_company and tally_ledger = v.party;
    if v_buyer is null then
      v_skipped := v_skipped || format('%s: "%s" isn''t linked to a buyer yet.', v.number, coalesce(v.party, 'no party'));
      continue;
    end if;
    if v.kind = 'sales' then
      if exists (select 1 from public.invoices where company_id = v_company and lower(btrim(invoice_no)) = lower(v.number)) then
        v_skipped := v_skipped || format('Invoice %s is already in Payments.', v.number);
        continue;
      end if;
      insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, notes)
      values (v_company, v.number, v_buyer, v.vdate, coalesce(abs(v.amount), 0), 'Brought in from Tally');
      v_inv_n := v_inv_n + 1;
    else
      if exists (select 1 from public.credit_notes where company_id = v_company and lower(btrim(credit_note_no)) = lower(v.number)) then
        v_skipped := v_skipped || format('Credit note %s is already in Payments.', v.number);
        continue;
      end if;
      -- The invoice it is set against in Tally, or the one named in its reference.
      v_inv := null;
      foreach v_ref in array array(select b ->> 'name' from jsonb_array_elements(v.bills) b union all select v.reference) loop
        select id into v_inv from public.invoices
        where company_id = v_company and buyer_id = v_buyer and cancelled_at is null and lower(btrim(invoice_no)) = lower(btrim(v_ref));
        exit when v_inv is not null;
      end loop;
      if v_inv is null then
        v_skipped := v_skipped || format('Credit note %s: Tally doesn''t say which invoice it is against. Add it in Payments by hand.', v.number);
        continue;
      end if;
      insert into public.credit_notes (company_id, credit_note_no, invoice_id, note_date, amount, notes)
      values (v_company, v.number, v_inv, v.vdate, abs(v.amount), 'Brought in from Tally');
      v_cn_n := v_cn_n + 1;
    end if;
  end loop;
  return jsonb_build_object('invoices', v_inv_n, 'credit_notes', v_cn_n, 'skipped', to_jsonb(v_skipped));
end $$;

-- ---------------------------------------------------------------- access
alter table public.tally_settings enable row level security;
alter table public.tally_ledgers enable row level security;
alter table public.tally_items enable row level security;
alter table public.tally_vouchers enable row level security;

revoke all on public.tally_settings, public.tally_ledgers, public.tally_items, public.tally_vouchers from anon, authenticated;
-- The key's hash stays out of reach.
grant select (company_id, enabled, tally_company, read_from, key_hint, key_created_at, agent_seen_at, agent_info,
              snapshot_at, snapshot_counts, updated_at) on public.tally_settings to authenticated;
grant select on public.tally_ledgers, public.tally_items, public.tally_vouchers to authenticated;

create policy tally_settings_read on public.tally_settings for select to authenticated using (public.is_finance(company_id));
create policy tally_ledgers_read on public.tally_ledgers for select to authenticated using (public.is_finance(company_id));
create policy tally_items_read on public.tally_items for select to authenticated using (public.is_finance(company_id));
create policy tally_vouchers_read on public.tally_vouchers for select to authenticated using (public.is_finance(company_id));

revoke execute on function public.tally_norm(text), public.tally_kind(text), public.tally_company_for_key(text),
  public.tally_bridge_hello(text, jsonb), public.tally_bridge_snapshot(text, jsonb), public.tally_new_key(),
  public.tally_save_settings(jsonb), public.tally_set_ledger(text, uuid, text), public.tally_import(text[]) from public, anon, authenticated;
grant execute on function public.tally_bridge_hello(text, jsonb), public.tally_bridge_snapshot(text, jsonb) to anon, authenticated;
grant execute on function public.tally_new_key(), public.tally_save_settings(jsonb), public.tally_set_ledger(text, uuid, text),
  public.tally_import(text[]) to authenticated;
