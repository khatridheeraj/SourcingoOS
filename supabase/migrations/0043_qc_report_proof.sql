-- A QC check is proven by its signed QC report, which decides whether the goods move on (Dheeraj, 20 Oct 2026).
-- Photos stay welcome but are no longer required when the report is attached; a check still needs at least one file.
create or replace function public.record_qc(p_order uuid, p jsonb, p_files jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_quality(v_company) then
    raise exception 'Only the Quality team records QC.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company) then
    raise exception 'That order isn''t in your company.';
  end if;
  if nullif(p ->> 'line_id', '') is null then
    raise exception 'Pick the style this check is for.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(p_files) f where coalesce(f ->> 'kind', 'photo') in ('photo', 'report')) then
    raise exception 'Add the QC report or at least one photo as proof of the check.';
  end if;
  insert into public.qc_checks (id, company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes, checked_by)
  values (v_id, v_company, p_order, (p ->> 'line_id')::uuid, p ->> 'kind', coalesce(nullif(p ->> 'checked_on', '')::date, public.india_today()),
          p ->> 'result', nullif(p ->> 'pieces_checked', '')::integer, coalesce(nullif(p ->> 'defects', '')::integer, 0),
          nullif(btrim(p ->> 'notes'), ''), auth.uid());
  -- Files go in the check's own folder, <company>/<order>/qc/<check>/.
  if exists (select 1 from jsonb_array_elements(p_files) f
             where coalesce(f ->> 'kind', 'photo') not in ('photo', 'report')
                or (f ->> 'path') not like v_company::text || '/' || p_order::text || '/qc/' || v_id::text || '/%'
                or (f ->> 'path') like '%..%') then
    raise exception 'Those files didn''t upload properly. Try again.';
  end if;
  insert into public.qc_photos (company_id, qc_id, path, kind, file_name, created_by)
  select v_company, v_id, f ->> 'path', coalesce(f ->> 'kind', 'photo'), nullif(btrim(f ->> 'file_name'), ''), auth.uid()
  from jsonb_array_elements(p_files) f;
  return v_id;
end $$;

