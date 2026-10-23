-- The factory PO in Sourcingo's own format (the Kkora Fashions sample, Oct 2026): bill-to and ship-to with our
-- GSTIN, phone and email, the vendor's address, GSTIN, phone and email, a PO number the team can set, and a
-- delivery line for split lots. The terms printed under it are the vendor agreement, summed up in the app.

alter table public.companies
  add column legal_name text check (length(legal_name) <= 120),
  add column ship_address text check (length(ship_address) <= 500),
  add column phone text check (length(phone) <= 40),
  add column email text check (length(email) <= 120);

alter table public.factories
  add column address text check (length(address) <= 500),
  add column gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  add column email text check (length(email) <= 120);
grant insert (address, gstin, email), update (address, gstin, email) on public.factories to authenticated;

alter table public.factory_pos
  add column po_no text check (length(btrim(po_no)) between 1 and 40),
  add column delivery_note text check (length(delivery_note) <= 300);
grant select (po_no, delivery_note) on public.factory_pos to authenticated;

-- PO number and delivery line on one factory's PO. Orders team only; the row must already exist (made when the
-- factory is asked for its plan), so this never starts a PO by itself.
create function public.set_factory_po_details(p_order uuid, p_factory uuid, p_po_no text, p_delivery_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_no text := nullif(btrim(p_po_no), '');
  v_note text := nullif(btrim(p_delivery_note), '');
begin
  select company_id into v_company from public.factory_pos where order_id = p_order and factory_id = p_factory;
  if v_company is null then
    raise exception 'Ask the factory for its plan first; the PO details can be set after that.';
  end if;
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can change a factory PO.';
  end if;
  if length(v_no) > 40 then raise exception 'Keep the PO number under 40 letters.'; end if;
  if length(v_note) > 300 then raise exception 'Keep the delivery line under 300 letters.'; end if;
  update public.factory_pos set po_no = v_no, delivery_note = v_note, updated_at = now()
  where order_id = p_order and factory_id = p_factory;
end $$;
revoke execute on function public.set_factory_po_details(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_factory_po_details(uuid, uuid, text, text) to authenticated;

-- Our name, addresses, phone and email as printed on factory POs. Owner only, like the challan address.
create function public.set_company_po_details(p_legal_name text, p_address text, p_ship_address text, p_gstin text, p_phone text, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_gstin text := nullif(upper(btrim(p_gstin)), '');
begin
  if v_company is null or not public.is_owner(v_company) then
    raise exception 'Only the owner can change the company''s details.';
  end if;
  if length(p_address) > 500 or length(p_ship_address) > 500 then
    raise exception 'Keep each address under 500 letters.';
  end if;
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'That GSTIN doesn''t look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5.';
  end if;
  update public.companies set
    legal_name = nullif(btrim(p_legal_name), ''),
    address = nullif(btrim(p_address), ''),
    ship_address = nullif(btrim(p_ship_address), ''),
    gstin = v_gstin,
    phone = nullif(btrim(p_phone), ''),
    email = nullif(lower(btrim(p_email)), '')
  where id = v_company;
end $$;
revoke execute on function public.set_company_po_details(text, text, text, text, text, text) from public, anon;
grant execute on function public.set_company_po_details(text, text, text, text, text, text) to authenticated;
