-- Dispatch bills come from Tally, and GST is worked out instead of typed.
-- Accounts books every factory bill in Tally as a purchase voucher, and every sales invoice is made in Tally. Each
-- voucher is the bill total with GST, rounded to the rupee: Shreeji Arts' SJ/2026-27/34 is 3,19,550 of goods,
-- 5% GST and 50 paise round off, ₹3,35,528 in Tally. So the dispatch steps no longer ask for a GST amount:
--   * the order page lists the factory's purchase bills and the buyer's invoices from Tally to pick from;
--   * GST is 5% of each style's value when it sells at ₹2,500 a piece or less, 18% above (garment rates from
--     22 Sep 2025), and the bill is checked against the Tally total;
--   * a factory bill typed in before Accounts books it is linked by itself once Tally has it.

alter table public.dispatches
  add column purchase_tally text,              -- the Tally purchase voucher (guid) of the factory's bill
  add column purchase_tally_amount numeric(14, 2);  -- its total in Tally, with GST and round off

-- GST on a garment value at a rate per piece.
create function public.garment_gst(p_value numeric, p_rate numeric) returns numeric
language sql immutable set search_path = '' as $$
  select round(p_value * case when p_rate > 2500 then 0.18 else 0.05 end, 2)
$$;

-- The supplier's bill number of a Tally purchase voucher: its reference, else its voucher number.
create function public.tally_bill_no(v public.tally_vouchers) returns text
language sql immutable set search_path = '' as $$
  select btrim(coalesce(nullif(btrim(v.reference), ''), v.number))
$$;

-- Links each live dispatch to its factory's bill in Tally, and keeps the Tally total current.
create function public.take_purchase_bills_from_tally() returns void
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
    where d2.cancelled_at is null
    order by d2.id, v.vdate desc
  ) m
  where d.id = m.id and (d.purchase_tally is distinct from m.guid or d.purchase_tally_amount is distinct from m.amount);
end $$;

create function public.take_purchase_bills_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.take_purchase_bills_from_tally();
  return null;
end $$;

create trigger tally_vouchers_purchase after insert or update on public.tally_vouchers
  for each statement execute function public.take_purchase_bills_trigger();

revoke execute on function public.take_purchase_bills_from_tally(), public.take_purchase_bills_trigger() from public, anon, authenticated;

-- The bills an order's dispatch can be made from: its factories' purchase bills and its buyer's invoices in Tally
-- from the last 120 days that no live dispatch has taken yet. For the orders team, who can't read Tally itself.
create function public.dispatch_tally_bills(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_buyer uuid;
  v_ledger text;
  v_from date := public.india_today() - 120;
begin
  select o.company_id, o.buyer_id, b.tally_ledger into v_company, v_buyer, v_ledger
  from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = p_order;
  if v_company is null or not public.can_edit_orders(v_company) then
    return jsonb_build_object('purchases', '[]'::jsonb, 'sales', '[]'::jsonb);
  end if;
  return jsonb_build_object(
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
revoke execute on function public.dispatch_tally_bills(uuid) from public, anon;
grant execute on function public.dispatch_tally_bills(uuid) to authenticated;

-- 1. Purchase. GST is worked out from the styles' values; any GST sent in is ignored.
create or replace function public.record_purchase(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_order uuid := (p ->> 'order_id')::uuid;
  v_factory uuid := (p ->> 'factory_id')::uuid;
  v_id uuid;
  v_taxable numeric;
  v_gst numeric;
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
  if exists (select 1 from public.dispatches where company_id = v_company and factory_id = v_factory and cancelled_at is null
             and lower(btrim(purchase_bill_no)) = lower(btrim(p ->> 'bill_no'))) then
    raise exception 'Bill % of this factory is already on a dispatch.', btrim(p ->> 'bill_no');
  end if;
  select sum(x.value), sum(public.garment_gst(x.value, x.rate)) into v_taxable, v_gst
  from (select (r ->> 'qty')::integer * round((r ->> 'purchase_rate')::numeric, 2) as value, round((r ->> 'purchase_rate')::numeric, 2) as rate
        from jsonb_array_elements(p -> 'lines') r) x;
  insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, purchase_gst,
                                 purchased_at, invoice_due_at, notes)
  values (v_company, v_order, v_factory, btrim(p ->> 'bill_no'), (p ->> 'bill_date')::date, round(v_taxable, 2),
          round(v_gst, 2), now(), now() + interval '4 hours', nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate, sale_rate)
  select v_id, (r ->> 'line_id')::uuid, v_company, (r ->> 'qty')::integer, round((r ->> 'purchase_rate')::numeric, 2),
         round(nullif(r ->> 'sale_rate', '')::numeric, 2)
  from jsonb_array_elements(p -> 'lines') r;
  perform public.take_purchase_bills_from_tally();
  return v_id;
end $$;

-- 2. Sales invoice. GST is worked out from the value before GST at the styles' rates. When the invoice is in Tally,
--    its total is the invoice amount, and the value here must come to it within ₹1.
create or replace function public.record_dispatch_invoice(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_buyer uuid;
  v_ledger text;
  v_inv uuid;
  v_no text := btrim(coalesce(p ->> 'invoice_no', ''));
  v_taxable numeric := nullif(p ->> 'taxable', '')::numeric;
  v_gst numeric;
  v_total numeric;
  v_tally numeric;
  v_pcs integer;
  v_sale numeric;
  v_sale_gst numeric;
  e public.invoices;
begin
  if d.invoice_id is not null then raise exception 'This dispatch already has its invoice.'; end if;
  if v_no = '' then raise exception 'Enter the invoice number.'; end if;
  if nullif(p ->> 'invoice_date', '') is null then raise exception 'Enter the invoice date.'; end if;
  if v_taxable is null or v_taxable < 0 then raise exception 'Enter the invoice value before GST.'; end if;
  select o.buyer_id, b.tally_ledger into v_buyer, v_ledger from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = d.order_id;

  -- GST at the styles' own rates when every sale rate is known, else at the rate of the average piece.
  select sum(qty), sum(qty * sale_rate), sum(public.garment_gst(qty * sale_rate, sale_rate)) filter (where sale_rate is not null)
  into v_pcs, v_sale, v_sale_gst
  from public.dispatch_lines where dispatch_id = p_id;
  if v_sale > 0 and not exists (select 1 from public.dispatch_lines where dispatch_id = p_id and sale_rate is null) then
    v_gst := round(v_taxable * v_sale_gst / v_sale, 2);
  else
    v_gst := public.garment_gst(v_taxable, v_taxable / greatest(v_pcs, 1));
  end if;
  v_total := round(v_taxable + v_gst, 2);

  select abs(v.amount) into v_tally from public.tally_vouchers v
  where v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null and v.party = v_ledger
    and lower(btrim(v.number)) = lower(v_no)
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
    values (d.company_id, v_no, v_buyer, (p ->> 'invoice_date')::date, v_total,
            d.order_id, 'From dispatch, factory bill ' || d.purchase_bill_no)
    returning id into v_inv;
  end if;
  update public.dispatches set invoice_id = v_inv, invoice_no = coalesce(e.invoice_no, v_no), invoice_taxable = round(v_taxable, 2),
    invoice_gst = v_gst, invoiced_at = now()
  where id = p_id;
end $$;

-- An order is marked shipped only once its goods are bought and billed: every style is on a dispatch with the
-- factory's bill and our invoice to the buyer, and no dispatch is still waiting for its invoice. Until now any
-- of the team could close an order as shipped with nothing in Dispatch. This holds for everyone, the owner too,
-- and on every path (Mark shipped, the order's Status, Today's tidy-up list). Orders already shipped stay so.
-- Returns why the order can't be marked shipped yet, or null when it can.
create function public.ship_blocker(p_order uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_bills text;
  v_styles text;
  v_any boolean;
begin
  select company_id into v_company from public.orders where id = p_order;
  if v_company is null or not public.is_member(v_company) then return null; end if;
  select string_agg(purchase_bill_no, ', ' order by purchased_at) into v_bills
  from public.dispatches where order_id = p_order and cancelled_at is null and invoiced_at is null;
  if v_bills is not null then
    return format('Factory bill %s has no invoice to the buyer yet. Invoice it in Dispatch, then mark the order shipped.', v_bills);
  end if;
  select exists (select 1 from public.dispatches where order_id = p_order and cancelled_at is null) into v_any;
  if not v_any then
    return 'Nothing is in Dispatch yet. Record the factory''s bill and our invoice to the buyer there, then mark the order shipped.';
  end if;
  select string_agg(l.style, ', ' order by l.style) into v_styles
  from public.order_lines l
  where l.order_id = p_order and l.removed_at is null
    and not exists (select 1 from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                    where dl.line_id = l.id and d.cancelled_at is null and d.invoiced_at is not null);
  if v_styles is not null then
    return format('%s %s no factory bill and invoice in Dispatch yet. Record them there, then mark the order shipped.',
                  v_styles, case when position(',' in v_styles) > 0 then 'have' else 'has' end);
  end if;
  return null;
end $$;
revoke execute on function public.ship_blocker(uuid) from public, anon;
grant execute on function public.ship_blocker(uuid) to authenticated;

create or replace function public.guard_ship() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_why text;
begin
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status is distinct from 'shipped') and auth.uid() is not null then
    if tg_op = 'INSERT' then
      raise exception 'A new order starts open. Mark it shipped once its factory bill and invoice are in Dispatch.'
        using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    v_why := public.ship_blocker(new.id);
    if v_why is not null then
      raise exception '%', v_why using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    if not public.is_owner(new.company_id) and not public.final_qc_passed(new.id) then
      raise exception 'Record a passed final QC before marking this order shipped.' using errcode = 'P0001', hint = 'final_qc_required';
    end if;
  end if;
  return new;
end $$;

-- Dispatches already made are linked to their Tally bills now.
select public.take_purchase_bills_from_tally();
