-- QC results in the factory's own panel: every check Sourcingo's Quality team recorded on the factory's styles
-- (Inline, Mid-line, Final QC, re-checks and sample checks), with the result, pieces checked, defects, what Quality
-- wrote, and the photos and report files. Cancelled checks and the team's comments stay inside Sourcingo.

-- The checks on the styles of the factory whose panel this is (its own login, or a team member's preview).
create function public.factory_qc() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'order_id', q.order_id, 'line_id', q.line_id, 'style', l.style, 'kind', q.kind,
      'checked_on', q.checked_on, 'result', q.result, 'pieces_checked', q.pieces_checked, 'defects', q.defects,
      'notes', nullif(btrim(q.notes), ''),
      'files', (select coalesce(jsonb_agg(jsonb_build_object('path', p.path, 'kind', p.kind, 'name', p.file_name) order by p.created_at), '[]'::jsonb)
                from public.qc_photos p where p.qc_id = q.id and p.removed_at is null))
    order by q.checked_on desc, q.created_at desc), '[]'::jsonb)
  from public.qc_checks q
  join public.order_lines l on l.id = q.line_id and l.removed_at is null
  join public.orders o on o.id = q.order_id and o.status = 'open'
  where q.company_id = public.current_company() and q.cancelled_at is null
    and l.factory_id = public.viewing_factory()
$$;
revoke execute on function public.factory_qc() from public, anon;
grant execute on function public.factory_qc() to authenticated;

-- A factory login may now also open the photos and reports of QC checks on its own styles
-- (<company>/<order>/qc/<check>/...). Everything else is as before.
create or replace function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if public.my_factory() is null then
    return false;
  end if;
  if v_parts[3] = 'files' then
    return exists (select 1 from public.line_files f join public.order_lines l on l.id = f.line_id and l.removed_at is null
                   where f.path = p_name and f.removed_at is null and f.kind in ('tech_pack', 'cutting')
                     and f.company_id = public.current_company() and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] = 'samples' then
    return exists (select 1 from public.sample_rounds r
                   where r.line_id = v_parts[4]::uuid and r.order_id = v_parts[2]::uuid and r.company_id = v_parts[1]::uuid
                     and r.company_id = public.current_company() and r.factory_id = public.my_factory()
                     and (p_name = any (r.answer_photos) or p_name = any (r.photos)));
  end if;
  if v_parts[3] = 'qc' then
    return exists (select 1 from public.qc_photos p
                   join public.qc_checks q on q.id = p.qc_id and q.cancelled_at is null
                   join public.order_lines l on l.id = q.line_id and l.removed_at is null
                   where p.path = p_name and p.removed_at is null and q.company_id = public.current_company()
                     and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] <> 'factory' then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;
