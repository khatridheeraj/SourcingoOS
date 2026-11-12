-- Sample comment sheets (Dheeraj, 12 Nov 2026). Quality's one-page sheet to a factory after checking a sample: a
-- numbered ref, the result, and each point as area / observation / correction. The sheet is saved as a QC check on
-- the order (record_qc, with the PDF as the check's report and the photos as its photos), and this table keeps the
-- structured sheet behind that check, so the ref number, result and points can be listed and searched.

alter table public.companies add column if not exists next_sheet_no integer not null default 1;

create table public.qc_comment_sheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  check_id uuid not null unique references public.qc_checks (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  ref_no text not null check (ref_no ~ '^SG-SCS-[0-9]{4}-[0-9]{4,6}$'),
  stage text not null check (stage in ('proto', 'fit', 'pp', 'size_set', 'top', 'shipment')),
  size text check (length(size) <= 40),
  verdict text not null check (verdict in ('not_approved', 'approved_with_comments', 'approved')),
  summary text not null check (length(btrim(summary)) between 1 and 400),
  next_step text not null check (length(btrim(next_step)) between 1 and 400),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) between 1 and 40),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (company_id, ref_no),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index qc_comment_sheets_order_idx on public.qc_comment_sheets (company_id, order_id);

alter table public.qc_comment_sheets enable row level security;
revoke all on public.qc_comment_sheets from anon, authenticated;
grant select on public.qc_comment_sheets to authenticated;
-- Everyone in the team reads sheets, as they read the checks they sit on.
create policy qc_comment_sheets_read on public.qc_comment_sheets for select to authenticated using (public.is_member(company_id));

-- Takes the next ref number for a sheet, SG-SCS-<year>-<serial>, before the PDF is made (the number is printed on
-- it). A number taken for a sheet that is then not saved stays unused, which is fine: numbers must be unique, not
-- gap-free. Quality and the owner only.
create or replace function public.reserve_comment_sheet_ref() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_n integer;
begin
  if not public.is_quality(v_company) then
    raise exception 'Only the Quality team writes comment sheets.';
  end if;
  update public.companies set next_sheet_no = next_sheet_no + 1 where id = v_company returning next_sheet_no - 1 into v_n;
  return 'SG-SCS-' || to_char(public.india_today(), 'YYYY') || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke execute on function public.reserve_comment_sheet_ref() from public, anon;
grant execute on function public.reserve_comment_sheet_ref() to authenticated;

-- Saves the sheet behind a check that record_qc just made. p: {ref_no, stage, size, verdict, summary, next_step,
-- rows: [{area, observation, correction}]}. One sheet per check; the check must be the caller's own, live and recent.
create or replace function public.save_comment_sheet(p_check uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.qc_checks%rowtype;
  v_row jsonb;
  v_pos integer := 0;
  v_rows jsonb := '[]';
  v_id uuid;
begin
  select * into v_c from public.qc_checks where id = p_check;
  if v_c.id is null or v_c.company_id is distinct from public.current_company() then
    raise exception 'That check is not here any more. Reload the page.';
  end if;
  if not public.is_quality(v_c.company_id) then
    raise exception 'Only the Quality team writes comment sheets.';
  end if;
  if v_c.cancelled_at is not null then
    raise exception 'That check was cancelled.';
  end if;
  if jsonb_typeof(coalesce(p -> 'rows', 'null')) <> 'array' or jsonb_array_length(p -> 'rows') not between 1 and 40 then
    raise exception 'A sheet has between 1 and 40 points.';
  end if;
  for v_row in select * from jsonb_array_elements(p -> 'rows') loop
    v_pos := v_pos + 1;
    if nullif(btrim(coalesce(v_row ->> 'observation', '')), '') is null then
      raise exception 'Point %: write the observation.', v_pos;
    end if;
    if nullif(btrim(coalesce(v_row ->> 'correction', '')), '') is null then
      raise exception 'Point %: write the correction required.', v_pos;
    end if;
    if length(coalesce(v_row ->> 'area', '')) > 300 or length(v_row ->> 'observation') > 300 or length(v_row ->> 'correction') > 300 then
      raise exception 'Point %: keep each cell under 300 letters.', v_pos;
    end if;
    v_rows := v_rows || jsonb_build_object(
      'area', btrim(coalesce(v_row ->> 'area', '')), 'observation', btrim(v_row ->> 'observation'), 'correction', btrim(v_row ->> 'correction'));
  end loop;
  insert into public.qc_comment_sheets (company_id, check_id, order_id, line_id, ref_no, stage, size, verdict, summary, next_step, rows)
  values (v_c.company_id, p_check, v_c.order_id, v_c.line_id, p ->> 'ref_no', p ->> 'stage', nullif(btrim(coalesce(p ->> 'size', '')), ''),
          p ->> 'verdict', btrim(p ->> 'summary'), btrim(p ->> 'next_step'), v_rows)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_comment_sheet(uuid, jsonb) from public, anon;
grant execute on function public.save_comment_sheet(uuid, jsonb) to authenticated;

