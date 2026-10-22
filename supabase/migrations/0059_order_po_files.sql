-- The buyer's own PO (usually a PDF) kept on every order. A PO that came in by email or was added on Incoming POs
-- already brings its files; these are the ones the team adds by hand, for orders typed in or loaded before pickup.
-- Files live in the private "po-files" bucket at <company>/<order>/<random>.<ext>, open to the orders team only
-- (the PO carries the buyer's rates, so factories, buyers and Quality never see it).

create table public.order_po_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  file_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index order_po_files_order_idx on public.order_po_files (order_id, created_at);
alter table public.order_po_files enable row level security;
revoke all on public.order_po_files from public, anon, authenticated;
grant select on public.order_po_files to authenticated;
grant all on public.order_po_files to service_role;
create policy order_po_files_read on public.order_po_files for select to authenticated using (public.can_edit_orders(company_id));

-- Adds uploaded PO files to an order.
create function public.add_order_po_files(p_order uuid, p_files jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.orders where id = p_order;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can add the buyer''s PO.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'Pick the PO file first.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) f
             where (f ->> 'path') not like v_company || '/' || p_order || '/%' or (f ->> 'path') like '%..%'
                or coalesce(f ->> 'type', '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv',
                     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) then
    raise exception 'That file didn''t upload properly. Try again.';
  end if;
  if (select count(*) from public.order_po_files where order_id = p_order and removed_at is null) + jsonb_array_length(p_files) > 20 then
    raise exception 'An order can keep up to 20 PO files. Take off old ones first.';
  end if;
  insert into public.order_po_files (company_id, order_id, path, file_name, file_type, size_bytes)
  select v_company, p_order, f ->> 'path', left(coalesce(nullif(btrim(f ->> 'name'), ''), 'PO'), 200), f ->> 'type', (f ->> 'size')::integer
  from jsonb_array_elements(p_files) f;
end $$;
revoke execute on function public.add_order_po_files(uuid, jsonb) from public, anon;
grant execute on function public.add_order_po_files(uuid, jsonb) to authenticated;

-- Takes a PO file off an order. It stays in storage and in the activity log.
create function public.remove_order_po_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.order_po_files where id = p_id and removed_at is null;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can take a PO file off.';
  end if;
  update public.order_po_files set removed_at = now(), removed_by = auth.uid() where id = p_id and removed_at is null;
end $$;
revoke execute on function public.remove_order_po_file(uuid) from public, anon;
grant execute on function public.remove_order_po_file(uuid) to authenticated;

-- Which of these orders have the buyer's PO on file (from email, Incoming POs or added by hand), for the order lists.
create function public.orders_with_po_file(p_orders uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.order_id), '{}')
  from (
    select order_id from public.incoming_pos
    where order_id = any (p_orders) and jsonb_array_length(files) > 0 and public.can_edit_orders(company_id)
    union all
    select order_id from public.order_po_files
    where order_id = any (p_orders) and removed_at is null and public.can_edit_orders(company_id)
  ) x
$$;
revoke execute on function public.orders_with_po_file(uuid[]) from public, anon;
grant execute on function public.orders_with_po_file(uuid[]) to authenticated;
