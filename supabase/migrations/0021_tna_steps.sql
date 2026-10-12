-- Standard TNA steps as Dheeraj listed them (2026-10-12): Inline and Mid-line become steps of their own,
-- Fabric and Printing / dyeing come before Strike off and the PP sample.
alter table public.line_stages drop constraint line_stages_stage_check;
alter table public.line_stages add constraint line_stages_stage_check check (
  stage in ('greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
            'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory')
  or (stage ~ '^extra_[0-9a-f]{8}$' and length(btrim(coalesce(label, ''))) between 1 and 60));

-- Every step of a style, in order: the standard steps, then its extra steps. A step marked not needed is left out.
create or replace function public.style_steps(p_line uuid)
returns table (stage text, label text, pos integer, planned_on date, factory_on date, done_on date)
language sql stable security definer set search_path = '' as $$
  select st.stage, st.label, st.pos::integer, s.planned_on, s.factory_on, s.done_on
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
                    'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'],
              array['Greige', 'Fit sample', 'Fabric', 'Printing / dyeing', 'Strike off', 'PP sample', 'Size set',
                    'Cutting', 'Stitching', 'Inline', 'Mid-line', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'])
       with ordinality as st (stage, label, pos)
  left join public.line_stages s on s.line_id = p_line and s.stage = st.stage
  where not coalesce(s.not_needed, false) and public.can_see_line(p_line)
  union all
  select s.stage, s.label, (100 + row_number() over (order by s.added_at, s.stage))::integer, s.planned_on, s.factory_on, s.done_on
  from public.line_stages s
  where s.line_id = p_line and s.stage like 'extra\_%' and not s.not_needed and public.can_see_line(p_line)
$$;

-- Every standard step is mandatory (Dheeraj, 2026-10-12): none can be marked not needed. Only extra steps can be removed.
alter table public.line_stages drop constraint line_stages_mandatory;
alter table public.line_stages add constraint line_stages_mandatory check (not (not_needed and stage not like 'extra\_%'));
