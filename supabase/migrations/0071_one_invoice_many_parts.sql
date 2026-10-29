-- One Tally invoice can cover several parts of the same order. Dheeraj (26 Oct): SO-0020's two fabric parts (Shree Shai
-- bill 812 for ₹13,923 and Ritika bill 354 for ₹19,503 at sale rates with GST) kept waiting for their invoice, because
-- Accounts made one invoice in Tally, SPL/26-27/202 for ₹33,426, for both. The pick-up only looked for an invoice per part.
-- Now an invoice whose total is a group of the order's waiting parts added up is shared by those parts: each part keeps
-- its own value before GST and GST, and Payments has the invoice once at its Tally total. Typing it in by hand works the
-- same way, part by part, for a buyer not in Tally yet. Tally is only read.

-- An invoice no longer belongs to one dispatch only; invoice_dispatch keeps it to one order.
drop index public.dispatches_invoice_key;
create index dispatches_invoice_idx on public.dispatches (invoice_id) where invoice_id is not null;

create or replace function public.invoice_dispatch(p_id uuid, p_no text, p_date date, p_taxable numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches;
  v_buyer uuid;
  v_ledger text;
  v_inv uuid;
  v_no text := btrim(coalesce(p_no, ''));
  v_gst numeric;
  v_total numeric;
  v_tally numeric;
  v_pcs integer;
  v_sale numeric;
  v_sale_gst numeric;
  v_others numeric := 0;
  v_amount numeric;
  v_more boolean;
  e public.invoices;
begin
  select * into d from public.dispatches where id = p_id for update;
  if d.cancelled_at is not null then raise exception 'This dispatch is cancelled.'; end if;
  if d.invoice_id is not null then raise exception 'This dispatch already has its invoice.'; end if;
  if v_no = '' then raise exception 'Enter the invoice number.'; end if;
  if p_date is null then raise exception 'Enter the invoice date.'; end if;
  if p_taxable is null or p_taxable < 0 then raise exception 'Enter the invoice value before GST.'; end if;
  select o.buyer_id, b.tally_ledger into v_buyer, v_ledger from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = d.order_id;

  -- GST at the styles' own rates when every sale rate is known, else at the rate of the average piece.
  select sum(qty), sum(qty * sale_rate), sum(public.garment_gst(qty * sale_rate, sale_rate)) filter (where sale_rate is not null)
  into v_pcs, v_sale, v_sale_gst
  from public.dispatch_lines where dispatch_id = p_id;
  if v_sale > 0 and not exists (select 1 from public.dispatch_lines where dispatch_id = p_id and sale_rate is null) then
    v_gst := round(p_taxable * v_sale_gst / v_sale, 2);
  else
    v_gst := public.garment_gst(p_taxable, p_taxable / greatest(v_pcs, 1));
  end if;
  v_total := round(p_taxable + v_gst, 2);

  select * into e from public.invoices
  where company_id = d.company_id and lower(btrim(invoice_no)) = lower(v_no) for update;
  if e.id is not null then
    if e.buyer_id <> v_buyer then
      raise exception 'Invoice % is already in Payments for another buyer. Check the invoice number.', e.invoice_no;
    end if;
    if e.cancelled_at is not null then
      raise exception 'Invoice % is in Payments but cancelled. Use a new invoice number, or ask Accounts to check it.', e.invoice_no;
    end if;
    if (e.order_id is not null and e.order_id <> d.order_id)
       or exists (select 1 from public.dispatches x where x.invoice_id = e.id and x.order_id <> d.order_id) then
      raise exception 'Invoice % is already in Payments for another order. Check the invoice number.', e.invoice_no;
    end if;
    select coalesce(sum(x.invoice_taxable + x.invoice_gst), 0) into v_others
    from public.dispatches x where x.invoice_id = e.id and x.cancelled_at is null;
  end if;

  -- Only the Tally pick-up, which has already added up a group of this order's waiting parts, may give a part an
  -- invoice bigger than itself: the group's other parts take the rest.
  v_more := coalesce(current_setting('app.invoice_group', true), '') = 'on' and exists (select 1 from public.dispatches x where x.order_id = d.order_id and x.id <> d.id
                    and x.invoice_id is null and x.cancelled_at is null);

  -- Invoice numbers start again each year: only a voucher dated near this invoice counts.
  select abs(v.amount) into v_tally from public.tally_vouchers v
  where v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null and v.party = v_ledger
    and lower(btrim(v.number)) = lower(v_no) and v.vdate between p_date - 60 and p_date + 60
  order by v.vdate desc limit 1;

  -- The invoice's total: Tally's, else what Payments already has. The parts on it may come to that total, or to less
  -- while another part of the order still waits (it can take the rest).
  v_amount := coalesce(v_tally, e.amount);
  if v_amount is not null and abs(v_amount - (v_others + v_total)) > 1 and not (v_others + v_total < v_amount - 1 and v_more) then
    if v_tally is null and v_ledger is null and e.notes like 'From dispatch%' and v_others > 0 and abs(e.amount - v_others) <= 1 then
      -- A buyer not in Tally yet, whose invoice was typed in on an earlier part: this part adds to it.
      update public.invoices set amount = round(v_others + v_total) where id = e.id;
    elsif v_others > 0 then
      raise exception 'Invoice % is already on another dispatch. Its ₹% in % doesn''t cover this part too (₹% with GST all together). Check the invoice number.',
        e.invoice_no, v_amount, case when v_tally is not null then 'Tally' else 'Payments' end, round(v_others + v_total, 2);
    elsif v_tally is not null and v_tally > v_total + 1 and exists (select 1 from public.dispatches x where x.order_id = d.order_id
          and x.id <> d.id and x.invoice_id is null and x.cancelled_at is null) then
      raise exception 'Invoice % is ₹% in Tally, more than this part (₹% with GST). If it also covers other parts of this order, don''t type it: it fills in by itself on all of them once their values add up to it.',
        v_no, v_tally, v_total;
    elsif v_tally is not null then
      raise exception 'Invoice % is ₹% in Tally, but the value here with GST comes to ₹%. Check the value before GST.', v_no, v_tally, v_total;
    else
      raise exception 'Invoice % is already in Payments for ₹%, but the value here with GST comes to ₹%. Check the value before GST.',
        e.invoice_no, e.amount, round(v_total);
    end if;
  end if;

  if e.id is not null then
    update public.invoices set order_id = d.order_id where id = e.id and order_id is null;
    v_inv := e.id;
  else
    insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, order_id, notes)
    values (d.company_id, v_no, v_buyer, p_date, coalesce(v_tally, round(v_total)), d.order_id, 'From dispatch, factory bill ' || d.purchase_bill_no)
    returning id into v_inv;
  end if;
  update public.dispatches set invoice_id = v_inv, invoice_no = coalesce(e.invoice_no, v_no), invoice_taxable = round(p_taxable, 2),
    invoice_gst = v_gst, invoiced_at = now()
  where id = p_id;
end $$;
revoke execute on function public.invoice_dispatch(uuid, text, date, numeric) from public, anon, authenticated;

-- Every dispatch waiting for its invoice, whose buyer is in Tally and whose sale rates are all known, takes the Tally
-- invoice for that buyer with the same total (within ₹1), dated from 3 days before the factory's bill and not on any
-- other dispatch or order. Then an invoice whose total is two or more of an order's waiting parts added up is shared by
-- them, the biggest such group first.
create or replace function public.take_invoices_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  g record;
  v_no text;
  v_date date;
  v_rounds integer := 0;
  v_skip text[] := '{}';
begin
  for r in
    select d.id, d.order_id, d.company_id, d.purchase_bill_date, b.id as buyer_id, b.tally_ledger,
           sum(l.qty * l.sale_rate) as taxable, round(sum(l.qty * l.sale_rate) + sum(public.garment_gst(l.qty * l.sale_rate, l.sale_rate))) as total
    from public.dispatches d
    join public.orders o on o.id = d.order_id
    join public.buyers b on b.id = o.buyer_id
    join public.dispatch_lines l on l.dispatch_id = d.id
    where d.invoice_id is null and d.cancelled_at is null and b.tally_ledger is not null
    group by d.id, b.id
    having bool_and(l.sale_rate is not null) and sum(l.qty * l.sale_rate) > 0
    order by d.purchased_at
  loop
    select btrim(t.number), t.vdate into v_no, v_date
    from public.tally_vouchers t
    where t.company_id = r.company_id and t.kind = 'sales' and t.gone_at is null and t.party = r.tally_ledger
      and btrim(coalesce(t.number, '')) <> '' and abs(abs(t.amount) - r.total) <= 1
      and t.vdate between r.purchase_bill_date - 3 and r.purchase_bill_date + 60
      and not exists (select 1 from public.dispatches x where x.company_id = r.company_id and x.cancelled_at is null
                      and lower(btrim(x.invoice_no)) = lower(btrim(t.number)))
      and not exists (select 1 from public.invoices i where i.company_id = r.company_id and lower(btrim(i.invoice_no)) = lower(btrim(t.number))
                      and (i.cancelled_at is not null or i.buyer_id <> r.buyer_id or (i.order_id is not null and i.order_id <> r.order_id)))
    order by t.vdate, t.number
    limit 1;
    continue when v_no is null;
    begin
      perform public.invoice_dispatch(r.id, v_no, v_date, r.taxable);
    exception when others then
      -- Left for the merchandiser to enter; the form says what differs.
      null;
    end;
  end loop;

  -- One invoice for several parts: up to 8 waiting parts per order are tried in every grouping of two or more.
  loop
    v_rounds := v_rounds + 1;
    exit when v_rounds > 20;
    select x.order_id, x.parts, t.number, t.vdate into g
    from (
      select w.order_id, w.company_id, w.buyer_id, w.tally_ledger, m.mask,
             array_agg(w.id order by w.purchased_at) as parts, count(*) as n,
             round(sum(w.total_raw)) as total, max(w.purchase_bill_date) as last_bill, min(w.purchase_bill_date) as first_bill
      from (
        select d.id, d.order_id, d.company_id, d.purchase_bill_date, d.purchased_at, b.id as buyer_id, b.tally_ledger,
               sum(l.qty * l.sale_rate) + sum(public.garment_gst(l.qty * l.sale_rate, l.sale_rate)) as total_raw,
               row_number() over (partition by d.order_id order by d.purchased_at, d.id) as k,
               count(*) over (partition by d.order_id) as n_order
        from public.dispatches d
        join public.orders o on o.id = d.order_id
        join public.buyers b on b.id = o.buyer_id
        join public.dispatch_lines l on l.dispatch_id = d.id
        where d.invoice_id is null and d.cancelled_at is null and b.tally_ledger is not null
        group by d.id, b.id
        having bool_and(l.sale_rate is not null) and sum(l.qty * l.sale_rate) > 0
      ) w
      join lateral generate_series(1, (1 << least(w.n_order, 8)::integer) - 1) m(mask) on true
      where w.n_order >= 2 and w.k <= 8 and (m.mask >> (w.k::integer - 1)) & 1 = 1
      group by w.order_id, w.company_id, w.buyer_id, w.tally_ledger, m.mask
      having count(*) >= 2
    ) x
    join public.tally_vouchers t on t.company_id = x.company_id and t.kind = 'sales' and t.gone_at is null and t.party = x.tally_ledger
      and btrim(coalesce(t.number, '')) <> '' and abs(abs(t.amount) - x.total) <= 1
      and t.vdate between x.last_bill - 3 and x.first_bill + 60 and lower(btrim(t.number)) <> all (v_skip)
      and not exists (select 1 from public.dispatches y where y.company_id = x.company_id and y.cancelled_at is null
                      and lower(btrim(y.invoice_no)) = lower(btrim(t.number)))
      and not exists (select 1 from public.invoices i where i.company_id = x.company_id and lower(btrim(i.invoice_no)) = lower(btrim(t.number))
                      and (i.cancelled_at is not null or i.buyer_id <> x.buyer_id or (i.order_id is not null and i.order_id <> x.order_id)))
    order by x.n desc, t.vdate, t.number
    limit 1;
    exit when g.order_id is null;
    perform set_config('app.invoice_group', 'on', true);
    begin
      -- All of the group's parts take the invoice, or none does.
      for r in
        select d.id, sum(l.qty * l.sale_rate) as taxable
        from public.dispatches d join public.dispatch_lines l on l.dispatch_id = d.id
        where d.id = any (g.parts) group by d.id, d.purchased_at order by d.purchased_at, d.id
      loop
        perform public.invoice_dispatch(r.id, btrim(g.number), g.vdate, r.taxable);
      end loop;
    exception when others then
      -- Left for the merchandiser to enter part by part; the form says what differs.
      v_skip := v_skip || lower(btrim(g.number));
    end;
    perform set_config('app.invoice_group', 'off', true);
  end loop;
end $$;

revoke execute on function public.take_invoices_from_tally() from public, anon, authenticated;

-- Parts already waiting take their shared invoices now.
select public.take_invoices_from_tally();

-- SO-0020, 29 Oct: before this went live, SPL/26-27/202 was typed in by hand on part 1 (Shree Shai bill 812) with the
-- whole invoice's value, ₹31,834 before GST, so part 2 (Ritika bill 354) still waited. Part 1 goes back to its own value
-- at its sale rate (₹13,260 + ₹663 GST) and part 2 joins the same invoice with its own (₹18,574 + ₹928.70). Only these
-- two dispatches, and only while they are exactly as found.
do $$
begin
  if exists (select 1 from public.dispatches where id = '1c7f9512-900d-49e6-8f2f-506d64f73e33'
               and invoice_no = 'SPL/26-27/202' and invoice_taxable = 31834 and cancelled_at is null)
     and exists (select 1 from public.dispatches where id = 'f68bd6e9-902a-4d4e-a330-e9fe4ae07eb9'
               and invoice_id is null and cancelled_at is null) then
    update public.dispatches set invoice_taxable = 13260, invoice_gst = 663 where id = '1c7f9512-900d-49e6-8f2f-506d64f73e33';
    perform public.invoice_dispatch('f68bd6e9-902a-4d4e-a330-e9fe4ae07eb9', 'SPL/26-27/202', '2026-10-23', 18574);
    perform public.take_eway_bills_from_tally();
  end if;
end $$;
