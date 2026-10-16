-- Money fixes from the second full check of 16 Oct 2026: Payments, Tally links and the dispatch invoice.

-- 1. Two cheques saved at the same moment could both pay the same invoice in full: each save checked the invoice
--    without waiting for the other. A save now holds the cheque and the invoice until it is done, and the check
--    reads what other saves have just written.
create or replace function public.check_invoice_cover(p_invoice uuid) returns void
language plpgsql volatile set search_path = '' as $$
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

create or replace function public.guard_allocation() returns trigger
language plpgsql set search_path = '' as $$
declare
  c public.cheques;
  i public.invoices;
  v_total numeric;
begin
  -- Cheque first, then invoice, the same order everywhere, so two saves wait for each other instead of locking up.
  select * into c from public.cheques where id = new.cheque_id for update;
  select * into i from public.invoices where id = new.invoice_id for update;
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

create or replace function public.guard_credit_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.invoices where id = new.invoice_id for update;
  if exists (select 1 from public.invoices where id = new.invoice_id and cancelled_at is not null) and new.cancelled_at is null then
    raise exception 'That invoice is cancelled.';
  end if;
  perform public.check_invoice_cover(new.invoice_id);
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    perform 1 from public.invoices where id = old.invoice_id for update;
    perform public.check_invoice_cover(old.invoice_id);
  end if;
  return null;
end $$;

-- The owner bringing back a bounced cheque, at the same moment as a new cheque for the same invoice, waits too.
create or replace function public.recheck_cheque() returns trigger
language plpgsql set search_path = '' as $$
declare
  v uuid;
begin
  if (select coalesce(sum(amount), 0) from public.cheque_allocations where cheque_id = new.id and removed_at is null) > new.amount then
    raise exception 'Cheque % is set against invoices for more than ₹%.', new.cheque_no, new.amount;
  end if;
  for v in select invoice_id from public.cheque_allocations where cheque_id = new.id and removed_at is null order by invoice_id loop
    perform 1 from public.invoices where id = v for update;
    perform public.check_invoice_cover(v);
  end loop;
  return null;
end $$;

-- 2. A cheque still in hand more than 90 days after its date can't be banked, and Payments stops counting it. It
--    could still be marked deposited or cleared, and then counted again beside the buyer's replacement cheque.
--    Only the owner can now record that, for example when it was really deposited in time and noted late with
--    today's date (Accounts can instead give the real deposit date).
create or replace function public.guard_cheque() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'in_hand' and (new.buyer_id, new.cheque_no, new.cheque_date, new.amount)
                                 is distinct from (old.buyer_id, old.cheque_no, old.cheque_date, old.amount)
     and not public.is_owner(old.company_id) then
    raise exception 'Cheque % has been deposited. Its number, date and amount can''t change.', old.cheque_no;
  end if;
  -- save_cheque takes a cheque off its old invoices before it changes the buyer, so this only stops a buyer
  -- change that would leave the cheque paying another buyer's invoices.
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
    if old.status = 'in_hand' and new.status in ('deposited', 'cleared') and new.deposited_on > new.cheque_date + 90
       and not public.is_owner(old.company_id) then
      raise exception 'Cheque % expired on % (cheques are valid for 90 days). Ask the buyer for a new cheque.',
        new.cheque_no, to_char(new.cheque_date + 90, 'DD Mon YYYY');
    end if;
  end if;
  if new.cleared_on < new.deposited_on or new.bounced_on < new.deposited_on then
    raise exception 'Cheque % was deposited on %, so it can''t clear or bounce before then.', new.cheque_no, to_char(new.deposited_on, 'DD Mon YYYY');
  end if;
  return new;
end $$;

-- 3. Saving or cancelling an invoice in Payments cleared the order it belongs to, because the form doesn't send it.
--    The order is now kept unless the save says otherwise.
create or replace function public.save_invoice(p jsonb) returns uuid
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
      amount = v_amount, due_date = nullif(p ->> 'due_date', '')::date,
      order_id = case when p ? 'order_id' then nullif(p ->> 'order_id', '')::uuid else order_id end,
      notes = nullif(btrim(p ->> 'notes'), ''),
      cancelled_at = case when coalesce((p ->> 'cancelled')::boolean, false) then coalesce(cancelled_at, now()) end
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'That invoice no longer exists.'; end if;
  end if;
  return v_id;
end $$;

-- 4. Two buyers (or two factories) could be linked to the same Tally ledger, and bringing in from Tally then put the
--    invoices on one of them without saying so. A ledger now links to one buyer and one factory at most.
--    (Before applying: check no ledger is already linked twice, or these indexes can't be made.)
create unique index buyers_tally_ledger_key on public.buyers (company_id, tally_ledger) where tally_ledger is not null;
create unique index factories_tally_ledger_key on public.factories (company_id, tally_ledger) where tally_ledger is not null;

create or replace function public.tally_set_ledger(p_kind text, p_id uuid, p_ledger text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_name text := nullif(btrim(p_ledger), '');
  v_n integer;
begin
  if not public.is_finance(v_company) then raise exception 'Only Accounts and the owner can link Tally ledgers.'; end if;
  if p_kind = 'buyer' then
    if v_name is not null and exists (select 1 from public.buyers where company_id = v_company and tally_ledger = v_name and id <> p_id) then
      raise exception 'That Tally ledger is already linked to another buyer.';
    end if;
    update public.buyers set tally_ledger = v_name where id = p_id and company_id = v_company;
  elsif p_kind = 'factory' then
    if v_name is not null and exists (select 1 from public.factories where company_id = v_company and tally_ledger = v_name and id <> p_id) then
      raise exception 'That Tally ledger is already linked to another factory.';
    end if;
    update public.factories set tally_ledger = v_name where id = p_id and company_id = v_company;
  else
    raise exception 'Choose a buyer or a factory.';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That % no longer exists.', p_kind; end if;
end $$;

-- Linking by name when Tally is read now skips a ledger another buyer (or factory) already has, and a ledger two
-- unlinked buyers both match; those are left for Accounts to link by hand. The rest is as in 0032.
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
  -- Every company has ledgers, so an empty list means Tally didn't really answer (the company was closed or
  -- switched mid-read). Taking it would mark every ledger, stock item and voucher as deleted.
  if jsonb_typeof(p -> 'ledgers') = 'array' and jsonb_array_length(p -> 'ledgers') = 0 then
    raise exception 'Tally sent no ledgers, so this read was not taken. The reader will try again.';
  end if;
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

  -- Link buyers and factories to the ledger with the same name, when exactly one ledger matches, no other buyer
  -- (or factory) matches that ledger too, and none is linked to it already.
  update public.buyers b set tally_ledger = m.name
  from (
    select x.id, x.name, count(*) over (partition by x.name) as takers
    from (
      select b2.id, min(l.name) as name
      from public.buyers b2
      left join public.buyer_names n on n.buyer_id = b2.id
      join public.tally_ledgers l on l.company_id = b2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
       and public.tally_norm(l.name) in (public.tally_norm(n.real_name), public.tally_norm(b2.code))
      where b2.company_id = v_company and b2.tally_ledger is null
      group by b2.id having count(distinct l.name) = 1
    ) x
  ) m
  where b.id = m.id and m.takers = 1
    and not exists (select 1 from public.buyers o where o.company_id = v_company and o.tally_ledger = m.name);
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.factories f set tally_ledger = m.name
  from (
    select x.id, x.name, count(*) over (partition by x.name) as takers
    from (
      select f2.id, min(l.name) as name
      from public.factories f2
      join public.tally_ledgers l on l.company_id = f2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
       and public.tally_norm(l.name) = public.tally_norm(f2.name)
      where f2.company_id = v_company and f2.tally_ledger is null
      group by f2.id having count(distinct l.name) = 1
    ) x
  ) m
  where f.id = m.id and m.takers = 1
    and not exists (select 1 from public.factories o where o.company_id = v_company and o.tally_ledger = m.name);
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.tally_settings set snapshot_at = v_now, agent_seen_at = v_now, snapshot_counts = v_counts
  where company_id = v_company;
  return v_counts || jsonb_build_object('linked', v_linked);
end $$;

-- 5, 10, 11. The dispatch invoice.
--    When Accounts had already brought the invoice in from Tally, the dispatch couldn't be invoiced: the same number
--    was added again and refused. The invoice already in Payments is now used when it is the same invoice (same
--    buyer, not cancelled, on no other dispatch, amount within ₹1); otherwise the message says what differs.
--    The due date is left empty, so it follows the buyer's credit days like any invoice made in Payments, instead
--    of staying at the credit days of the day it was made.
create or replace function public.record_dispatch_invoice(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_buyer uuid;
  v_inv uuid;
  v_no text := btrim(coalesce(p ->> 'invoice_no', ''));
  v_taxable numeric := nullif(p ->> 'taxable', '')::numeric;
  v_gst numeric := coalesce(nullif(p ->> 'gst', '')::numeric, 0);
  e public.invoices;
begin
  if d.invoice_id is not null then raise exception 'This dispatch already has its invoice.'; end if;
  if v_no = '' then raise exception 'Enter the invoice number.'; end if;
  if nullif(p ->> 'invoice_date', '') is null then raise exception 'Enter the invoice date.'; end if;
  if v_taxable is null or v_taxable < 0 or v_gst < 0 then raise exception 'Enter the invoice value and GST.'; end if;
  select o.buyer_id into v_buyer from public.orders o where o.id = d.order_id;
  select * into e from public.invoices
  where company_id = d.company_id and lower(btrim(invoice_no)) = lower(v_no) for update;
  if e.id is not null then
    if e.buyer_id <> v_buyer then
      raise exception 'Invoice % is already in Payments for another buyer. Check the invoice number.', e.invoice_no;
    end if;
    if e.cancelled_at is not null then
      raise exception 'Invoice % is in Payments but cancelled. Use a new invoice number, or ask Accounts to check it.', e.invoice_no;
    end if;
    if exists (select 1 from public.dispatches x where x.invoice_id = e.id) then
      raise exception 'Invoice % is already on another dispatch. Check the invoice number.', e.invoice_no;
    end if;
    if e.order_id is not null and e.order_id <> d.order_id then
      raise exception 'Invoice % is already in Payments for another order. Check the invoice number.', e.invoice_no;
    end if;
    if abs(e.amount - round(v_taxable + v_gst, 2)) > 1 then
      raise exception 'Invoice % is already in Payments for ₹%, but value and GST here come to ₹%. Check the amounts.',
        e.invoice_no, e.amount, round(v_taxable + v_gst, 2);
    end if;
    update public.invoices set order_id = d.order_id where id = e.id and order_id is null;
    v_inv := e.id;
  else
    insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, order_id, notes)
    values (d.company_id, v_no, v_buyer, (p ->> 'invoice_date')::date, round(v_taxable + v_gst, 2),
            d.order_id, 'From dispatch, factory bill ' || d.purchase_bill_no)
    returning id into v_inv;
  end if;
  update public.dispatches set invoice_id = v_inv, invoice_no = coalesce(e.invoice_no, v_no), invoice_taxable = round(v_taxable, 2),
    invoice_gst = round(v_gst, 2), invoiced_at = now()
  where id = p_id;
end $$;

-- 10. The purchase value was worked out from the rates as typed, while each style's rate is kept to the paisa,
--     so the two could differ. It is now the pieces times the rates as kept.
create or replace function public.record_purchase(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_order uuid := (p ->> 'order_id')::uuid;
  v_factory uuid := (p ->> 'factory_id')::uuid;
  v_id uuid;
  v_taxable numeric;
begin
  select company_id into v_company from public.orders where id = v_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can record a purchase on an open order.';
  end if;
  if btrim(coalesce(p ->> 'bill_no', '')) = '' then raise exception 'Enter the factory''s bill number.'; end if;
  if nullif(p ->> 'bill_date', '') is null then raise exception 'Enter the bill date.'; end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Enter the pieces bought for at least one style.';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'lines') r
             where not exists (select 1 from public.order_lines l where l.id = (r ->> 'line_id')::uuid and l.order_id = v_order
                               and l.factory_id = v_factory and l.removed_at is null)) then
    raise exception 'Every style must be on this order and made by this factory.';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'lines') r
             where coalesce((r ->> 'qty')::integer, 0) <= 0 or nullif(r ->> 'purchase_rate', '') is null) then
    raise exception 'Every style needs its pieces and purchase rate.';
  end if;
  select sum((r ->> 'qty')::integer * round((r ->> 'purchase_rate')::numeric, 2)) into v_taxable from jsonb_array_elements(p -> 'lines') r;
  insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, purchase_gst,
                                 purchased_at, invoice_due_at, notes)
  values (v_company, v_order, v_factory, btrim(p ->> 'bill_no'), (p ->> 'bill_date')::date, round(v_taxable, 2),
          coalesce(nullif(p ->> 'gst', '')::numeric, 0), now(), now() + interval '4 hours', nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate, sale_rate)
  select v_id, (r ->> 'line_id')::uuid, v_company, (r ->> 'qty')::integer, round((r ->> 'purchase_rate')::numeric, 2),
         round(nullif(r ->> 'sale_rate', '')::numeric, 2)
  from jsonb_array_elements(p -> 'lines') r;
  return v_id;
end $$;

-- 6. Everyday cheque edits were refused part way: lowering a cheque and its split together, moving money between
--    the invoices it pays, or moving a cheque in hand to another buyer (the form clears its split). Each change was
--    checked before the rest of the save was in. The cheque and its split are now checked once, at the end of the
--    save, and invoices taken off the cheque are taken off first. A wrong split is still refused.
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
  for a in select * from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) loop
    continue when coalesce(nullif(a ->> 'amount', '')::numeric, 0) = 0;
    if (a ->> 'amount')::numeric < 0 then raise exception 'Amounts against invoices can''t be negative.'; end if;
    v_keep := v_keep || (a ->> 'invoice_id')::uuid;
  end loop;

  set constraints public.cheques_recheck, public.cheque_allocations_guard deferred;
  if v_id is null then
    insert into public.cheques (buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes)
    values (v_buyer, v_no, nullif(btrim(p ->> 'bank'), ''), (p ->> 'cheque_date')::date, v_amount,
            coalesce(nullif(p ->> 'received_on', '')::date, public.india_today()), nullif(btrim(p ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.cheque_allocations set removed_at = now()
    where cheque_id = v_id and removed_at is null and not (invoice_id = any (v_keep))
      and company_id = public.current_company();
    update public.cheques set
      buyer_id = v_buyer, cheque_no = v_no, bank = nullif(btrim(p ->> 'bank'), ''), cheque_date = (p ->> 'cheque_date')::date,
      amount = v_amount, received_on = nullif(p ->> 'received_on', '')::date, notes = nullif(btrim(p ->> 'notes'), '')
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'That cheque no longer exists.'; end if;
  end if;
  for a in select * from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) loop
    continue when coalesce(nullif(a ->> 'amount', '')::numeric, 0) = 0;
    update public.cheque_allocations set amount = (a ->> 'amount')::numeric
    where cheque_id = v_id and invoice_id = (a ->> 'invoice_id')::uuid and removed_at is null and amount <> (a ->> 'amount')::numeric;
    insert into public.cheque_allocations (cheque_id, invoice_id, amount)
    select v_id, (a ->> 'invoice_id')::uuid, (a ->> 'amount')::numeric
    where not exists (select 1 from public.cheque_allocations
                      where cheque_id = v_id and invoice_id = (a ->> 'invoice_id')::uuid and removed_at is null);
  end loop;
  -- Check the whole save now, so a wrong split is refused here with its reason.
  set constraints public.cheques_recheck, public.cheque_allocations_guard immediate;
  return v_id;
end $$;
