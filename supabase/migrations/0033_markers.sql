-- Markers: MarkerPilot (fabric consumption and CAD markers) inside the OS, for the orders team.
-- Saved styles are shared by the whole company. Reading photos with AI uses the company's AI key
-- (the one the owner pasted on the Incoming POs page) and runs on Supabase (supabase/functions/marker-reader).

-- ---------------------------------------------------------------- saved styles
-- One row per saved version of a style. MarkerPilot names the version (doc_id) and owns the data inside.
create table public.marker_styles (
  company_id uuid not null default public.current_company() references public.companies (id),
  doc_id text not null check (doc_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1048576),
  saved_by uuid default auth.uid() references public.profiles (id),
  saved_at timestamptz not null default now(),
  primary key (company_id, doc_id)
);
alter table public.marker_styles enable row level security;
create policy marker_styles_read on public.marker_styles for select to authenticated using (public.can_edit_orders(company_id));
create policy marker_styles_insert on public.marker_styles for insert to authenticated with check (public.can_edit_orders(company_id));
create policy marker_styles_update on public.marker_styles for update to authenticated
  using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));
revoke all on public.marker_styles from public, anon, authenticated;
grant select, insert, update on public.marker_styles to authenticated;

-- Who saved a version, and when, is set here; a version stays in its company under its name.
create function public.stamp_marker_style() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.doc_id := old.doc_id;
  end if;
  new.saved_by := auth.uid();
  new.saved_at := now();
  return new;
end $$;
create trigger marker_styles_stamp before insert or update on public.marker_styles for each row execute function public.stamp_marker_style();

-- ---------------------------------------------------------------- photo readings
-- A reading: the prompt MarkerPilot wrote, then its photos in parts (each request stays under the size limit).
-- The reader fills in the result or the error. Photos are deleted once read.
create table public.marker_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  prompt text not null check (length(btrim(prompt)) > 0 and length(prompt) <= 200000),
  status text not null default 'uploading' check (status in ('uploading', 'reading', 'batch', 'done', 'error')),
  batch_id text,
  result jsonb,
  error_code text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Readings are working files, not business records: they stay out of the activity history.
drop trigger if exists marker_jobs_history on public.marker_jobs;
create index marker_jobs_open on public.marker_jobs (created_at) where status in ('uploading', 'reading', 'batch');

create table public.marker_job_parts (
  job_id uuid not null references public.marker_jobs (id) on delete cascade,
  part int not null check (part between 0 and 40),
  files jsonb not null check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 1 and 100),
  primary key (job_id, part)
);

alter table public.marker_jobs enable row level security;
alter table public.marker_job_parts enable row level security;
-- The orders team sees its company's readings; each person starts their own.
create policy marker_jobs_read on public.marker_jobs for select to authenticated using (public.can_edit_orders(company_id));
create policy marker_jobs_insert on public.marker_jobs for insert to authenticated
  with check (public.can_edit_orders(company_id) and created_by = auth.uid() and status = 'uploading'
              and batch_id is null and result is null and error is null and error_code is null and finished_at is null);
-- Photos go only into a reading of your own that is still uploading. Nobody in the app reads them back.
create policy marker_job_parts_insert on public.marker_job_parts for insert to authenticated
  with check (exists (select 1 from public.marker_jobs j where j.id = job_id and j.created_by = auth.uid()
                      and j.status = 'uploading' and public.can_edit_orders(j.company_id)));

revoke all on public.marker_jobs, public.marker_job_parts from public, anon, authenticated;
grant select (id, company_id, created_by, status, result, error_code, error, created_at, finished_at) on public.marker_jobs to authenticated;
grant insert (prompt) on public.marker_jobs to authenticated;
grant insert (job_id, part, files) on public.marker_job_parts to authenticated;

-- Readings and their photos older than a day are cleared whenever a new reading starts.
create function public.clear_old_marker_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.marker_jobs where created_at < now() - interval '1 day';
  return new;
end $$;
revoke execute on function public.clear_old_marker_jobs() from public, anon, authenticated;
create trigger marker_jobs_clear_old after insert on public.marker_jobs for each statement execute function public.clear_old_marker_jobs();
