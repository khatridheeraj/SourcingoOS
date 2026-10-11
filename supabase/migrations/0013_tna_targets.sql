-- The merchandiser's TNA comes first. Before a factory is asked for its plan, every style has its steps decided
-- (standard steps, any not needed, and any extra steps for that style) and a target date for each.
-- The factory then gives its own date for each step; the PO is released once every factory date is in and
-- none is later than its target.

-- Extra steps a style needs beyond the standard ones, named by the merchandiser.
alter table public.line_stages add column label text,
  add column added_at timestamptz not null default now();
alter table public.line_stages drop constraint line_stages_stage_check;
alter table public.line_stages add constraint line_stages_stage_check check (
  stage in ('greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
            'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory')
  or (stage ~ '^extra_[0-9a-f]{8}$' and length(btrim(coalesce(label, ''))) between 1 and 60));
grant update (label) on public.line_stages to authenticated;

-- Staff of the style's company, or the factory making it.
create function public.can_see_line(p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_lines l where l.id = p_line
                 and (public.is_member(l.company_id) or (l.company_id = public.current_company() and l.factory_id = public.my_factory())))
$$;
revoke execute on function public.can_see_line(uuid) from public, anon;
grant execute on function public.can_see_line(uuid) to authenticated;

-- Every step of a style, in order: the standard steps, then its extra steps. A step marked not needed is left out.
create function public.style_steps(p_line uuid)
returns table (stage text, label text, pos integer, planned_on date, factory_on date, done_on date)
language sql stable security definer set search_path = '' as $$
  select st.stage, st.label, st.pos::integer, s.planned_on, s.factory_on, s.done_on
  from unnest(array['greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
                    'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory'],
              array['Greige', 'Fit sample', 'Strike off', 'PP sample', 'Size set',
                    'Fabric', 'Printing', 'Cutting', 'Stitching', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'])
       with ordinality as st (stage, label, pos)
  left join public.line_stages s on s.line_id = p_line and s.stage = st.stage
  where not coalesce(s.not_needed, false) and public.can_see_line(p_line)
  union all
  select s.stage, s.label, (100 + row_number() over (order by s.added_at, s.stage))::integer, s.planned_on, s.factory_on, s.done_on
  from public.line_stages s
  where s.line_id = p_line and s.stage like 'extra\_%' and not s.not_needed and public.can_see_line(p_line)
$$;
revoke execute on function public.style_steps(uuid) from public, anon;
grant execute on function public.style_steps(uuid) to authenticated;

-- What a factory's styles on an order still lack: 'target' (the merchandiser's date), 'factory' (the factory's date),
-- 'late' (the factory's date is after the target), 'rate' (no factory rate) and 'beyond' (a target after the PO's target date).
create function public.tna_gaps(p_order uuid, p_factory uuid)
returns table (style text, kind text, steps text)
language sql stable security definer set search_path = '' as $$
  with lines as (
    select l.id, l.style, l.position, l.factory_rate from public.order_lines l
    where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null and public.is_member(l.company_id)
  ), steps as (
    select l.id, l.style, l.position, s.* from lines l cross join lateral public.style_steps(l.id) s
  )
  select style, kind, steps from (
    select style, position, 1 as k, 'rate' as kind, null::text as steps from lines where factory_rate is null
    union all
    select style, position, 2, 'target', string_agg(label, ', ' order by pos) from steps where planned_on is null group by style, position
    union all
    select style, position, 3, 'beyond', string_agg(label, ', ' order by pos) from steps
      where planned_on > public.factory_target(p_order, p_factory) group by style, position
    union all
    select style, position, 4, 'factory', string_agg(label, ', ' order by pos) from steps where factory_on is null group by style, position
    union all
    select style, position, 5, 'late', string_agg(label, ', ' order by pos) from steps where factory_on > planned_on group by style, position
  ) g order by position, k
$$;
revoke execute on function public.tna_gaps(uuid, uuid) from public, anon;
grant execute on function public.tna_gaps(uuid, uuid) to authenticated;

-- The merchandiser asks a factory for its TNA only once every style's steps and targets are set, all on or before the target date.
create or replace function public.request_factory_plan(p_order uuid, p_factory uuid, p_buffer_days integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid;
  v_due date;
  v_missing text;
begin
  select company_id, coalesce(revised_ship_date, ship_date) into v_company, v_due from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can ask for a plan on an open order.';
  end if;
  if v_due is null then
    raise exception 'Enter the PO''s ship date first, so the factory has a target date.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'This factory has no styles on the order.';
  end if;
  if p_buffer_days is null or p_buffer_days < 0 or p_buffer_days > 90 then
    raise exception 'Keep a buffer of 0 to 90 days.';
  end if;
  if v_due - p_buffer_days < public.india_today() then
    raise exception 'With that buffer the target date is already past. Use a smaller buffer or move the ship date.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    raise exception 'This factory''s PO is already released.';
  end if;
  select string_agg(style || ' (' || steps || ')', '; ') into v_missing from public.tna_gaps(p_order, p_factory) where kind = 'target';
  if v_missing is not null then
    raise exception 'Set a target date for every step before asking the factory. Missing: %', v_missing;
  end if;
  if exists (select 1 from public.order_lines l cross join lateral public.style_steps(l.id) s
             where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null and s.planned_on > v_due - p_buffer_days) then
    raise exception 'Some targets are after the target date %. Bring them on or before it.', to_char(v_due - p_buffer_days, 'DD Mon YYYY');
  end if;
  insert into public.factory_pos (order_id, factory_id, plan_requested_on, plan_requested_at, buffer_days)
  values (p_order, p_factory, public.india_today(), now(), p_buffer_days)
  on conflict (order_id, factory_id) do update
    set plan_requested_on = excluded.plan_requested_on, plan_requested_at = excluded.plan_requested_at, buffer_days = excluded.buffer_days;
end $$;

-- Release: a factory rate, the factory's date for every step, none later than its target, all targets within the target date.
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_missing text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'This factory has no styles on the order.';
  end if;
  select string_agg(style || ' (' || what || ')', ' | ' order by first) into v_missing
  from (select style, min(ord) as first, string_agg(case kind
             when 'rate' then 'factory rate'
             when 'target' then 'target: ' || steps
             when 'beyond' then 'target after the PO target date: ' || steps
             when 'factory' then 'factory dates: ' || steps
             else 'factory later than target: ' || steps end, '; ' order by ord) as what
        from (select g.*, row_number() over () as ord from public.tna_gaps(p_order, p_factory) g) n
        group by style) per_style;
  if v_missing is not null then
    raise exception 'The plan is not complete yet. Missing: %', v_missing;
  end if;
  insert into public.factory_pos (company_id, order_id, factory_id, released_at, released_by)
  values (v_company, p_order, p_factory, now(), auth.uid())
  on conflict (order_id, factory_id) do update set released_at = now(), released_by = auth.uid()
  where public.factory_pos.released_at is null;
end $$;

-- Who may change what on a TNA step, now including an extra step's name (the orders team only).
create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
  v_released boolean;
begin
  select l.factory_id into v_factory from public.order_lines l
  where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id;
  if not found then
    raise exception 'That style is not on this order.';
  end if;
  v_released := exists (select 1 from public.factory_pos f where f.order_id = new.order_id and f.factory_id = v_factory and f.released_at is not null);
  -- Who may change what applies to people; data loads run by the database owner have no signed-in person.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;
  if (new.planned_on is distinct from (case when tg_op = 'INSERT' then null else old.planned_on end)
      or new.not_needed is distinct from (case when tg_op = 'INSERT' then false else old.not_needed end)
      or new.label is distinct from (case when tg_op = 'INSERT'
        then (select x.label from public.line_stages x where x.line_id = new.line_id and x.stage = new.stage) else old.label end))
     and not public.can_edit_orders(new.company_id) then
    raise exception 'Only the orders team can change the plan.';
  end if;
  if new.factory_on is distinct from (case when tg_op = 'INSERT' then null else old.factory_on end) then
    if public.my_factory() is distinct from v_factory then
      raise exception 'Only the factory enters its own dates.';
    end if;
    if v_released then
      raise exception 'The PO is released, so the factory''s dates are fixed.';
    end if;
  end if;
  if new.done_on is not null and new.done_on is distinct from (case when tg_op = 'INSERT' then null else old.done_on end) then
    if not (public.can_edit_orders(new.company_id) or public.is_quality(new.company_id)) then
      raise exception 'Only the orders team and Quality enter done dates.';
    end if;
    if not v_released then
      raise exception 'Release the factory PO before entering done dates.';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Saves targets, not-needed, extra steps and done dates (the orders team), or done dates only (Quality).
-- p_rows: [{line_id, stage, planned_on, done_on, not_needed, label}]; an extra step's stage is extra_<8 hex>.
create or replace function public.save_line_stages(p_order uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not (public.can_edit_orders(v_company) or public.is_quality(v_company)) then
    raise exception 'Only the orders team and Quality can change production.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;
  if public.can_edit_orders(v_company) then
    insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed, label)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date,
           coalesce((r ->> 'not_needed')::boolean, false),
           coalesce(nullif(btrim(r ->> 'label'), ''),
                    (select x.label from public.line_stages x where x.line_id = (r ->> 'line_id')::uuid and x.stage = r ->> 'stage'))
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on, not_needed = excluded.not_needed,
      label = coalesce(excluded.label, public.line_stages.label);
  else
    insert into public.line_stages (order_id, line_id, stage, done_on)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'done_on', '')::date
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set done_on = excluded.done_on;
  end if;
end $$;

-- The factory panel now shows the merchandiser's target for every step, and each style's extra steps.
create or replace function public.factory_tna() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  return jsonb_build_object('factory', (select name from public.factories where id = v_factory), 'orders', coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'order_no', o.order_no, 'ship_date', coalesce(o.revised_ship_date, o.ship_date),
      'plan_requested_on', f.plan_requested_on, 'sent_at', f.factory_sent_at, 'released_at', f.released_at,
      'plan_due_at', f.plan_requested_at + interval '24 hours', 'target', public.factory_target(o.id, v_factory),
      'lines', (select jsonb_agg(jsonb_build_object(
          'id', l.id, 'style', l.style, 'colour', l.colour, 'qty', l.qty, 'rate', l.factory_rate,
          'stages', (select coalesce(jsonb_agg(jsonb_build_object(
              'stage', s.stage, 'label', s.label, 'factory_on', s.factory_on, 'planned_on', s.planned_on,
              'done_on', case when f.released_at is not null then s.done_on end) order by s.pos), '[]'::jsonb)
            from public.style_steps(l.id) s)) order by l.position)
        from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null))
      order by f.released_at is not null, coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
    from public.orders o
    join public.factory_pos f on f.order_id = o.id and f.factory_id = v_factory
      and (f.plan_requested_at is not null or f.plan_requested_on is not null or f.released_at is not null)
    where o.company_id = public.current_company() and o.status = 'open'
      and exists (select 1 from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null)
  ), '[]'::jsonb));
end $$;

-- The factory saves its dates for steps that are on its styles (it can't add steps).
create or replace function public.save_factory_tna(p_order uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
  v_company uuid := public.current_company();
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company and status = 'open') then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
             where not exists (select 1 from public.order_lines l where l.id = (r ->> 'line_id')::uuid and l.order_id = p_order
                               and l.factory_id = v_factory and l.removed_at is null)) then
    raise exception 'That style is not one of yours on this order.';
  end if;
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = v_factory) then
    raise exception 'Sourcingo has not asked you for this plan yet.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
             where not exists (select 1 from public.style_steps((r ->> 'line_id')::uuid) s where s.stage = r ->> 'stage')) then
    raise exception 'That step is not on this style. Reload the page.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where nullif(r ->> 'factory_on', '')::date > public.factory_target(p_order, v_factory)) then
    raise exception 'Every date must be on or before the target date %.', to_char(public.factory_target(p_order, v_factory), 'DD Mon YYYY');
  end if;
  insert into public.line_stages (company_id, order_id, line_id, stage, factory_on, label)
  select v_company, p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'factory_on', '')::date,
         (select x.label from public.line_stages x where x.line_id = (r ->> 'line_id')::uuid and x.stage = r ->> 'stage')
  from jsonb_array_elements(p_rows) r
  on conflict (line_id, stage) do update set factory_on = excluded.factory_on
  where not public.line_stages.not_needed;
  insert into public.factory_pos (company_id, order_id, factory_id, factory_sent_at)
  values (v_company, p_order, v_factory, now())
  on conflict (order_id, factory_id) do update set factory_sent_at = now();
end $$;
