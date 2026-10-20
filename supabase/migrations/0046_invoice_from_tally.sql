-- The buyer's invoice comes from Tally by itself. Dheeraj (20 Oct): the sales invoice number should be fetched
-- from Tally, not picked or typed. Once the factory's bill is in, the merchandiser makes the invoice in Tally; when
-- the Tally reader brings a TAX INVOICE for the order's buyer whose total is this dispatch's value at its sale rates
-- with GST (within ₹1), the dispatch takes its number and date, the invoice goes into Payments, and its e-way bill
-- follows. Typing the invoice in stays as a fallback (a buyer not in Tally yet, or an invoice for a different value).
-- Tally is only read.

-- The invoice step without the permission check, shared by the merchandiser's form and the Tally pick-up.
create function public.invoice_dispatch(p_id uuid, p_no text, p_date date, p_taxable numeric) returns void
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

  -- Invoice numbers start again each year: only a voucher dated near this invoice counts.
  select abs(v.amount) into v_tally from public.tally_vouchers v
  where v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null and v.party = v_ledger
    and lower(btrim(v.number)) = lower(v_no) and v.vdate between p_date - 60 and p_date + 60
  order by v.vdate desc limit 1;
  if v_tally is not null then
    if abs(v_tally - v_total) > 1 then
      raise exception 'Invoice % is ₹% in Tally, but the value here with GST comes to ₹%. Check the value before GST.', v_no, v_tally, v_total;
    end if;
    v_total := v_tally;
  else
    v_total := round(v_total);
  end if;

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
    if abs(e.amount - v_total) > 1 then
      raise exception 'Invoice % is already in Payments for ₹%, but the value here with GST comes to ₹%. Check the value before GST.',
        e.invoice_no, e.amount, v_total;
    end if;
    update public.invoices set order_id = d.order_id where id = e.id and order_id is null;
    v_inv := e.id;
  else
    insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, order_id, notes)
    values (d.company_id, v_no, v_buyer, p_date, v_total, d.order_id, 'From dispatch, factory bill ' || d.purchase_bill_no)
    returning id into v_inv;
  end if;
  update public.dispatches set invoice_id = v_inv, invoice_no = coalesce(e.invoice_no, v_no), invoice_taxable = round(p_taxable, 2),
    invoice_gst = v_gst, invoiced_at = now()
  where id = p_id;
end $$;
revoke execute on function public.invoice_dispatch(uuid, text, date, numeric) from public, anon, authenticated;

-- The merchandiser's form: the permission check, then the shared step.
create or replace function public.record_dispatch_invoice(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
begin
  perform public.invoice_dispatch(d.id, p ->> 'invoice_no', nullif(p ->> 'invoice_date', '')::date, nullif(p ->> 'taxable', '')::numeric);
end $$;

-- Every dispatch waiting for its invoice, whose buyer is in Tally and whose sale rates are all known, takes the
-- Tally invoice for that buyer with the same total (within ₹1), dated from 3 days before the factory's bill and
-- not on any other dispatch or order. Oldest dispatch first, each to the oldest such invoice.
create function public.take_invoices_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_no text;
  v_date date;
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
end $$;

revoke execute on function public.take_invoices_from_tally() from public, anon, authenticated;

-- It runs whenever the Tally reader brings vouchers (through the purchase-bill trigger, which ends by calling it),
-- and when a purchase is recorded, for an invoice made in Tally before the purchase was entered here.
create or replace function public.take_purchase_bills_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.dispatches d
  set purchase_tally = m.guid, purchase_tally_amount = m.amount
  from (
    select distinct on (d2.id) d2.id, v.guid, abs(v.amount) as amount
    from public.dispatches d2
    join public.factories f on f.id = d2.factory_id
    join public.tally_vouchers v on v.company_id = d2.company_id and v.kind = 'purchase' and v.gone_at is null
      and v.party = f.tally_ledger and lower(public.tally_bill_no(v)) = lower(btrim(d2.purchase_bill_no))
      and v.vdate between d2.purchase_bill_date - 60 and d2.purchase_bill_date + 60
    where d2.cancelled_at is null
    order by d2.id, v.vdate desc
  ) m
  where d.id = m.id and (d.purchase_tally is distinct from m.guid or d.purchase_tally_amount is distinct from m.amount);
  perform public.take_invoices_from_tally();
end $$;

-- Whether the order's buyer is in Tally, so the order page can say the invoice will come from there.
create or replace function public.dispatch_tally_bills(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_buyer uuid;
  v_ledger text;
  v_from date;
begin
  select o.company_id, o.buyer_id, b.tally_ledger, greatest(coalesce(o.po_date, o.created_at::date) - 7, public.india_today() - 90)
  into v_company, v_buyer, v_ledger, v_from
  from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = p_order;
  if v_company is null or not public.can_edit_orders(v_company) then
    return jsonb_build_object('purchases', '[]'::jsonb, 'sales', '[]'::jsonb, 'buyer_in_tally', false);
  end if;
  return jsonb_build_object(
    'buyer_in_tally', v_ledger is not null,
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('factory_id', x.factory_id, 'no', x.no, 'date', x.vdate, 'amount', x.amount) order by x.vdate desc, x.no desc)
      from (
        select distinct on (f.id, lower(public.tally_bill_no(v))) f.id as factory_id, public.tally_bill_no(v) as no, v.vdate, abs(v.amount) as amount
        from public.factories f
        join public.tally_vouchers v on v.company_id = v_company and v.kind = 'purchase' and v.gone_at is null
          and v.party = f.tally_ledger and v.vdate >= v_from
        where f.company_id = v_company
          and exists (select 1 from public.order_lines l where l.order_id = p_order and l.factory_id = f.id and l.removed_at is null)
          and not exists (select 1 from public.dispatches d where d.company_id = v_company and d.factory_id = f.id and d.cancelled_at is null
                          and lower(btrim(d.purchase_bill_no)) = lower(public.tally_bill_no(v)))
        order by f.id, lower(public.tally_bill_no(v)), v.vdate desc
      ) x), '[]'::jsonb),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object('no', x.number, 'date', x.vdate, 'amount', x.amount, 'eway', x.eway_bill_no) order by x.vdate desc, x.number desc)
      from (
        select distinct on (lower(btrim(v.number))) btrim(v.number) as number, v.vdate, abs(v.amount) as amount, v.eway_bill_no
        from public.tally_vouchers v
        where v_ledger is not null and v.company_id = v_company and v.kind = 'sales' and v.gone_at is null
          and v.party = v_ledger and v.vdate >= v_from and btrim(coalesce(v.number, '')) <> ''
          and not exists (select 1 from public.dispatches d where d.company_id = v_company and d.cancelled_at is null
                          and lower(btrim(d.invoice_no)) = lower(btrim(v.number)))
          and not exists (select 1 from public.invoices i where i.company_id = v_company and lower(btrim(i.invoice_no)) = lower(btrim(v.number))
                          and (i.cancelled_at is not null or i.buyer_id <> v_buyer or (i.order_id is not null and i.order_id <> p_order)))
        order by lower(btrim(v.number)), v.vdate desc
      ) x), '[]'::jsonb));
end $$;

-- Dispatches already waiting take their invoices now.
select public.take_invoices_from_tally();

-- Copies on record. Dheeraj (20 Oct): for now the team also uploads the factory's bill and our sales invoice as
-- printed from Tally (a PDF or a photo). Either copy can be added or replaced at any time, before or after Tally
-- fills in the numbers, and stays with the dispatch (and, for the invoice, shows in Payments).
alter table public.dispatches add column bill_path text, add column invoice_path text;

create function public.attach_dispatch_copy(p_id uuid, p_kind text, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_path text := btrim(coalesce(p_path, ''));
begin
  if v_path = '' or v_path not like d.company_id || '/' || d.order_id || '/dispatch/' || d.id || '/%' or v_path like '%..%' then
    raise exception 'The copy didn''t upload properly. Try again.';
  end if;
  if p_kind = 'bill' then
    update public.dispatches set bill_path = v_path where id = d.id;
  elsif p_kind = 'invoice' then
    update public.dispatches set invoice_path = v_path where id = d.id;
  else
    raise exception 'Unknown copy.';
  end if;
end $$;

revoke execute on function public.attach_dispatch_copy(uuid, text, text) from public, anon;
grant execute on function public.attach_dispatch_copy(uuid, text, text) to authenticated;
