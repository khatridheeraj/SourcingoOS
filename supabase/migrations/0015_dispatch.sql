-- Dispatch: from the factory's goods to the buyer's GRN, one step after another.
--   1. Purchase: the factory's bill for the goods (kept in full so it can go to Tally later).
--   2. Sales invoice to the buyer, within 4 hours of the purchase, else it is an emergency.
--   3. E-way bill for the invoice.
--   4. Shipping: photos of the goods, transporter and vehicle, and the LR (number and copy) are all required.
--   5. GRN: the buyer's goods received note, due within the buyer's GRN days of shipping.
-- Each step needs the one before it. The orders team does all of it; nothing is deleted, a wrong dispatch is cancelled.

alter table public.buyers add column grn_days integer check (grn_days between 0 and 120);

create table public.dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  factory_id uuid not null,
  -- 1. Purchase
  purchase_bill_no text not null check (btrim(purchase_bill_no) <> ''),
  purchase_bill_date date not null,
  purchase_taxable numeric(14, 2) not null check (purchase_taxable >= 0),
  purchase_gst numeric(14, 2) not null default 0 check (purchase_gst >= 0),
  purchased_at timestamptz not null default now(),
  invoice_due_at timestamptz not null,
  -- 2. Sales invoice (the row in Payments)
  invoice_id uuid,
  invoice_no text,
  invoice_taxable numeric(14, 2) check (invoice_taxable >= 0),
  invoice_gst numeric(14, 2) check (invoice_gst >= 0),
  invoiced_at timestamptz,
  -- 3. E-way bill
  eway_bill_no text,
  eway_bill_date date,
  eway_valid_until date,
  eway_path text,
  eway_at timestamptz,
  -- 4. Shipping
  transporter text,
  vehicle_no text,
  lr_no text,
  lr_date date,
  lr_path text,
  cartons integer check (cartons > 0),
  shipped_at timestamptz,
  grn_due_on date,
  -- 5. GRN
  grn_path text,
  grn_received_qty integer check (grn_received_qty >= 0),
  grn_notes text,
  grn_at timestamptz,
  notes text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id),
  foreign key (company_id, invoice_id) references public.invoices (company_id, id),
  check (cancelled_at is null or btrim(coalesce(cancel_reason, '')) <> ''),
  check (invoiced_at is null or invoice_id is not null),
  check (eway_at is null or invoiced_at is not null),
  check (shipped_at is null or (eway_at is not null and lr_path is not null and btrim(coalesce(lr_no, '')) <> '')),
  check (grn_at is null or (shipped_at is not null and grn_path is not null))
);
create unique index dispatches_company_id_key on public.dispatches (company_id, id);
create unique index dispatches_bill_key on public.dispatches (company_id, factory_id, lower(btrim(purchase_bill_no))) where cancelled_at is null;
create unique index dispatches_invoice_key on public.dispatches (invoice_id) where invoice_id is not null;
create index dispatches_order_idx on public.dispatches (order_id);

-- What was bought and sold on each dispatch, style by style.
create table public.dispatch_lines (
  dispatch_id uuid not null references public.dispatches (id),
  line_id uuid not null references public.order_lines (id),
  company_id uuid not null references public.companies (id),
  qty integer not null check (qty > 0),
  purchase_rate numeric(12, 2) not null check (purchase_rate >= 0),
  sale_rate numeric(12, 2) check (sale_rate >= 0),
  primary key (dispatch_id, line_id)
);

-- Photos of the packed goods, taken before they leave.
create table public.dispatch_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  dispatch_id uuid not null references public.dispatches (id),
  path text not null,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index dispatch_photos_idx on public.dispatch_photos (dispatch_id);

create trigger dispatches_touch before update on public.dispatches for each row execute function public.touch_updated_at();
create trigger dispatches_history after insert or update or delete on public.dispatches for each row execute function public.record_history();

alter table public.dispatches enable row level security;
alter table public.dispatch_lines enable row level security;
alter table public.dispatch_photos enable row level security;
revoke all on public.dispatches, public.dispatch_lines, public.dispatch_photos from anon, authenticated;
grant select on public.dispatches, public.dispatch_lines, public.dispatch_photos to authenticated;
create policy dispatches_read on public.dispatches for select to authenticated using (public.can_edit_orders(company_id));
create policy dispatch_lines_read on public.dispatch_lines for select to authenticated using (public.can_edit_orders(company_id));
create policy dispatch_photos_read on public.dispatch_photos for select to authenticated using (public.can_edit_orders(company_id));

-- The owner sets each buyer's GRN days on the Buyers page.
create function public.set_buyer_grn_days(p_buyer uuid, p_days integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(public.current_company()) then
    raise exception 'Only the owner can set GRN days.';
  end if;
  if p_days is not null and (p_days < 0 or p_days > 120) then
    raise exception 'Use 0 to 120 days.';
  end if;
  update public.buyers set grn_days = p_days where id = p_buyer and company_id = public.current_company();
end $$;

-- The dispatch, locked, after checking the person may work on it. Shared by the steps below.
create function public.dispatch_for_step(p_id uuid) returns public.dispatches
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches;
begin
  select * into d from public.dispatches where id = p_id for update;
  if d.id is null or not public.can_edit_orders(d.company_id) then
    raise exception 'Only the orders team can record dispatches.';
  end if;
  if d.cancelled_at is not null then
    raise exception 'This dispatch is cancelled.';
  end if;
  return d;
end $$;

-- 1. Purchase. p: {order_id, factory_id, bill_no, bill_date, gst, notes, lines: [{line_id, qty, purchase_rate, sale_rate}]}
create function public.record_purchase(p jsonb) returns uuid
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
  select sum((r ->> 'qty')::integer * (r ->> 'purchase_rate')::numeric) into v_taxable from jsonb_array_elements(p -> 'lines') r;
  insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, purchase_gst,
                                 purchased_at, invoice_due_at, notes)
  values (v_company, v_order, v_factory, btrim(p ->> 'bill_no'), (p ->> 'bill_date')::date, round(v_taxable, 2),
          coalesce(nullif(p ->> 'gst', '')::numeric, 0), now(), now() + interval '4 hours', nullif(btrim(p ->> 'notes'), ''))
  returning id into v_id;
  insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate, sale_rate)
  select v_id, (r ->> 'line_id')::uuid, v_company, (r ->> 'qty')::integer, (r ->> 'purchase_rate')::numeric, nullif(r ->> 'sale_rate', '')::numeric
  from jsonb_array_elements(p -> 'lines') r;
  return v_id;
end $$;

-- 2. Sales invoice. Adds it to Payments too. p: {invoice_no, invoice_date, taxable, gst}
create function public.record_dispatch_invoice(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_buyer uuid;
  v_days integer;
  v_inv uuid;
  v_taxable numeric := nullif(p ->> 'taxable', '')::numeric;
  v_gst numeric := coalesce(nullif(p ->> 'gst', '')::numeric, 0);
begin
  if d.invoice_id is not null then raise exception 'This dispatch already has its invoice.'; end if;
  if btrim(coalesce(p ->> 'invoice_no', '')) = '' then raise exception 'Enter the invoice number.'; end if;
  if nullif(p ->> 'invoice_date', '') is null then raise exception 'Enter the invoice date.'; end if;
  if v_taxable is null or v_taxable < 0 or v_gst < 0 then raise exception 'Enter the invoice value and GST.'; end if;
  select o.buyer_id, b.credit_days into v_buyer, v_days from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = d.order_id;
  insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes)
  values (d.company_id, btrim(p ->> 'invoice_no'), v_buyer, (p ->> 'invoice_date')::date, round(v_taxable + v_gst, 2),
          (p ->> 'invoice_date')::date + v_days, d.order_id, 'From dispatch, factory bill ' || d.purchase_bill_no)
  returning id into v_inv;
  update public.dispatches set invoice_id = v_inv, invoice_no = btrim(p ->> 'invoice_no'), invoice_taxable = round(v_taxable, 2), invoice_gst = round(v_gst, 2), invoiced_at = now()
  where id = p_id;
end $$;

-- 3. E-way bill. p: {no, date, valid_until, path}
create function public.record_eway_bill(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
begin
  if d.invoiced_at is null then raise exception 'Make the invoice first.'; end if;
  if d.shipped_at is not null then raise exception 'The goods have shipped, so the e-way bill is fixed.'; end if;
  if (p ->> 'no') !~ '^\s*\d{12}\s*$' then raise exception 'An e-way bill number has 12 digits.'; end if;
  if nullif(p ->> 'date', '') is null then raise exception 'Enter the e-way bill date.'; end if;
  if nullif(p ->> 'path', '') is null then raise exception 'Attach the e-way bill.'; end if;
  update public.dispatches set eway_bill_no = btrim(p ->> 'no'), eway_bill_date = (p ->> 'date')::date,
    eway_valid_until = nullif(p ->> 'valid_until', '')::date, eway_path = p ->> 'path', eway_at = now()
  where id = p_id;
end $$;

-- 4. Shipping. p: {transporter, vehicle_no, lr_no, lr_date, lr_path, cartons, photos: [path]}
create function public.record_shipping(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_days integer;
  v_lr date := nullif(p ->> 'lr_date', '')::date;
begin
  if d.eway_at is null then raise exception 'Add the e-way bill first.'; end if;
  if d.shipped_at is not null then raise exception 'This dispatch has already shipped.'; end if;
  if btrim(coalesce(p ->> 'transporter', '')) = '' then raise exception 'Enter the transporter.'; end if;
  if btrim(coalesce(p ->> 'lr_no', '')) = '' or v_lr is null then raise exception 'Enter the LR number and date.'; end if;
  if nullif(p ->> 'lr_path', '') is null then raise exception 'Attach the LR copy.'; end if;
  if jsonb_typeof(p -> 'photos') is distinct from 'array' or jsonb_array_length(p -> 'photos') = 0 then
    raise exception 'Add photos of the goods.';
  end if;
  select b.grn_days into v_days from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = d.order_id;
  insert into public.dispatch_photos (company_id, dispatch_id, path)
  select d.company_id, p_id, value from jsonb_array_elements_text(p -> 'photos');
  update public.dispatches set transporter = btrim(p ->> 'transporter'), vehicle_no = nullif(upper(btrim(p ->> 'vehicle_no')), ''),
    lr_no = btrim(p ->> 'lr_no'), lr_date = v_lr, lr_path = p ->> 'lr_path', cartons = nullif(p ->> 'cartons', '')::integer,
    shipped_at = now(), grn_due_on = v_lr + coalesce(v_days, 7)
  where id = p_id;
end $$;

-- 5. GRN. p: {path, received_qty, notes}
create function public.record_grn(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
begin
  if d.shipped_at is null then raise exception 'Record the shipping first.'; end if;
  if d.grn_at is not null then raise exception 'The GRN is already in.'; end if;
  if nullif(p ->> 'path', '') is null then raise exception 'Attach the GRN report.'; end if;
  if nullif(p ->> 'received_qty', '') is null then raise exception 'Enter the pieces the buyer received.'; end if;
  update public.dispatches set grn_path = p ->> 'path', grn_received_qty = (p ->> 'received_qty')::integer,
    grn_notes = nullif(btrim(p ->> 'notes'), ''), grn_at = now()
  where id = p_id;
end $$;

-- A dispatch entered by mistake is cancelled before it is invoiced; after that, cancel the invoice in Payments first.
create function public.cancel_dispatch(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why this dispatch is being cancelled.'; end if;
  if d.invoice_id is not null and not exists (select 1 from public.invoices where id = d.invoice_id and cancelled_at is not null) then
    raise exception 'This dispatch has an invoice. Cancel the invoice in Payments first.';
  end if;
  update public.dispatches set cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_id;
end $$;

revoke execute on function public.dispatch_for_step(uuid) from public, anon, authenticated;
revoke execute on function public.set_buyer_grn_days(uuid, integer), public.record_purchase(jsonb), public.record_dispatch_invoice(uuid, jsonb),
  public.record_eway_bill(uuid, jsonb), public.record_shipping(uuid, jsonb), public.record_grn(uuid, jsonb), public.cancel_dispatch(uuid, text)
  from public, anon;
grant execute on function public.set_buyer_grn_days(uuid, integer), public.record_purchase(jsonb), public.record_dispatch_invoice(uuid, jsonb),
  public.record_eway_bill(uuid, jsonb), public.record_shipping(uuid, jsonb), public.record_grn(uuid, jsonb), public.cancel_dispatch(uuid, text)
  to authenticated;
