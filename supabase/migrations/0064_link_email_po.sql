-- A buyer's PO that came by email but was never tied to its order (Flavia sends one PDF per style, and those
-- orders were typed in by hand) can be linked to the order in one tap from the Buyer's PO card.
-- The file stays where the email put it; the order just points at it.
create function public.link_email_po_file(p_order uuid, p_incoming uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_file jsonb;
begin
  select company_id into v_company from public.orders where id = p_order;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can add the buyer''s PO.';
  end if;
  select f into v_file from public.incoming_pos i, jsonb_array_elements(i.files) f
  where i.id = p_incoming and i.company_id = v_company and f ->> 'path' = p_path;
  if v_file is null then
    raise exception 'That PO file isn''t in Incoming POs any more.';
  end if;
  if exists (select 1 from public.order_po_files where order_id = p_order and path = p_path and removed_at is null) then
    return;
  end if;
  if (select count(*) from public.order_po_files where order_id = p_order and removed_at is null) >= 20 then
    raise exception 'An order can keep up to 20 PO files. Take off old ones first.';
  end if;
  insert into public.order_po_files (company_id, order_id, path, file_name, file_type, size_bytes)
  values (v_company, p_order, p_path, left(coalesce(nullif(btrim(v_file ->> 'name'), ''), 'PO'), 200),
          coalesce(v_file ->> 'type', 'application/pdf'), greatest(coalesce((v_file ->> 'size')::integer, 1), 1));
end $$;
revoke execute on function public.link_email_po_file(uuid, uuid, text) from public, anon;
grant execute on function public.link_email_po_file(uuid, uuid, text) to authenticated;
