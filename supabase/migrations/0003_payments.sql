-- Payments: buyer invoices, credit notes and the cheques (usually post-dated)
-- that pay them. Only the owner and Accounts can see or change any of it.
--
-- An invoice's net amount is its amount less its credit notes. A cheque is
-- split across one or more invoices of the same buyer (cheque_allocations).
-- Cheques move in hand → deposited → cleared, or end bounced / cancelled; a
-- bounced or cancelled cheque stops paying its invoices.
-- Nothing is deleted: a wrong invoice or credit note is cancelled, a wrong
-- cheque is marked cancelled, and a cheque taken off an invoice is marked removed.

-- Days from invoice to due date, used when an invoice has no due date of its own.
alter table public.buyers add column credit_days integer check (credit_days between 0 and 365);

create function public.is_finance(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role(p_company) in ('owner', 'accounts'), false) $$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  invoice_no text not null check (btrim(invoice_no) <> ''),
  buyer_id uuid not null,
  invoice_date date not null,
  amount numeric(14, 2) not null check (amount >= 0),
  due_date date,
  order_id uuid,
  notes text,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= invoice_date),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create unique index invoices_no_key on public.invoices (company_id, lower(btrim(invoice_no)));
create unique index invoices_company_id_key on public.invoices (company_id, id);
create index invoices_buyer_idx on public.invoices (company_id, buyer_id);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  credit_note_no text not null check (btrim(credit_note_no) <> ''),
  invoice_id uuid not null,
  note_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  notes text,
  cancelled_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (company_id, invoice_id) references public.invoices (company_id, id)
);
create unique index credit_notes_no_key on public.credit_notes (company_id, lower(btrim(credit_note_no)));
create index credit_notes_invoice_idx on public.credit_notes (invoice_id);

create table public.cheques (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  buyer_id uuid not null,
  cheque_no text not null check (btrim(cheque_no) <> ''),
  bank text,
  cheque_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'in_hand' check (status in ('in_hand', 'deposited', 'cleared', 'bounced', 'cancelled')),
  received_on date,
  deposited_on date,
  cleared_on date,
  bounced_on date,
  notes text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
create unique index cheques_no_key on public.cheques (company_id, buyer_id, lower(btrim(cheque_no)));
create unique index cheques_company_id_key on public.cheques (company_id, id);

create table public.cheque_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  cheque_id uuid not null,
  invoice_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (company_id, cheque_id) references public.cheques (company_id, id),
  foreign key (company_id, invoice_id) references public.invoices (company_id, id)
);
create unique index cheque_allocations_key on public.cheque_allocations (cheque_id, invoice_id) where removed_at is null;
create index cheque_allocations_invoice_idx on public.cheque_allocations (invoice_id);

create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();
create trigger cheques_touch before update on public.cheques for each row execute function public.touch_updated_at();
create trigger invoices_history after insert or update or delete on public.invoices for each row execute function public.record_history();
create trigger credit_notes_history after insert or update or delete on public.credit_notes for each row execute function public.record_history();
create trigger cheques_history after insert or update or delete on public.cheques for each row execute function public.record_history();
create trigger cheque_allocations_history after insert or update or delete on public.cheque_allocations for each row execute function public.record_history();

-- ---------------------------------------------------------------- sums
-- What a buyer owes on an invoice after its credit notes.
create function public.invoice_net(p_invoice uuid) returns numeric
language sql stable set search_path = '' as $$
  select i.amount - coalesce((select sum(c.amount) from public.credit_notes c where c.invoice_id = i.id and c.cancelled_at is null), 0)
  from public.invoices i where i.id = p_invoice
$$;

-- How much of an invoice live cheques pay (in hand, deposited or cleared).
create function public.invoice_covered(p_invoice uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(a.amount), 0) from public.cheque_allocations a join public.cheques c on c.id = a.cheque_id
  where a.invoice_id = p_invoice and a.removed_at is null and c.status in ('in_hand', 'deposited', 'cleared')
$$;

-- One rupee of slack, so a cheque rounded to the rupee still settles its invoice.
create function public.check_invoice_cover(p_invoice uuid) returns void
language plpgsql stable set search_path = '' as $$
declare
  i public.invoices;
  v_net numeric := public.invoice_net(p_invoice);
  v_cov numeric := public.invoice_covered(p_invoice);
begin
  select * into i from public.invoices where id = p_invoice;
  if v_net < 0 then
    raise exception 'Credit notes on % come to more than the invoice amount.', i.invoice_no;
  end if;
  if i.cancelled_at is not null and v_cov > 0 then
    raise exception 'Cheques are set against %. Take it off those cheques before cancelling it.', i.invoice_no;
  end if;
  if v_cov > v_net + 1 then
    raise exception 'Cheques pay ₹% of %, but its amount after credit notes is ₹%.', v_cov, i.invoice_no, v_net;
  end if;
end $$;

-- ---------------------------------------------------------------- rules
create function public.guard_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.buyer_id is distinct from old.buyer_id and (
       exists (select 1 from public.cheque_allocations where invoice_id = old.id and removed_at is null)
       or exists (select 1 from public.credit_notes where invoice_id = old.id and cancelled_at is null)) then
    raise exception '% has cheques or credit notes, so its buyer can''t change.', old.invoice_no;
  end if;
  if new.order_id is not null and not exists (
       select 1 from public.orders where id = new.order_id and buyer_id = new.buyer_id) then
    raise exception 'That order belongs to another buyer.';
  end if;
  return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices for each row execute function public.guard_invoice();

create function public.recheck_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform public.check_invoice_cover(new.id);
  return null;
end $$;
create constraint trigger invoices_recheck after update on public.invoices
  deferrable initially immediate for each row execute function public.recheck_invoice();

create function public.guard_credit_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.invoices where id = new.invoice_id and cancelled_at is not null) and new.cancelled_at is null then
    raise exception 'That invoice is cancelled.';
  end if;
  perform public.check_invoice_cover(new.invoice_id);
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    perform public.check_invoice_cover(old.invoice_id);
  end if;
  return null;
end $$;
create constraint trigger credit_notes_guard after insert or update on public.credit_notes
  deferrable initially immediate for each row execute function public.guard_credit_note();

-- A cheque pays invoices of its own buyer, never more than its amount, and
-- never more than what is left on each invoice.
create function public.guard_allocation() returns trigger
language plpgsql set search_path = '' as $$
declare
  c public.cheques;
  i public.invoices;
  v_total numeric;
begin
  select * into c from public.cheques where id = new.cheque_id;
  select * into i from public.invoices where id = new.invoice_id;
  if new.removed_at is null then
    if c.buyer_id <> i.buyer_id then
      raise exception 'Cheque % and invoice % are for different buyers.', c.cheque_no, i.invoice_no;
    end if;
    if i.cancelled_at is not null then
      raise exception 'Invoice % is cancelled.', i.invoice_no;
    end if;
    if c.status in ('bounced', 'cancelled') then
      raise exception 'Cheque % is %. Record a new cheque instead.', c.cheque_no, c.status;
    end if;
  end if;
  select coalesce(sum(amount), 0) into v_total from public.cheque_allocations where cheque_id = new.cheque_id and removed_at is null;
  if v_total > c.amount then
    raise exception 'Cheque % is for ₹%, but ₹% is set against invoices.', c.cheque_no, c.amount, v_total;
  end if;
  perform public.check_invoice_cover(new.invoice_id);
  return null;
end $$;
create constraint trigger cheque_allocations_guard after insert or update on public.cheque_allocations
  deferrable initially immediate for each row execute function public.guard_allocation();

-- Status moves one step at a time (the owner may correct anything), the date
-- of each step is kept, and a cheque's details are fixed once it is deposited.
create function public.guard_cheque() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'in_hand' and (new.buyer_id, new.cheque_no, new.cheque_date, new.amount)
                                 is distinct from (old.buyer_id, old.cheque_no, old.cheque_date, old.amount)
     and not public.is_owner(old.company_id) then
    raise exception 'Cheque % has been deposited. Its number, date and amount can''t change.', old.cheque_no;
  end if;
  if new.buyer_id <> old.buyer_id and exists (select 1 from public.cheque_allocations where cheque_id = old.id and removed_at is null) then
    raise exception 'Cheque % is set against invoices, so its buyer can''t change.', old.cheque_no;
  end if;
  if new.status is distinct from old.status then
    if (old.status, new.status) not in (('in_hand', 'deposited'), ('in_hand', 'cleared'), ('in_hand', 'cancelled'),
                                         ('deposited', 'cleared'), ('deposited', 'bounced'), ('deposited', 'in_hand'))
       and not public.is_owner(old.company_id) then
      raise exception 'A % cheque can''t be marked %. Ask the owner to correct it.',
        replace(old.status, '_', ' '), replace(new.status, '_', ' ');
    end if;
    if new.status = 'in_hand' then
      new.deposited_on := null; new.cleared_on := null; new.bounced_on := null;
    elsif new.status = 'deposited' then
      new.deposited_on := coalesce(new.deposited_on, current_date); new.cleared_on := null; new.bounced_on := null;
    elsif new.status = 'cleared' then
      new.cleared_on := coalesce(new.cleared_on, current_date);
      new.deposited_on := coalesce(new.deposited_on, new.cleared_on); new.bounced_on := null;
    elsif new.status = 'bounced' then
      new.bounced_on := coalesce(new.bounced_on, current_date); new.cleared_on := null;
    end if;
    if new.status in ('deposited', 'cleared') and new.deposited_on < new.cheque_date then
      raise exception 'Cheque % is dated %, so it can''t be deposited before then.', new.cheque_no, to_char(new.cheque_date, 'DD Mon YYYY');
    end if;
  end if;
  return new;
end $$;
create trigger cheques_guard before update on public.cheques for each row execute function public.guard_cheque();

-- Bringing back a bounced or cancelled cheque, or lowering its amount, must still fit its invoices.
create function public.recheck_cheque() returns trigger
language plpgsql set search_path = '' as $$
declare
  v uuid;
begin
  if (select coalesce(sum(amount), 0) from public.cheque_allocations where cheque_id = new.id and removed_at is null) > new.amount then
    raise exception 'Cheque % is set against invoices for more than ₹%.', new.cheque_no, new.amount;
  end if;
  for v in select invoice_id from public.cheque_allocations where cheque_id = new.id and removed_at is null loop
    perform public.check_invoice_cover(v);
  end loop;
  return null;
end $$;
create constraint trigger cheques_recheck after update on public.cheques
  deferrable initially immediate for each row execute function public.recheck_cheque();

-- ---------------------------------------------------------------- saves
-- p: {id?, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes, cancelled}
create function public.save_invoice(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_no text := btrim(coalesce(p ->> 'invoice_no', ''));
  v_amount numeric := nullif(p ->> 'amount', '')::numeric;
  v_n integer;
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change invoices.';
  end if;
  if v_no = '' then raise exception 'Enter the invoice number.'; end if;
  if nullif(p ->> 'buyer_id', '') is null then raise exception 'Choose the buyer.'; end if;
  if nullif(p ->> 'invoice_date', '') is null then raise exception 'Set the invoice date.'; end if;
  if v_amount is null then raise exception 'Enter the invoice amount.'; end if;
  if v_amount < 0 then raise exception 'The amount can''t be negative.'; end if;
  if nullif(p ->> 'due_date', '')::date < (p ->> 'invoice_date')::date then
    raise exception 'The due date can''t be before the invoice date.';
  end if;
  if v_id is null then
    insert into public.invoices (invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes)
    values (v_no, (p ->> 'buyer_id')::uuid, (p ->> 'invoice_date')::date, v_amount, nullif(p ->> 'due_date', '')::date,
            nullif(p ->> 'order_id', '')::uuid, nullif(btrim(p ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.invoices set
      invoice_no = v_no, buyer_id = (p ->> 'buyer_id')::uuid, invoice_date = (p ->> 'invoice_date')::date,
      amount = v_amount, due_date = nullif(p ->> 'due_date', '')::date, order_id = nullif(p ->> 'order_id', '')::uuid,
      notes = nullif(btrim(p ->> 'notes'), ''),
      cancelled_at = case when coalesce((p ->> 'cancelled')::boolean, false) then coalesce(cancelled_at, now()) end
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'That invoice no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- p: {id?, credit_note_no, invoice_id, note_date, amount, notes, cancelled}
create function public.save_credit_note(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_no text := btrim(coalesce(p ->> 'credit_note_no', ''));
  v_n integer;
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change credit notes.';
  end if;
  if v_no = '' then raise exception 'Enter the credit note number.'; end if;
  if nullif(p ->> 'note_date', '') is null then raise exception 'Set the credit note date.'; end if;
  if coalesce(nullif(p ->> 'amount', '')::numeric, 0) <= 0 then raise exception 'The credit note amount must be more than 0.'; end if;
  if v_id is null then
    insert into public.credit_notes (credit_note_no, invoice_id, note_date, amount, notes)
    values (v_no, (p ->> 'invoice_id')::uuid, (p ->> 'note_date')::date, (p ->> 'amount')::numeric, nullif(btrim(p ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.credit_notes set
      credit_note_no = v_no, note_date = (p ->> 'note_date')::date, amount = (p ->> 'amount')::numeric,
      notes = nullif(btrim(p ->> 'notes'), ''),
      cancelled_at = case when coalesce((p ->> 'cancelled')::boolean, false) then coalesce(cancelled_at, now()) end
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'That credit note no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- p: {id?, buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes, allocations: [{invoice_id, amount}]}
-- Invoices left out of allocations (or given 0) are taken off the cheque.
create function public.save_cheque(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_no text := btrim(coalesce(p ->> 'cheque_no', ''));
  v_amount numeric := nullif(p ->> 'amount', '')::numeric;
  v_buyer uuid := nullif(p ->> 'buyer_id', '')::uuid;
  v_n integer;
  a jsonb;
  v_keep uuid[] := '{}';
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can record cheques.';
  end if;
  if v_buyer is null then raise exception 'Choose the buyer the cheque is from.'; end if;
  if v_no = '' then raise exception 'Enter the cheque number.'; end if;
  if nullif(p ->> 'cheque_date', '') is null then raise exception 'Set the date written on the cheque.'; end if;
  if coalesce(v_amount, 0) <= 0 then raise exception 'The cheque amount must be more than 0.'; end if;
  if v_id is null then
    insert into public.cheques (buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes)
    values (v_buyer, v_no, nullif(btrim(p ->> 'bank'), ''), (p ->> 'cheque_date')::date, v_amount,
            coalesce(nullif(p ->> 'received_on', '')::date, current_date), nullif(btrim(p ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.cheques set
      buyer_id = v_buyer, cheque_no = v_no, bank = nullif(btrim(p ->> 'bank'), ''), cheque_date = (p ->> 'cheque_date')::date,
      amount = v_amount, received_on = nullif(p ->> 'received_on', '')::date, notes = nullif(btrim(p ->> 'notes'), '')
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'That cheque no longer exists.'; end if;
  end if;

  for a in select * from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) loop
    continue when coalesce(nullif(a ->> 'amount', '')::numeric, 0) = 0;
    if (a ->> 'amount')::numeric < 0 then raise exception 'Amounts against invoices can''t be negative.'; end if;
    v_keep := v_keep || (a ->> 'invoice_id')::uuid;
  end loop;
  update public.cheque_allocations set removed_at = now()
  where cheque_id = v_id and removed_at is null and not (invoice_id = any (v_keep));
  for a in select * from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) loop
    continue when coalesce(nullif(a ->> 'amount', '')::numeric, 0) = 0;
    update public.cheque_allocations set amount = (a ->> 'amount')::numeric
    where cheque_id = v_id and invoice_id = (a ->> 'invoice_id')::uuid and removed_at is null and amount <> (a ->> 'amount')::numeric;
    insert into public.cheque_allocations (cheque_id, invoice_id, amount)
    select v_id, (a ->> 'invoice_id')::uuid, (a ->> 'amount')::numeric
    where not exists (select 1 from public.cheque_allocations
                      where cheque_id = v_id and invoice_id = (a ->> 'invoice_id')::uuid and removed_at is null);
  end loop;
  return v_id;
end $$;

-- Several cheques at once (for example "these all cleared"). Returns how many changed.
create function public.set_cheque_status(p_ids uuid[], p_status text, p_on date default null, p_note text default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change cheques.';
  end if;
  if p_on > current_date then raise exception 'That date is in the future.'; end if;
  update public.cheques set
    status = p_status,
    deposited_on = case when p_status = 'deposited' then coalesce(p_on, deposited_on, current_date) else deposited_on end,
    cleared_on = case when p_status = 'cleared' then coalesce(p_on, current_date) else cleared_on end,
    bounced_on = case when p_status = 'bounced' then coalesce(p_on, current_date) else bounced_on end,
    notes = case when v_note is null then notes else concat_ws(E'\n', notes, v_note) end
  where id = any (p_ids) and company_id = public.current_company() and status <> p_status;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Credit days live on the buyer, which only the owner can edit, so Accounts sets them through here.
create function public.set_buyer_credit_days(p_buyer uuid, p_days integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can set credit days.';
  end if;
  update public.buyers set credit_days = p_days where id = p_buyer and company_id = public.current_company();
end $$;

-- ---------------------------------------------------------------- access
alter table public.invoices enable row level security;
alter table public.credit_notes enable row level security;
alter table public.cheques enable row level security;
alter table public.cheque_allocations enable row level security;

revoke all on public.invoices, public.credit_notes, public.cheques, public.cheque_allocations from anon, authenticated;
grant select, insert, update on public.invoices, public.credit_notes, public.cheques, public.cheque_allocations to authenticated;

create policy invoices_finance_read on public.invoices for select to authenticated using (public.is_finance(company_id));
create policy invoices_finance_insert on public.invoices for insert to authenticated with check (public.is_finance(company_id));
create policy invoices_finance_update on public.invoices for update to authenticated
  using (public.is_finance(company_id)) with check (public.is_finance(company_id));
create policy credit_notes_finance_read on public.credit_notes for select to authenticated using (public.is_finance(company_id));
create policy credit_notes_finance_insert on public.credit_notes for insert to authenticated with check (public.is_finance(company_id));
create policy credit_notes_finance_update on public.credit_notes for update to authenticated
  using (public.is_finance(company_id)) with check (public.is_finance(company_id));
create policy cheques_finance_read on public.cheques for select to authenticated using (public.is_finance(company_id));
create policy cheques_finance_insert on public.cheques for insert to authenticated with check (public.is_finance(company_id));
create policy cheques_finance_update on public.cheques for update to authenticated
  using (public.is_finance(company_id)) with check (public.is_finance(company_id));
create policy cheque_allocations_finance_read on public.cheque_allocations for select to authenticated using (public.is_finance(company_id));
create policy cheque_allocations_finance_insert on public.cheque_allocations for insert to authenticated with check (public.is_finance(company_id));
create policy cheque_allocations_finance_update on public.cheque_allocations for update to authenticated
  using (public.is_finance(company_id)) with check (public.is_finance(company_id));

-- Money history is for the owner and Accounts only.
alter policy history_read on public.history using (
  public.is_owner(company_id)
  or (public.is_finance(company_id) and table_name <> 'buyer_names')
  or (public.is_member(company_id) and table_name not in ('buyer_names', 'invoices', 'credit_notes', 'cheques', 'cheque_allocations')));

revoke execute on function public.guard_invoice(), public.recheck_invoice(), public.guard_credit_note(), public.guard_allocation(),
  public.guard_cheque(), public.recheck_cheque() from public, anon, authenticated;
revoke execute on function public.is_finance(uuid), public.invoice_net(uuid), public.invoice_covered(uuid), public.check_invoice_cover(uuid),
  public.save_invoice(jsonb), public.save_credit_note(jsonb), public.save_cheque(jsonb), public.set_cheque_status(uuid[], text, date, text),
  public.set_buyer_credit_days(uuid, integer) from public, anon;
grant execute on function public.is_finance(uuid), public.invoice_net(uuid), public.invoice_covered(uuid), public.check_invoice_cover(uuid),
  public.save_invoice(jsonb), public.save_credit_note(jsonb), public.save_cheque(jsonb), public.set_cheque_status(uuid[], text, date, text),
  public.set_buyer_credit_days(uuid, integer) to authenticated;
