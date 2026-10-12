-- The order's stage follows Dheeraj's 15 standard TNA steps (0021). It was still worked out from the
-- six old production stages, so an order whose styles had only Inline, Mid-line, Final QC or the
-- sampling steps done showed "Not started".
alter table public.orders drop constraint orders_stage_check;
alter table public.orders add constraint orders_stage_check check (
  stage in ('greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
            'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'));

-- The order's stage is the furthest standard step its slowest style has done.
create or replace function public.order_stage(p_order uuid) returns text
language sql stable set search_path = '' as $$
  with st as (
    select array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
                 'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'] a
  )
  select (select a from st)[nullif(min(coalesce((select max(array_position((select a from st), s.stage)) from public.line_stages s
                                                 where s.line_id = l.id and s.done_on is not null), 0)), 0)]
  from public.order_lines l where l.order_id = p_order and l.removed_at is null
$$;

create or replace function public.sync_order_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_stage text;
begin
  if not exists (select 1 from public.line_stages where order_id = new.order_id and done_on is not null)
     and (tg_op = 'INSERT' or old.done_on is null) then
    return null;
  end if;
  v_stage := public.order_stage(new.order_id);
  update public.orders set stage = v_stage where id = new.order_id and stage is distinct from v_stage;
  return null;
end $$;

-- Bring open orders' stages up to date with the done dates already entered.
update public.orders o set stage = public.order_stage(o.id)
where o.status = 'open' and exists (select 1 from public.line_stages s where s.order_id = o.id and s.done_on is not null)
  and o.stage is distinct from public.order_stage(o.id);
