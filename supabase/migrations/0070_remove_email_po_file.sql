-- A buyer's PO file that came with the email can be taken off its order too (Dheeraj, 26 Oct 2026: Zolo Label's old
-- "PO FORMATE" sheets stayed on SO-0018/19 after the revised PO-1/PO-2 PDFs were added). The email and its files are
-- never changed: the order just stops showing the file. The path goes on incoming_pos.off_order, and the activity
-- log records who did it.

alter table public.incoming_pos add column off_order text[] not null default '{}';
grant select (off_order) on public.incoming_pos to authenticated;

-- Files of an incoming PO still shown on its order.
create function public.incoming_files_on_order(p_files jsonb, p_off text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(p_files) f where not (f ->> 'path' = any (p_off))
$$;

create function public.remove_email_po_file(p_incoming uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select i.company_id into v_company from public.incoming_pos i
  where i.id = p_incoming and i.order_id is not null and exists (select 1 from jsonb_array_elements(i.files) f where f ->> 'path' = p_path);
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can take a PO file off.';
  end if;
  update public.incoming_pos set off_order = array_append(off_order, p_path)
  where id = p_incoming and not (p_path = any (off_order));
end $$;
revoke execute on function public.remove_email_po_file(uuid, text) from public, anon;
grant execute on function public.remove_email_po_file(uuid, text) to authenticated;

-- A file taken off no longer counts as the buyer's PO being on file.
create or replace function public.orders_with_po_file(p_orders uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.order_id), '{}')
  from (
    select order_id from public.incoming_pos
    where order_id = any (p_orders) and jsonb_array_length(public.incoming_files_on_order(files, off_order)) > 0 and public.can_edit_orders(company_id)
    union all
    select order_id from public.order_po_files
    where order_id = any (p_orders) and removed_at is null and public.can_edit_orders(company_id)
  ) x
$$;

create or replace function public.order_has_buyer_po(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.incoming_pos where order_id = p_order and jsonb_array_length(public.incoming_files_on_order(files, off_order)) > 0)
      or exists (select 1 from public.order_po_files where order_id = p_order and removed_at is null)
$$;
