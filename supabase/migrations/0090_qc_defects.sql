-- Defect list for a QC check (Dheeraj, 10 Nov 2026: complete the team panels). A failed check said only "18 defects";
-- the factory needs to know which: loose threads 8, shade variation 6, open seam 4, and how serious each is, to fix
-- them before the re-check. Quality writes the list on the check; saving replaces it (older rows kept with removed_at).
-- (Numbered 0090 so it can't clash with the buyer and factory thread, which uses 0084 to 0089.)

create table public.qc_defects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  check_id uuid not null references public.qc_checks (id),
  position integer not null,
  defect text not null check (char_length(btrim(defect)) between 1 and 80),
  pieces integer not null check (pieces between 1 and 1000000),
  severity text not null check (severity in ('critical', 'major', 'minor')),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index qc_defects_check_idx on public.qc_defects (check_id) where removed_at is null;

alter table public.qc_defects enable row level security;
revoke all on public.qc_defects from anon, authenticated;
grant select on public.qc_defects to authenticated;
-- Everyone in the team who can read the check reads its defects (as qc_checks_read).
create policy qc_defects_read on public.qc_defects for select to authenticated using (public.is_member(company_id));

-- Saves a check's defect list in one go. p_rows: [{defect, pieces, severity}]. Quality and the owner only.
create or replace function public.save_qc_defects(p_check uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.qc_checks%rowtype;
  v_row jsonb;
  v_pos integer := 0;
  v_defect text;
  v_pieces integer;
  v_sev text;
  v_seen text[] := '{}';
begin
  select * into v_c from public.qc_checks where id = p_check;
  if v_c.id is null or v_c.company_id is distinct from public.current_company() then
    raise exception 'That check is not here any more. Reload the page.';
  end if;
  if not public.is_quality(v_c.company_id) then
    raise exception 'Only Quality writes defect lists.';
  end if;
  if v_c.cancelled_at is not null then
    raise exception 'That check was cancelled.';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]')) > 40 then
    raise exception 'Keep the defect list under 40 lines.';
  end if;
  update public.qc_defects set removed_at = now() where check_id = p_check and removed_at is null;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_pos := v_pos + 1;
    v_defect := nullif(btrim(regexp_replace(coalesce(v_row ->> 'defect', ''), '\s+', ' ', 'g')), '');
    if v_defect is null then
      raise exception 'Line %: write the defect.', v_pos;
    end if;
    if char_length(v_defect) > 80 then
      raise exception 'Line %: keep the defect under 80 letters.', v_pos;
    end if;
    if lower(v_defect) = any (v_seen) then
      raise exception 'Line %: % is already on the list.', v_pos, v_defect;
    end if;
    v_seen := v_seen || lower(v_defect);
    begin
      v_pieces := (v_row ->> 'pieces')::integer;
    exception when others then
      raise exception 'Line %: pieces must be a whole number.', v_pos;
    end;
    if v_pieces is null or v_pieces < 1 then
      raise exception 'Line %: how many pieces have it?', v_pos;
    end if;
    if v_c.pieces_checked is not null and v_pieces > v_c.pieces_checked then
      raise exception 'Line %: more pieces than the % checked.', v_pos, v_c.pieces_checked;
    end if;
    v_sev := coalesce(nullif(v_row ->> 'severity', ''), 'major');
    if v_sev not in ('critical', 'major', 'minor') then
      raise exception 'Line %: pick critical, major or minor.', v_pos;
    end if;
    insert into public.qc_defects (company_id, check_id, position, defect, pieces, severity)
    values (v_c.company_id, p_check, v_pos, v_defect, v_pieces, v_sev);
  end loop;
  return v_pos;
end $$;
revoke execute on function public.save_qc_defects(uuid, jsonb) from public, anon;
grant execute on function public.save_qc_defects(uuid, jsonb) to authenticated;
