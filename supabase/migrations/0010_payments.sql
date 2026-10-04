-- Payments: buyer invoices, credit notes and the cheques (usually post-dated)
-- that pay them. Only the owner and Accounts can see or change any of it.
--
-- An invoice's net amount is its amount less its credit notes. A cheque is
-- split across one or more invoices of the same buyer (cheque_allocations).
-- Cheques move in_hand → deposited → cleared, or end bounced / cancelled; a
-- bounced or cancelled cheque stops covering its invoices.
-- Dispatching a delivery challan opens its invoice here automatically.
-- tally_guid holds the matching TallyPrime voucher's GUID once synced.

create type cheque_status as enum ('in_hand','deposited','cleared','bounced','cancelled');

create function is_finance() returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce(my_role() in ('owner','accounts'), false) $$;

-- Days from invoice to due date, used when an invoice has no due date of its own.
alter table buyers add column credit_days int check (credit_days is null or credit_days between 0 and 365);

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique check (btrim(invoice_no) <> ''),
  buyer_id      uuid not null references buyers(id),
  invoice_date  date not null,
  amount        numeric(14,2) check (amount is null or amount >= 0),   -- with tax; empty until Accounts enters it
  due_date      date,
  so_id         text references sales_orders(id),
  dc_id         text unique references delivery_challans(id),
  notes         text,
  tally_guid    text unique,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint due_after_invoice check (due_date is null or due_date >= invoice_date)
);
create index invoices_buyer_idx on invoices (buyer_id);

create table credit_notes (
  id              uuid primary key default gen_random_uuid(),
  credit_note_no  text not null unique check (btrim(credit_note_no) <> ''),
  invoice_id      uuid not null references invoices(id),
  note_date       date not null,
  amount          numeric(14,2) not null check (amount > 0),
  notes           text,
  tally_guid      text unique,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);
create index credit_notes_invoice_idx on credit_notes (invoice_id);

create table cheques (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references buyers(id),
  cheque_no     text not null check (btrim(cheque_no) <> ''),
  bank          text,
  cheque_date   date not null,
  amount        numeric(14,2) not null check (amount > 0),
  status        cheque_status not null default 'in_hand',
  received_on   date,
  deposited_on  date,
  cleared_on    date,
  bounced_on    date,
  notes         text,
  tally_guid    text unique,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cheque_no_per_buyer unique (buyer_id, cheque_no)
);

create table cheque_allocations (
  id          uuid primary key default gen_random_uuid(),
  cheque_id   uuid not null references cheques(id) on delete cascade,
  invoice_id  uuid not null references invoices(id),
  amount      numeric(14,2) not null check (amount > 0),
  unique (cheque_id, invoice_id)
);
create index cheque_allocations_invoice_idx on cheque_allocations (invoice_id);

create trigger touch_invoices before update on invoices for each row execute function touch_updated_at();
create trigger touch_cheques  before update on cheques  for each row execute function touch_updated_at();
create trigger audit_invoices           after insert or update or delete on invoices           for each row execute function write_audit();
create trigger audit_credit_notes       after insert or update or delete on credit_notes       for each row execute function write_audit();
create trigger audit_cheques            after insert or update or delete on cheques            for each row execute function write_audit();
create trigger audit_cheque_allocations after insert or update or delete on cheque_allocations for each row execute function write_audit();

-- ───────────────────────── sums ─────────────────────────
-- Paise of slack, so a cheque rounded to the rupee still settles its invoice.
create function invoice_net(p_invoice uuid) returns numeric
  language sql stable set search_path = public as $$
  select i.amount - coalesce((select sum(c.amount) from credit_notes c where c.invoice_id = i.id), 0)
    from invoices i where i.id = p_invoice
$$;

create function invoice_covered(p_invoice uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(a.amount), 0) from cheque_allocations a join cheques c on c.id = a.cheque_id
   where a.invoice_id = p_invoice and c.status in ('in_hand','deposited','cleared')
$$;

create function check_invoice_cover(p_invoice uuid) returns void
  language plpgsql stable set search_path = public as $$
declare v_no text; v_net numeric := invoice_net(p_invoice); v_cov numeric := invoice_covered(p_invoice);
begin
  select invoice_no into v_no from invoices where id = p_invoice;
  if v_net < 0 then raise exception 'Credit notes on % come to more than the invoice amount.', v_no; end if;
  if v_cov > 0 and v_net is null then raise exception 'Cheques already cover %, so it needs an amount.', v_no; end if;
  if v_cov > v_net + 1 then
    raise exception 'Cheques cover ₹% of %, but its amount after credit notes is ₹%.', v_cov, v_no, v_net;
  end if;
end $$;

-- ───────────────────────── rules ─────────────────────────
create function guard_invoice() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.buyer_id is distinct from old.buyer_id and exists (
       select 1 from cheque_allocations where invoice_id = old.id union all select 1 from credit_notes where invoice_id = old.id) then
    raise exception '% has cheques or credit notes, so its buyer can''t change.', old.invoice_no;
  end if;
  if new.so_id is not null and new.so_id is distinct from old.so_id
     and not exists (select 1 from sales_orders where id = new.so_id and buyer_id = new.buyer_id) then
    raise exception 'Sales order % belongs to another buyer.', new.so_id;
  end if;
  return new;
end $$;
create trigger guard_invoice before update on invoices for each row execute function guard_invoice();

create function recheck_invoice_cover() returns trigger
  language plpgsql set search_path = public as $$
begin
  perform check_invoice_cover(new.id);
  return null;
end $$;
create constraint trigger recheck_invoice_cover after update of amount on invoices
  deferrable initially immediate for each row execute function recheck_invoice_cover();

create function guard_new_invoice() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.so_id is not null and not exists (select 1 from sales_orders where id = new.so_id and buyer_id = new.buyer_id) then
    raise exception 'Sales order % belongs to another buyer.', new.so_id;
  end if;
  return new;
end $$;
create trigger guard_new_invoice before insert on invoices for each row execute function guard_new_invoice();

create function guard_credit_note() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform check_invoice_cover(old.invoice_id);
  else
    if not exists (select 1 from invoices where id = new.invoice_id and amount is not null) then
      raise exception 'Enter the invoice amount before adding a credit note.';
    end if;
    perform check_invoice_cover(new.invoice_id);
    if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then perform check_invoice_cover(old.invoice_id); end if;
  end if;
  return null;
end $$;
create constraint trigger guard_credit_note after insert or update or delete on credit_notes
  deferrable initially immediate for each row execute function guard_credit_note();

-- A cheque pays invoices of its own buyer, never more than its amount, and
-- never more than what is left on each invoice.
create function guard_allocation() returns trigger
  language plpgsql set search_path = public as $$
declare c cheques; i invoices; v_total numeric;
begin
  select * into c from cheques where id = new.cheque_id;
  select * into i from invoices where id = new.invoice_id;
  if c.buyer_id <> i.buyer_id then raise exception 'Cheque % and invoice % are for different buyers.', c.cheque_no, i.invoice_no; end if;
  if c.status in ('bounced','cancelled') then raise exception 'Cheque % is %. Record a new cheque instead.', c.cheque_no, c.status; end if;
  if i.amount is null then raise exception 'Enter the amount of invoice % first.', i.invoice_no; end if;
  select sum(amount) into v_total from cheque_allocations where cheque_id = new.cheque_id;
  if v_total > c.amount then
    raise exception 'Cheque % is for ₹%, but ₹% is split across invoices.', c.cheque_no, c.amount, v_total;
  end if;
  perform check_invoice_cover(new.invoice_id);
  return null;
end $$;
create constraint trigger guard_allocation after insert or update on cheque_allocations
  deferrable initially immediate for each row execute function guard_allocation();

-- Status moves one step at a time (the owner may correct anything), the date
-- of each step is kept, and a cheque's details are fixed once it is deposited.
create function guard_cheque() returns trigger
  language plpgsql set search_path = public as $$
declare v_ok boolean;
begin
  if old.status <> 'in_hand' and (new.buyer_id, new.cheque_no, new.cheque_date, new.amount)
                                  is distinct from (old.buyer_id, old.cheque_no, old.cheque_date, old.amount) then
    raise exception 'Cheque % has been deposited. Its number, date and amount can''t change.', old.cheque_no;
  end if;
  if new.buyer_id <> old.buyer_id and exists (select 1 from cheque_allocations where cheque_id = old.id) then
    raise exception 'Cheque % is set against invoices, so its buyer can''t change.', old.cheque_no;
  end if;
  if new.amount < (select coalesce(sum(amount), 0) from cheque_allocations where cheque_id = old.id) then
    raise exception 'Cheque % is split across invoices for more than ₹%.', old.cheque_no, new.amount;
  end if;
  if new.status is distinct from old.status then
    v_ok := (old.status, new.status) in (('in_hand','deposited'), ('in_hand','cleared'), ('in_hand','cancelled'),
                                         ('deposited','cleared'), ('deposited','bounced'), ('deposited','in_hand'));
    if not v_ok and not is_owner() then
      raise exception 'A % cheque can''t be marked %. Ask the owner to correct it.', replace(old.status::text, '_', ' '), replace(new.status::text, '_', ' ');
    end if;
    if new.status = 'in_hand' then new.deposited_on := null; new.cleared_on := null; new.bounced_on := null; end if;
    if new.status = 'deposited' then new.deposited_on := coalesce(new.deposited_on, current_date); new.cleared_on := null; new.bounced_on := null; end if;
    if new.status = 'cleared' then
      new.deposited_on := coalesce(new.deposited_on, new.cleared_on, current_date);
      new.cleared_on := coalesce(new.cleared_on, current_date); new.bounced_on := null;
    end if;
    if new.status = 'bounced' then new.bounced_on := coalesce(new.bounced_on, current_date); new.cleared_on := null; end if;
    if new.status in ('deposited','cleared') and new.deposited_on < new.cheque_date then
      raise exception 'Cheque % is dated %, so it can''t be deposited before then.', new.cheque_no, to_char(new.cheque_date, 'DD Mon YYYY');
    end if;
  end if;
  return new;
end $$;
create trigger guard_cheque before update on cheques for each row execute function guard_cheque();

-- Reviving a bounced or cancelled cheque must still fit its invoices.
create function recheck_cheque_cover() returns trigger
  language plpgsql set search_path = public as $$
declare v uuid;
begin
  if old.status in ('bounced','cancelled') and new.status not in ('bounced','cancelled') then
    for v in select invoice_id from cheque_allocations where cheque_id = new.id loop perform check_invoice_cover(v); end loop;
  end if;
  return null;
end $$;
create trigger recheck_cheque_cover after update of status on cheques for each row execute function recheck_cheque_cover();

-- ───────────────────────── dispatch opens the invoice ─────────────────────────
create function invoice_from_dc() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_buyer uuid;
begin
  if new.status <> 'dispatched' or old.status = 'dispatched' or new.invoice_no is null then return new; end if;
  select buyer_id into v_buyer from sales_orders where id = new.so_id;
  insert into invoices (invoice_no, buyer_id, invoice_date, so_id, dc_id, created_by)
    values (btrim(new.invoice_no), v_buyer, new.invoice_date, new.so_id, new.id, auth.uid())
    on conflict (invoice_no) do nothing;
  -- Accounts may have entered it before dispatch: link it if it's the same buyer.
  update invoices set dc_id = new.id, so_id = coalesce(so_id, new.so_id)
   where invoice_no = btrim(new.invoice_no) and buyer_id = v_buyer and dc_id is null;
  return new;
end $$;
create trigger invoice_from_dc after update of status on delivery_challans for each row execute function invoice_from_dc();

-- ───────────────────────── saves ─────────────────────────
-- p: {id?, invoice_no, buyer_id, invoice_date, amount, due_date, so_id, notes}
create function save_invoice(p jsonb) returns uuid
  language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_no text := btrim(coalesce(p->>'invoice_no', ''));
        v_amount numeric := nullif(p->>'amount', '')::numeric;
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change invoices.'; end if;
  if v_no = '' then raise exception 'Enter the invoice number.'; end if;
  if nullif(p->>'buyer_id', '') is null then raise exception 'Choose the buyer.'; end if;
  if nullif(p->>'invoice_date', '') is null then raise exception 'Set the invoice date.'; end if;
  if v_amount < 0 then raise exception 'The amount can''t be negative.'; end if;
  if nullif(p->>'due_date', '')::date < (p->>'invoice_date')::date then raise exception 'The due date can''t be before the invoice date.'; end if;
  if exists (select 1 from invoices where lower(invoice_no) = lower(v_no) and id is distinct from v_id) then
    raise exception 'Invoice % already exists.', v_no;
  end if;
  if v_id is null then
    insert into invoices (invoice_no, buyer_id, invoice_date, amount, due_date, so_id, notes)
      values (v_no, (p->>'buyer_id')::uuid, (p->>'invoice_date')::date, v_amount, nullif(p->>'due_date', '')::date,
              nullif(p->>'so_id', ''), nullif(btrim(p->>'notes'), ''))
      returning id into v_id;
  else
    update invoices set invoice_no = v_no, buyer_id = (p->>'buyer_id')::uuid, invoice_date = (p->>'invoice_date')::date,
           amount = v_amount, due_date = nullif(p->>'due_date', '')::date, so_id = nullif(p->>'so_id', ''),
           notes = nullif(btrim(p->>'notes'), '')
     where id = v_id;
    if not found then raise exception 'Invoice not found.'; end if;
  end if;
  return v_id;
end $$;

create function delete_invoice(p_id uuid) returns void
  language plpgsql set search_path = public as $$
declare i invoices;
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change invoices.'; end if;
  select * into i from invoices where id = p_id;
  if not found then raise exception 'Invoice not found.'; end if;
  if i.dc_id is not null then raise exception '% came from %, so it can''t be deleted.', i.invoice_no, i.dc_id; end if;
  if exists (select 1 from cheque_allocations where invoice_id = p_id) then
    raise exception 'Cheques are set against %. Remove them from the cheques first.', i.invoice_no;
  end if;
  if exists (select 1 from credit_notes where invoice_id = p_id) then raise exception 'Delete the credit notes on % first.', i.invoice_no; end if;
  delete from invoices where id = p_id;
end $$;

-- p: {id?, credit_note_no, invoice_id, note_date, amount, notes}
create function save_credit_note(p jsonb) returns uuid
  language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_no text := btrim(coalesce(p->>'credit_note_no', ''));
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change credit notes.'; end if;
  if v_no = '' then raise exception 'Enter the credit note number.'; end if;
  if nullif(p->>'note_date', '') is null then raise exception 'Set the credit note date.'; end if;
  if coalesce(nullif(p->>'amount', '')::numeric, 0) <= 0 then raise exception 'The credit note amount must be more than 0.'; end if;
  if exists (select 1 from credit_notes where lower(credit_note_no) = lower(v_no) and id is distinct from v_id) then
    raise exception 'Credit note % already exists.', v_no;
  end if;
  if v_id is null then
    insert into credit_notes (credit_note_no, invoice_id, note_date, amount, notes)
      values (v_no, (p->>'invoice_id')::uuid, (p->>'note_date')::date, (p->>'amount')::numeric, nullif(btrim(p->>'notes'), ''))
      returning id into v_id;
  else
    update credit_notes set credit_note_no = v_no, note_date = (p->>'note_date')::date, amount = (p->>'amount')::numeric,
           notes = nullif(btrim(p->>'notes'), '')
     where id = v_id;
  end if;
  return v_id;
end $$;

create function delete_credit_note(p_id uuid) returns void
  language plpgsql set search_path = public as $$
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change credit notes.'; end if;
  delete from credit_notes where id = p_id;
end $$;

-- p: {id?, buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes,
--     allocations: [{invoice_id, amount}]}
create function save_cheque(p jsonb) returns uuid
  language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_no text := btrim(coalesce(p->>'cheque_no', '')); a jsonb;
        v_amount numeric := nullif(p->>'amount', '')::numeric; v_buyer uuid := nullif(p->>'buyer_id', '')::uuid;
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can record cheques.'; end if;
  if v_buyer is null then raise exception 'Choose the buyer the cheque is from.'; end if;
  if v_no = '' then raise exception 'Enter the cheque number.'; end if;
  if nullif(p->>'cheque_date', '') is null then raise exception 'Set the date written on the cheque.'; end if;
  if coalesce(v_amount, 0) <= 0 then raise exception 'The cheque amount must be more than 0.'; end if;
  if exists (select 1 from cheques where buyer_id = v_buyer and cheque_no = v_no and id is distinct from v_id) then
    raise exception 'Cheque % from this buyer is already recorded.', v_no;
  end if;
  if v_id is null then
    insert into cheques (buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes)
      values (v_buyer, v_no, nullif(btrim(p->>'bank'), ''), (p->>'cheque_date')::date, v_amount,
              coalesce(nullif(p->>'received_on', '')::date, current_date), nullif(btrim(p->>'notes'), ''))
      returning id into v_id;
  else
    delete from cheque_allocations where cheque_id = v_id;
    update cheques set buyer_id = v_buyer, cheque_no = v_no, bank = nullif(btrim(p->>'bank'), ''),
           cheque_date = (p->>'cheque_date')::date, amount = v_amount, received_on = nullif(p->>'received_on', '')::date,
           notes = nullif(btrim(p->>'notes'), '')
     where id = v_id;
    if not found then raise exception 'Cheque not found.'; end if;
  end if;
  for a in select * from jsonb_array_elements(coalesce(p->'allocations', '[]')) loop
    continue when coalesce(nullif(a->>'amount', '')::numeric, 0) = 0;
    if (a->>'amount')::numeric < 0 then raise exception 'Amounts against invoices can''t be negative.'; end if;
    insert into cheque_allocations (cheque_id, invoice_id, amount) values (v_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric);
  end loop;
  return v_id;
end $$;

create function delete_cheque(p_id uuid) returns void
  language plpgsql set search_path = public as $$
declare c cheques;
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change cheques.'; end if;
  select * into c from cheques where id = p_id;
  if not found then raise exception 'Cheque not found.'; end if;
  if c.status <> 'in_hand' and not is_owner() then
    raise exception 'Cheque % has been %. Mark it cancelled or bounced instead.', c.cheque_no, c.status;
  end if;
  delete from cheques where id = p_id;
end $$;

-- Several cheques at once (e.g. "these all cleared"). Returns how many changed.
create function set_cheque_status(p_ids uuid[], p_status cheque_status, p_on date default null, p_note text default null)
  returns int
  language plpgsql set search_path = public as $$
declare v_n int; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can change cheques.'; end if;
  if p_on > current_date then raise exception 'That date is in the future.'; end if;
  update cheques set status = p_status,
         deposited_on = case when p_status = 'deposited' then coalesce(p_on, current_date) else deposited_on end,
         cleared_on   = case when p_status = 'cleared'   then coalesce(p_on, current_date) else cleared_on end,
         bounced_on   = case when p_status = 'bounced'   then coalesce(p_on, current_date) else bounced_on end,
         notes = case when v_note is null then notes else concat_ws(E'\n', notes, v_note) end
   where id = any(p_ids) and status <> p_status;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function set_buyer_credit_days(p_buyer uuid, p_days int) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_finance() then raise exception 'Only Accounts and the owner can set credit days.'; end if;
  if p_days is not null and (p_days < 0 or p_days > 365) then raise exception 'Credit days must be between 0 and 365.'; end if;
  update buyers set credit_days = p_days where id = p_buyer;
end $$;

-- ───────────────────────── access ─────────────────────────
alter table invoices           enable row level security;
alter table credit_notes       enable row level security;
alter table cheques            enable row level security;
alter table cheque_allocations enable row level security;
create policy "finance invoices"           on invoices           for all using ((select is_finance())) with check ((select is_finance()));
create policy "finance credit notes"       on credit_notes       for all using ((select is_finance())) with check ((select is_finance()));
create policy "finance cheques"            on cheques            for all using ((select is_finance())) with check ((select is_finance()));
create policy "finance cheque allocations" on cheque_allocations for all using ((select is_finance())) with check ((select is_finance()));

revoke all on invoices, credit_notes, cheques, cheque_allocations from anon;
grant select, insert, update, delete on invoices, credit_notes, cheques, cheque_allocations to authenticated;
grant execute on function is_finance(), save_invoice(jsonb), delete_invoice(uuid), save_credit_note(jsonb), delete_credit_note(uuid),
  save_cheque(jsonb), delete_cheque(uuid), set_cheque_status(uuid[], cheque_status, date, text), set_buyer_credit_days(uuid, int)
  to authenticated;
