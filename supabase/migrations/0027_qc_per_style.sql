-- QC per style: every check is for one style of the order, with its own photos, reports and comments.
-- An order ships once each of its styles has passed its latest final QC (or re-check).

alter table public.qc_checks add column line_id uuid not null references public.order_lines (id);
create index qc_checks_line_idx on public.qc_checks (line_id, checked_on desc, created_at desc);

-- The style must be on the check's order, and still on it.
create function public.check_qc_line() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.line_id is null then
    raise exception 'Pick the style this check is for.';
  end if;
  if not exists (select 1 from public.order_lines l where l.id = new.line_id and l.order_id = new.order_id and l.removed_at is null) then
    raise exception 'That style isn''t on this order.';
  end if;
  return new;
end $$;
create trigger qc_checks_line before insert on public.qc_checks for each row execute function public.check_qc_line();

-- A saved check, including the style it is for, can only be cancelled, once.
create or replace function public.guard_qc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.cancelled_at is not null then
    raise exception 'This QC check is already cancelled.';
  end if;
  if (new.order_id, new.line_id, new.kind, new.checked_on, new.result, new.pieces_checked, new.defects, new.notes, new.checked_by, new.company_id)
     is distinct from (old.order_id, old.line_id, old.kind, old.checked_on, old.result, old.pieces_checked, old.defects, old.notes, old.checked_by, old.company_id) then
    raise exception 'A saved QC check can''t be changed. Cancel it and record a new one.';
  end if;
  return new;
end $$;

-- True when every style on the order has passed its latest final QC or re-check.
create or replace function public.final_qc_passed(p_order uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.order_lines l where l.order_id = p_order and l.removed_at is null)
     and not exists (
       select 1 from public.order_lines l
       where l.order_id = p_order and l.removed_at is null
         and coalesce((select q.result = 'pass' from public.qc_checks q
                       where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                       order by q.checked_on desc, q.created_at desc limit 1), false) = false)
$$;

-- Records a check for one style together with its files. A check without a photo is refused.
-- p: {id, line_id, kind, checked_on, result, pieces_checked, defects, notes}; p_files: [{path, kind, file_name}, ...]
create or replace function public.record_qc(p_order uuid, p jsonb, p_files jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
begin
  if not public.is_quality(public.current_company()) then
    raise exception 'Only the Quality team records QC.';
  end if;
  if nullif(p ->> 'line_id', '') is null then
    raise exception 'Pick the style this check is for.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(p_files) f where f ->> 'kind' = 'photo') then
    raise exception 'Add at least one photo as proof of the check.';
  end if;
  insert into public.qc_checks (id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes)
  values (v_id, p_order, (p ->> 'line_id')::uuid, p ->> 'kind', coalesce(nullif(p ->> 'checked_on', '')::date, public.india_today()), p ->> 'result',
          nullif(p ->> 'pieces_checked', '')::integer, coalesce(nullif(p ->> 'defects', '')::integer, 0), nullif(btrim(p ->> 'notes'), ''));
  insert into public.qc_photos (qc_id, path, kind, file_name)
  select v_id, f ->> 'path', coalesce(f ->> 'kind', 'photo'), nullif(btrim(f ->> 'file_name'), '')
  from jsonb_array_elements(p_files) f;
  return v_id;
end $$;

revoke execute on function public.check_qc_line() from public, anon, authenticated;
