-- Dates in payments follow India time. The database clock runs on UTC, so
-- between midnight and 5:30 am IST "today" was still yesterday there: a cheque
-- dated today couldn't be marked deposited and its date read as in the future.

create function public.india_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant execute on function public.india_today() to authenticated;

create or replace function public.guard_cheque() returns trigger
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
      new.deposited_on := coalesce(new.deposited_on, public.india_today()); new.cleared_on := null; new.bounced_on := null;
    elsif new.status = 'cleared' then
      new.cleared_on := coalesce(new.cleared_on, public.india_today());
      new.deposited_on := coalesce(new.deposited_on, new.cleared_on); new.bounced_on := null;
    elsif new.status = 'bounced' then
      new.bounced_on := coalesce(new.bounced_on, public.india_today()); new.cleared_on := null;
    end if;
    if new.status in ('deposited', 'cleared') and new.deposited_on < new.cheque_date then
      raise exception 'Cheque % is dated %, so it can''t be deposited before then.', new.cheque_no, to_char(new.cheque_date, 'DD Mon YYYY');
    end if;
  end if;
  return new;
end $$;

create or replace function public.save_cheque(p jsonb) returns uuid
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
            coalesce(nullif(p ->> 'received_on', '')::date, public.india_today()), nullif(btrim(p ->> 'notes'), ''))
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

create or replace function public.set_cheque_status(p_ids uuid[], p_status text, p_on date default null, p_note text default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change cheques.';
  end if;
  if p_on > public.india_today() then raise exception 'That date is in the future.'; end if;
  update public.cheques set
    status = p_status,
    deposited_on = case when p_status = 'deposited' then coalesce(p_on, deposited_on, public.india_today()) else deposited_on end,
    cleared_on = case when p_status = 'cleared' then coalesce(p_on, public.india_today()) else cleared_on end,
    bounced_on = case when p_status = 'bounced' then coalesce(p_on, public.india_today()) else bounced_on end,
    notes = case when v_note is null then notes else concat_ws(E'\n', notes, v_note) end
  where id = any (p_ids) and company_id = public.current_company() and status <> p_status;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
