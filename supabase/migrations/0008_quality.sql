-- Quality: a separate role for the QC team, and photos on QC checks.
-- Only Quality people (and the owner) record, cancel and photograph QC checks; everyone else sees them.
-- Quality people see orders but can't change orders, production or factories.

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality'));
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality'));

-- Records QC: the Quality team and the owner.
create function public.is_quality(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role(p_company) in ('owner', 'quality'), false) $$;

-- Changes orders, production and factories: everyone except Quality.
create function public.can_edit_orders(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role(p_company) in ('owner', 'manager', 'merchandiser', 'accounts'), false) $$;

revoke execute on function public.is_quality(uuid), public.can_edit_orders(uuid) from public, anon;
grant execute on function public.is_quality(uuid), public.can_edit_orders(uuid) to authenticated;

alter policy orders_insert on public.orders with check (public.can_edit_orders(company_id));
alter policy orders_update on public.orders using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));
alter policy order_lines_insert on public.order_lines with check (public.can_edit_orders(company_id));
alter policy order_lines_update on public.order_lines using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));
alter policy factories_insert on public.factories with check (public.can_edit_orders(company_id));
alter policy factories_update on public.factories using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));

alter policy qc_checks_insert on public.qc_checks
  with check (public.is_quality(company_id) and checked_by = auth.uid() and cancelled_at is null);
alter policy qc_checks_update on public.qc_checks using (public.is_quality(company_id)) with check (public.is_quality(company_id));

-- Photos on a QC check. Files live in the private "order-photos" storage bucket under
-- <company>/<order>/qc/<check>/<file>; this table lists them so a photo can be taken
-- off a check (removed_at) without ever deleting the file.
create table public.qc_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  qc_id uuid not null references public.qc_checks (id),
  path text not null unique,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint qc_photos_path_in_company check (split_part(path, '/', 1) = company_id::text)
);
create index qc_photos_qc_idx on public.qc_photos (qc_id) where removed_at is null;

create trigger qc_photos_history after insert or update or delete on public.qc_photos
  for each row execute function public.record_history();

alter table public.qc_photos enable row level security;
revoke all on public.qc_photos from anon, authenticated;
grant select, insert, update (removed_at) on public.qc_photos to authenticated;
create policy qc_photos_read on public.qc_photos for select to authenticated using (public.is_member(company_id));
create policy qc_photos_insert on public.qc_photos for insert to authenticated
  with check (public.is_quality(company_id) and created_by = auth.uid() and removed_at is null
              and exists (select 1 from public.qc_checks q where q.id = qc_id and q.company_id = qc_photos.company_id));
create policy qc_photos_update on public.qc_photos for update to authenticated
  using (public.is_quality(company_id)) with check (public.is_quality(company_id));

-- True when the signed-in person belongs to the company a storage folder is named after.
-- Folders in other buckets aren't company ids, so anything that isn't one simply answers no.
create function public.is_member_folder(p_folder text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return public.is_member(p_folder::uuid);
exception when invalid_text_representation then
  return false;
end $$;

-- Who may add a file at this storage path (<company>/<order>/<kind>/...): QC photos need Quality.
create function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[3] = 'qc' then
    return public.is_quality(v_company);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.is_member_folder(text), public.can_upload_photo(text) from public, anon;
grant execute on function public.is_member_folder(text), public.can_upload_photo(text) to authenticated;

-- The bucket and its rules exist only on Supabase (plain Postgres in the tests has no storage schema).
-- Members of a company can view files under their company's folder; nobody can change or remove them.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('order-photos', 'order-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "order photos read" on storage.objects for select to authenticated
      using (bucket_id = 'order-photos' and public.is_member_folder((storage.foldername(name))[1]))$p$;
    execute $p$create policy "order photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'order-photos' and public.can_upload_photo(name))$p$;
  end if;
end $$;

-- QC stages: inline, mid-line, final, and a re-check after a failed final. A re-check counts as the final for shipping.
alter table public.qc_checks drop constraint qc_checks_kind_check;
alter table public.qc_checks add constraint qc_checks_kind_check check (kind in ('inline', 'midline', 'final', 'recheck'));

create or replace function public.final_qc_passed(p_order uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select result = 'pass' from public.qc_checks
                   where order_id = p_order and kind in ('final', 'recheck') and cancelled_at is null
                   order by checked_on desc, created_at desc limit 1), false)
$$;
