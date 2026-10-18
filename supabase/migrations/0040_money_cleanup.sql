-- Money clean-up (18 Oct 2026): cheques settled from what Tally shows, the bounced-cheque notice clock,
-- and a buyer's overdue invoices for the order screens. Tally is only read here, never written.

-- 1. "Paid another way". Many buyers hand over a post-dated cheque per invoice and then pay that invoice by
--    NEFT or RTGS, so the cheque is never banked. Marking it cleared would be untrue, and cancelled reads as a
--    mistake. It now has its own end state: the invoice is paid (Tally shows the receipt) and the cheque goes
--    back to the buyer. Like bounced and cancelled, it no longer pays its invoices in Payments.
alter table public.cheques drop constraint cheques_status_check;
alter table public.cheques add constraint cheques_status_check
  check (status in ('in_hand', 'deposited', 'cleared', 'bounced', 'cancelled', 'paid_other'));
alter table public.cheques add column paid_other_on date, add column notice_sent_on date;
grant update (paid_other_on, notice_sent_on) on public.cheques to authenticated;

-- As in 0037, with "paid another way" open to Accounts from in hand or deposited, and the notice date kept
-- only on a bounced cheque.
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
                                         ('deposited', 'cleared'), ('deposited', 'bounced'), ('deposited', 'in_hand'),
                                         ('in_hand', 'paid_other'), ('deposited', 'paid_other'))
       and not public.is_owner(old.company_id) then
      if old.status = 'paid_other' then
        raise exception 'Cheque % was paid another way. Ask the owner to correct it.', old.cheque_no;
      end if;
      raise exception 'A % cheque can''t be marked %. Ask the owner to correct it.',
        replace(old.status, '_', ' '), case new.status when 'paid_other' then 'paid another way' else replace(new.status, '_', ' ') end;
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
    elsif new.status = 'paid_other' then
      new.paid_other_on := coalesce(new.paid_other_on, public.india_today()); new.cleared_on := null; new.bounced_on := null;
    end if;
    if new.status <> 'paid_other' then new.paid_other_on := null; end if;
    if new.status <> 'bounced' then new.notice_sent_on := null; end if;
    if new.status in ('deposited', 'cleared') and new.deposited_on < new.cheque_date then
      raise exception 'Cheque % is dated %, so it can''t be deposited before then.', new.cheque_no, to_char(new.cheque_date, 'DD Mon YYYY');
    end if;
    if old.status = 'in_hand' and new.status in ('deposited', 'cleared') and new.deposited_on > new.cheque_date + 90
       and not public.is_owner(old.company_id) then
      raise exception 'Cheque % expired on % (cheques are valid for 90 days). Ask the buyer for a new cheque.',
        new.cheque_no, to_char(new.cheque_date + 90, 'DD Mon YYYY');
    end if;
  end if;
  if new.cleared_on < new.deposited_on or new.bounced_on < new.deposited_on then
    raise exception 'Cheque % was deposited on %, so it can''t clear or bounce before then.', new.cheque_no, to_char(new.deposited_on, 'DD Mon YYYY');
  end if;
  if new.notice_sent_on is not null then
    if new.status <> 'bounced' then raise exception 'Only a bounced cheque has a legal notice.'; end if;
    if new.notice_sent_on < new.bounced_on then
      raise exception 'Cheque % bounced on %, so the notice can''t be sent before then.', new.cheque_no, to_char(new.bounced_on, 'DD Mon YYYY');
    end if;
    if new.notice_sent_on > public.india_today() then raise exception 'That date is in the future.'; end if;
  end if;
  return new;
end $$;

-- As in 0037, refusing a cheque that was paid another way as well.
create or replace function public.guard_allocation() returns trigger
language plpgsql set search_path = '' as $$
declare
  c public.cheques;
  i public.invoices;
  v_total numeric;
begin
  select * into c from public.cheques where id = new.cheque_id for update;
  select * into i from public.invoices where id = new.invoice_id for update;
  if new.removed_at is null then
    if c.buyer_id <> i.buyer_id then
      raise exception 'Cheque % and invoice % are for different buyers.', c.cheque_no, i.invoice_no;
    end if;
    if i.cancelled_at is not null then
      raise exception 'Invoice % is cancelled.', i.invoice_no;
    end if;
    if c.status in ('bounced', 'cancelled', 'paid_other') then
      raise exception 'Cheque % is %. Record a new cheque instead.', c.cheque_no,
        case c.status when 'paid_other' then 'paid another way' else c.status end;
    end if;
  end if;
  select coalesce(sum(amount), 0) into v_total from public.cheque_allocations where cheque_id = new.cheque_id and removed_at is null;
  if v_total > c.amount then
    raise exception 'Cheque % is for ₹%, but ₹% is set against invoices.', c.cheque_no, c.amount, v_total;
  end if;
  perform public.check_invoice_cover(new.invoice_id);
  return null;
end $$;

-- As in 0004, with the date a cheque was paid another way.
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
    paid_other_on = case when p_status = 'paid_other' then coalesce(p_on, public.india_today()) else paid_other_on end,
    notes = case when v_note is null then notes else concat_ws(E'\n', notes, v_note) end
  where id = any (p_ids) and company_id = public.current_company() and status <> p_status;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 2. Settle many cheques in one go, each with its own date and note, as the Tally check suggests: cleared on the
--    day Tally shows the cheque's receipt, or paid another way on the day Tally shows the invoice fully paid.
--    p is [{"id", "status": "cleared" | "paid_other", "on", "note"}]. All or nothing.
create function public.settle_cheques(p jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  x jsonb;
  v_n integer := 0;
  v_one integer;
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change cheques.';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if x ->> 'status' not in ('cleared', 'paid_other') then raise exception 'A cheque can only be settled as cleared or paid another way.'; end if;
    v_one := public.set_cheque_status(array[(x ->> 'id')::uuid], x ->> 'status', nullif(x ->> 'on', '')::date, x ->> 'note');
    v_n := v_n + v_one;
  end loop;
  return v_n;
end $$;
revoke execute on function public.settle_cheques(jsonb) from public, anon;
grant execute on function public.settle_cheques(jsonb) to authenticated;

-- 3. The bounced-cheque clock. After a bounce the buyer must get a written legal notice within 30 days of the bank's
--    return memo (Negotiable Instruments Act, section 138), or the right to file a cheque-bounce case is lost.
--    Recording when the notice went stops the clock; null takes it back.
create function public.set_cheque_notice(p_id uuid, p_on date) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can change cheques.';
  end if;
  update public.cheques set notice_sent_on = p_on where id = p_id and company_id = public.current_company();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That cheque no longer exists.'; end if;
end $$;
revoke execute on function public.set_cheque_notice(uuid, date) from public, anon;
grant execute on function public.set_cheque_notice(uuid, date) to authenticated;

-- 4. What is still to collect on each invoice. Money received is the larger of the cheques cleared against it and
--    the receipts Tally sets against its bill for that buyer's ledger, so a payment by NEFT or RTGS counts too and a
--    cleared cheque that is also in Tally isn't counted twice. Internal: callers check who may see it.
create function public.invoice_dues(p_company uuid)
returns table (invoice_id uuid, buyer_id uuid, invoice_no text, due date, to_collect numeric)
language sql stable security definer set search_path = '' as $$
  with rb as (
    select v.party, lower(btrim(b ->> 'name')) as bill, sum((b ->> 'amount')::numeric) as amt
    from public.tally_vouchers v cross join lateral jsonb_array_elements(coalesce(v.bills, '[]'::jsonb)) b
    where v.company_id = p_company and v.gone_at is null and v.kind = 'receipt'
    group by 1, 2
  )
  select i.id, i.buyer_id, i.invoice_no, coalesce(i.due_date, i.invoice_date + byr.credit_days),
    greatest(0, i.amount - coalesce(cn.amt, 0) - greatest(coalesce(ch.amt, 0), coalesce(rb.amt, 0)))
  from public.invoices i
  join public.buyers byr on byr.id = i.buyer_id
  left join lateral (select sum(c.amount) as amt from public.credit_notes c where c.invoice_id = i.id and c.cancelled_at is null) cn on true
  left join lateral (select sum(a.amount) as amt from public.cheque_allocations a join public.cheques c on c.id = a.cheque_id
                     where a.invoice_id = i.id and a.removed_at is null and c.status = 'cleared') ch on true
  left join rb on rb.party = byr.tally_ledger and rb.bill = lower(btrim(i.invoice_no))
  where i.company_id = p_company and i.cancelled_at is null
$$;
revoke execute on function public.invoice_dues(uuid) from public, anon, authenticated;

-- A buyer's overdue invoices, for the warning on a new order or incoming PO. The orders team sees how many and how
-- late; only the owner and Accounts see the amount. More than ₹1 left counts, as everywhere in Payments.
create function public.buyer_overdue(p_buyer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  r record;
begin
  if not (public.is_finance(v_company) or public.can_edit_orders(v_company)) then
    raise exception 'Only the orders team, Accounts and the owner can see this.';
  end if;
  select count(*) as n, max(public.india_today() - d.due) as oldest, sum(d.to_collect) as amt into r
  from public.invoice_dues(v_company) d
  where d.buyer_id = p_buyer and d.to_collect > 1 and d.due < public.india_today();
  return jsonb_build_object('overdue_invoices', r.n, 'oldest_days', coalesce(r.oldest, 0),
                            'amount', case when public.is_finance(v_company) then coalesce(r.amt, 0) end);
end $$;
revoke execute on function public.buyer_overdue(uuid) from public, anon;
grant execute on function public.buyer_overdue(uuid) to authenticated;
