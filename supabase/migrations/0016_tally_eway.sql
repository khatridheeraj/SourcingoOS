-- E-way bills and e-invoice numbers from Tally. Tally makes the e-way bill together
-- with the sales invoice (it is linked to the e-way bill portal), so the reader
-- brings each sales voucher's e-way bill number, date and validity, and its IRN
-- when e-invoicing is on. Dispatch can then take them from here instead of
-- someone typing them in.

alter table public.tally_vouchers
  add column eway_bill_no text,
  add column eway_bill_date date,
  add column eway_valid_until date,
  add column irn text;
create index tally_vouchers_eway_idx on public.tally_vouchers (company_id, eway_bill_no) where eway_bill_no is not null;

-- What Tally holds right now. p: {ledgers: [...], items: [...], vouchers: [...], from, to}.
-- Rows not sent this time are marked gone; vouchers only within from..to.
create or replace function public.tally_bridge_snapshot(p_key text, p jsonb) returns jsonb
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
    insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, reference, narration, bills,
                                       eway_bill_no, eway_bill_date, eway_valid_until, irn, seen_at, gone_at)
    select distinct on (x ->> 'guid') v_company, x ->> 'guid', coalesce(nullif(x ->> 'vtype', ''), 'Voucher'),
           public.tally_kind(x ->> 'vtype'), nullif(btrim(x ->> 'number'), ''), (x ->> 'date')::date, nullif(btrim(x ->> 'party'), ''),
           nullif(x ->> 'amount', '')::numeric, nullif(x ->> 'reference', ''), nullif(x ->> 'narration', ''),
           case when jsonb_typeof(x -> 'bills') = 'array' then x -> 'bills' else '[]'::jsonb end,
           nullif(btrim(x ->> 'eway_bill_no'), ''), nullif(x ->> 'eway_bill_date', '')::date, nullif(x ->> 'eway_valid_until', '')::date,
           nullif(btrim(x ->> 'irn'), ''), v_now, null
    from jsonb_array_elements(p -> 'vouchers') x
    where nullif(x ->> 'guid', '') is not null and nullif(x ->> 'date', '') is not null
    on conflict (company_id, guid) do update set vtype = excluded.vtype, kind = excluded.kind, number = excluded.number,
      vdate = excluded.vdate, party = excluded.party, amount = excluded.amount, reference = excluded.reference,
      narration = excluded.narration, bills = excluded.bills, eway_bill_no = excluded.eway_bill_no,
      eway_bill_date = excluded.eway_bill_date, eway_valid_until = excluded.eway_valid_until, irn = excluded.irn,
      seen_at = excluded.seen_at, gone_at = null;
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
