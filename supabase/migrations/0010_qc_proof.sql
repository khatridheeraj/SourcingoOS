-- QC proof: every check is saved with its photos (at least one) and any report files in one step.
-- Sampling stages join the production checks, and anyone in the company can comment on a check.

alter table public.qc_checks drop constraint qc_checks_kind_check;
alter table public.qc_checks add constraint qc_checks_kind_check check (kind in (
  'greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set', 'inline', 'midline', 'final', 'recheck'));

-- qc_photos now holds every file on a check: photos, and reports such as PDFs or spreadsheets.
alter table public.qc_photos
  add column kind text not null default 'photo' check (kind in ('photo', 'report')),
  add column file_name text;

-- Records a check together with its files. A check without a photo is refused.
-- p: {id, kind, checked_on, result, pieces_checked, defects, notes}; p_files: [{path, kind, file_name}, ...]
create function public.record_qc(p_order uuid, p jsonb, p_files jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_quality(public.current_company()) then
    raise exception 'Only the Quality team records QC.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(p_files) f where f ->> 'kind' = 'photo') then
    raise exception 'Add at least one photo as proof of the check.';
  end if;
  insert into public.qc_checks (id, order_id, kind, checked_on, result, pieces_checked, defects, notes)
  values (v_id, p_order, p ->> 'kind', coalesce(nullif(p ->> 'checked_on', '')::date, public.india_today()), p ->> 'result',
          nullif(p ->> 'pieces_checked', '')::integer, coalesce(nullif(p ->> 'defects', '')::integer, 0), nullif(btrim(p ->> 'notes'), ''));
  insert into public.qc_photos (qc_id, path, kind, file_name)
  select v_id, f ->> 'path', coalesce(f ->> 'kind', 'photo'), nullif(btrim(f ->> 'file_name'), '')
  from jsonb_array_elements(p_files) f;
  return v_id;
end $$;
revoke execute on function public.record_qc(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.record_qc(uuid, jsonb, jsonb) to authenticated;

-- Comments on a check: everyone in the company can read and add; nobody can change or remove one.
create table public.qc_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  qc_id uuid not null references public.qc_checks (id),
  body text not null check (btrim(body) <> '' and length(body) <= 2000),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index qc_comments_qc_idx on public.qc_comments (qc_id, created_at);

create trigger qc_comments_history after insert or update or delete on public.qc_comments
  for each row execute function public.record_history();

alter table public.qc_comments enable row level security;
revoke all on public.qc_comments from anon, authenticated;
grant select, insert on public.qc_comments to authenticated;
create policy qc_comments_read on public.qc_comments for select to authenticated using (public.is_member(company_id));
create policy qc_comments_insert on public.qc_comments for insert to authenticated
  with check (public.is_member(company_id) and created_by = auth.uid()
              and exists (select 1 from public.qc_checks q where q.id = qc_id and q.company_id = qc_comments.company_id));

-- Reports can be PDFs, spreadsheets or documents, up to 10 MB.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    where id = 'order-photos';
  end if;
end $$;
