-- Files (tech packs, cutting programs, photos, QC reports) in Supabase
-- Storage, and what the factory and buyer portals need.
--
-- Files: a row in `files` is written first, then the object is uploaded to
-- the private `files` bucket at the same path. Storage rules follow the row,
-- so who may see or add a file is decided in one place: the `files` policies.
-- Paths look like style/<style id>/<random>/<file name>.

-- ───────────────────────── files ─────────────────────────
alter table files drop constraint files_mime_type_check;
alter table files add constraint files_mime_type_check check (mime_type in (
  'image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'));
alter table files drop constraint files_size_bytes_check;
alter table files add constraint files_size_bytes_check check (size_bytes > 0 and size_bytes <= 25 * 1024 * 1024);
create index files_style_idx on files (style_id) where style_id is not null;
create index files_grn_idx on files (grn_id) where grn_id is not null;
create index files_inquiry_idx on files (inquiry_id) where inquiry_id is not null;

-- The path must sit under what the file is attached to, the category must fit,
-- and the uploader is always the signed-in person. Files are never edited.
create function guard_file() returns trigger
  language plpgsql set search_path = public as $$
declare v_prefix text; v_ok file_category[];
begin
  if tg_op = 'UPDATE' then raise exception 'Files can''t be changed. Delete it and upload again.'; end if;
  if new.inquiry_id is not null then
    v_prefix := 'inquiry/' || new.inquiry_id; v_ok := '{inquiry_image,other}';
  elsif new.style_id is not null then
    v_prefix := 'style/' || new.style_id; v_ok := '{tech_pack,cutting_program,style_photo,qc_report,other}';
  else
    v_prefix := 'grn/' || new.grn_id; v_ok := '{grn_photo,qc_report,other}';
  end if;
  if left(new.storage_path, length(v_prefix) + 1) <> v_prefix || '/' or new.storage_path !~ '^[^/]+/[^/]+/[^/]+/[^/]+$' then
    raise exception 'File path does not match what it is attached to.';
  end if;
  if not new.category = any(v_ok) then raise exception 'That kind of file can''t be attached here.'; end if;
  new.uploaded_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger guard_file before insert or update on files for each row execute function guard_file();

-- Factories see the files of their own orders once those are sent for the
-- TNA lock, and add production photos while an order is running.
create function factory_style_access(p_style uuid, p_running boolean default false) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from so_styles s join sales_orders o on o.id = s.so_id
                  where s.id = p_style and o.factory_id = my_factory_id()
                    and o.status = any(case when p_running then '{locked}'::so_status[] else '{tna_review,locked,shipped}'::so_status[] end))
$$;

create policy "internal read files" on files for select using ((select is_internal()));
create policy "factory read order files" on files for select
  using (style_id is not null and category in ('tech_pack','cutting_program','style_photo','qc_report') and factory_style_access(style_id));
create policy "factory add photos" on files for insert
  with check (style_id is not null and category = 'style_photo' and factory_style_access(style_id, true));
create policy "factory delete own photos" on files for delete
  using (style_id is not null and category = 'style_photo' and uploaded_by = auth.uid() and factory_style_access(style_id, true));

-- Storage follows the files table (deleting mirrors the delete policies above).
create function can_read_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from files f where f.storage_path = p_name and (
    is_internal() or f.uploaded_by = auth.uid()
    or (f.style_id is not null and f.category in ('tech_pack','cutting_program','style_photo','qc_report') and factory_style_access(f.style_id))))
$$;
create function can_upload_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from files f where f.storage_path = p_name and f.uploaded_by = auth.uid())
$$;
create function can_delete_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_ops() or exists (select 1 from files f where f.storage_path = p_name and f.uploaded_by = auth.uid()
                                and f.category = 'style_photo' and factory_style_access(f.style_id, true))
$$;
grant execute on function factory_style_access(uuid, boolean), can_read_object(text), can_upload_object(text), can_delete_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 25 * 1024 * 1024, array[
  'image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "sourcingo read files" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.can_read_object(name));
create policy "sourcingo upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.can_upload_object(name));
create policy "sourcingo delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.can_delete_object(name));

-- ───────────────────────── checkpoint notes ─────────────────────────
-- A short reason travels with each status change, so "Delayed" always says why.
alter table tna_checkpoints add column status_note text;
alter table tna_status_history add column note text;

create function set_checkpoint_status(p_checkpoint uuid, p_status tna_status, p_note text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_old tna_status; v_old_note text; v_so text; v_factory uuid; v_so_status so_status;
        v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select c.status, c.status_note, s.so_id, o.factory_id, o.status into v_old, v_old_note, v_so, v_factory, v_so_status
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where c.id = p_checkpoint;
  if not found then raise exception 'Checkpoint not found.'; end if;
  if not (is_ops() or (my_role() = 'factory' and my_factory_id() = v_factory)) then
    raise exception 'You do not have access to this order.';
  end if;
  if v_so_status <> 'locked' then raise exception 'Status can only be updated after the TNA is locked.'; end if;
  if p_status = 'delayed' and v_note is null and not is_ops() then
    raise exception 'Say why it is delayed, so Sourcingo can plan around it.';
  end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  if v_old = p_status and v_old_note is not distinct from v_note then return; end if;
  update tna_checkpoints set status = p_status, status_note = v_note, status_updated_at = now(), status_updated_by = auth.uid()
   where id = p_checkpoint;
  insert into tna_status_history (checkpoint_id, from_status, to_status, changed_by, note)
    values (p_checkpoint, v_old, p_status, auth.uid(), v_note);
end $$;
-- The two-argument form keeps working and simply carries no note.
create or replace function set_checkpoint_status(p_checkpoint uuid, p_status tna_status) returns void
  language sql security definer set search_path = public as $$ select set_checkpoint_status(p_checkpoint, p_status, null::text) $$;
grant execute on function set_checkpoint_status(uuid, tna_status, text), set_checkpoint_status(uuid, tna_status) to authenticated;

-- ───────────────────────── portals ─────────────────────────
create or replace view portal_factory_checkpoints as
  select c.id, c.style_id, s.so_id, c.position, c.name, c.due_date, c.status, c.status_updated_at, c.status_note
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');

create or replace view portal_factory_orders as
  select o.id, b.code as buyer_code, o.order_type, o.so_date, o.factory_date, o.status, o.locked_at, o.terms, o.currency
    from sales_orders o join buyers b on b.id = o.buyer_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');

create or replace view portal_buyer_orders as
  select o.id, o.buyer_po_number, o.so_date, o.buyer_date, o.currency,
         case
           when o.status = 'shipped' then 'Shipped'
           when o.status <> 'locked' then 'Order confirmed'
           else coalesce((
             select case when c.name ~* 'qc|inspect|quality' then 'QC'
                         when c.name ~* 'pack' then 'Packing'
                         when c.name ~* 'dispatch|ship' then 'Ready to ship'
                         else 'Production' end
               from tna_checkpoints c join so_styles s on s.id = c.style_id
              where s.so_id = o.id and c.status <> 'completed'
              order by c.due_date nulls last, c.position limit 1), 'Ready to ship')
         end as milestone,
         o.order_type
    from sales_orders o
   where o.buyer_id = my_buyer_id() and o.status <> 'draft';

create or replace view portal_buyer_styles as
  select s.id, s.so_id, s.name, s.code, s.colour, s.qty, s.buyer_rate, s.position, s.use_sizes, s.sizes
    from so_styles s join sales_orders o on o.id = s.so_id
   where o.buyer_id = my_buyer_id() and o.status <> 'draft';

-- The signed-in factory's own name.
create view portal_factory_profile as
  select f.id, f.name, f.city from factories f where f.id = my_factory_id();

-- What Sourcingo has received from the factory (submitted GRNs only).
create view portal_factory_receipts as
  select g.id as grn_id, g.so_id, g.received_at, g.status, l.style_id, l.qty, l.condition
    from grns g join grn_lines l on l.grn_id = g.id join sales_orders o on o.id = g.so_id
   where o.factory_id = my_factory_id() and g.status in ('pending_approval','approved');

-- The signed-in buyer's own code.
create view portal_buyer_profile as
  select b.id, b.code from buyers b where b.id = my_buyer_id();

revoke all on portal_factory_checkpoints, portal_factory_profile, portal_factory_receipts, portal_buyer_profile from anon;
grant select on portal_factory_checkpoints, portal_factory_profile, portal_factory_receipts, portal_buyer_profile to authenticated;
