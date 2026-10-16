-- Order lifecycle fixes from the second full check of 16 Oct 2026: two people on one order, styles moved between
-- factories or typed back in, the TNA saved over someone else's dates, and QC photos.

-- ---------------------------------------------------------------- 1. two people saving the same order
-- The second of two people with the same order open saved their old copy over the first person's work: a style
-- the first one added was removed again and their changes were undone. Every save now counts up the order's
-- edit number, and a save made from an older copy is refused.
alter table public.orders add column edit_no integer not null default 0;
grant update (edit_no) on public.orders to authenticated;

-- The edit number only ever goes up by one, whatever is written to it.
create or replace function public.count_order_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.edit_no is distinct from old.edit_no then
    new.edit_no := old.edit_no + 1;
  end if;
  return new;
end $$;
create trigger orders_count_edit before update on public.orders
  for each row execute function public.count_order_edit();
revoke execute on function public.count_order_edit() from public, anon, authenticated;

-- A save that changes nothing but the edit number isn't a change worth a line in the history.
create or replace function public.record_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Bookkeeping columns that change on every sync or save; a save that only touches these isn't a change.
  v_noise text[] := array['updated_at', 'seen_at', 'agent_seen_at', 'agent_info', 'snapshot_at', 'snapshot_counts', 'edit_no'];
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_companies uuid[];
begin
  if tg_op = 'UPDATE' and v_old - v_noise = v_new - v_noise then
    return new;
  end if;
  if v_row ? 'company_id' then
    v_companies := array[(v_row ->> 'company_id')::uuid];
  elsif tg_table_name = 'companies' then
    v_companies := array[(v_row ->> 'id')::uuid];
  elsif tg_table_name = 'profiles' then
    select array_agg(m.company_id) into v_companies from public.members m where m.user_id = (v_row ->> 'id')::uuid;
  end if;
  insert into public.history (company_id, table_name, row_id, action, before, after, source)
  select c, tg_table_name, public.history_row_id(tg_relid, v_row), lower(tg_op),
         public.history_hide_secrets(v_old), public.history_hide_secrets(v_new), public.history_source()
  from unnest(coalesce(v_companies, '{}')) c
  where c is not null;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------- 2. styles removed, typed back in, or moved
-- Removing a style the company already bought on a dispatch left those goods on no style, and a style moved off a
-- factory whose PO is released took the work away from that factory without the owner knowing.
create or replace function public.guard_order_line() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is not null and old.removed_at is null
     and exists (select 1 from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                 where dl.line_id = old.id and d.cancelled_at is null) then
    raise exception '% has goods bought on a dispatch, so it can''t be removed. Cancel that dispatch first.', old.style;
  end if;
  if new.factory_id is distinct from old.factory_id and old.factory_id is not null
     and auth.uid() is not null and not public.is_owner(old.company_id)
     and exists (select 1 from public.factory_pos f where f.order_id = old.order_id and f.factory_id = old.factory_id
                 and f.released_at is not null) then
    raise exception '% is on %''s released PO, so only the owner can move it to another factory.',
      old.style, (select name from public.factories where id = old.factory_id);
  end if;
  return new;
end $$;
create trigger order_lines_guard before update on public.order_lines
  for each row execute function public.guard_order_line();

-- A style moved to another factory kept the old factory's dates, so the new factory's PO looked planned without
-- the new factory ever giving a date. The factory's dates are cleared on a move; the targets and done dates stay.
create or replace function public.clear_factory_dates_on_move() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := coalesce(nullif(current_setting('sourcingo.plan_for_factory', true), ''), 'off');
begin
  perform set_config('sourcingo.plan_for_factory', 'on', true);
  update public.line_stages set factory_on = null where line_id = new.id and factory_on is not null;
  perform set_config('sourcingo.plan_for_factory', v_prev, true);
  return null;
end $$;
create trigger order_lines_factory_moved after update of factory_id on public.order_lines
  for each row when (old.factory_id is distinct from new.factory_id) execute function public.clear_factory_dates_on_move();
revoke execute on function public.guard_order_line(), public.clear_factory_dates_on_move() from public, anon, authenticated;

-- The orders team may clear a factory's date when the style moves away (the flag above), even after release.
create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
  v_released boolean;
  v_for_factory boolean;
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
    -- accept_targets_for_factory and a style's move to another factory set this flag for their own transaction only.
    v_for_factory := current_setting('sourcingo.plan_for_factory', true) = 'on' and public.can_edit_orders(new.company_id);
    if public.my_factory() is distinct from v_factory and not v_for_factory then
      raise exception 'Only the factory enters its own dates.';
    end if;
    if v_released and not (v_for_factory and new.factory_on is null) then
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

-- Saves an order and all of its lines in one step.
-- p_order: {id?, edit_no?, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes}
-- p_lines: [{id?, style, description, colour, qty, buyer_rate, factory_id, factory_rate}, ...] in display order.
-- With edit_no, a save from an older copy of the order is refused. A new line with the style and colour of one
-- removed earlier brings that style back, with its TNA, QC and dispatches, instead of starting a new one.
create or replace function public.save_order(p_order jsonb, p_lines jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
  v_edit integer := nullif(p_order ->> 'edit_no', '')::integer;
  v_n integer;
  v_old uuid;
  v_done uuid[] := '{}';
  l record;
begin
  if not public.is_member(public.current_company()) then
    raise exception 'Your account is not switched on yet.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one style.';
  end if;

  if v_id is null then
    insert into public.orders (buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes)
    values (
      (p_order ->> 'buyer_id')::uuid, btrim(p_order ->> 'buyer_po'),
      nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'ship_date', '')::date,
      coalesce(nullif(p_order ->> 'status', ''), 'open'),
      nullif(p_order ->> 'merchandiser_id', '')::uuid, nullif(btrim(p_order ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.orders set
      buyer_id = (p_order ->> 'buyer_id')::uuid,
      buyer_po = btrim(p_order ->> 'buyer_po'),
      po_date = nullif(p_order ->> 'po_date', '')::date,
      ship_date = nullif(p_order ->> 'ship_date', '')::date,
      status = coalesce(nullif(p_order ->> 'status', ''), 'open'),
      merchandiser_id = nullif(p_order ->> 'merchandiser_id', '')::uuid,
      notes = nullif(btrim(p_order ->> 'notes'), ''),
      edit_no = edit_no + 1
    where id = v_id and company_id = public.current_company() and (v_edit is null or edit_no = v_edit);
    get diagnostics v_n = row_count;
    if v_n = 0 then
      if v_edit is not null and exists (select 1 from public.orders where id = v_id and company_id = public.current_company()
                                        and public.can_edit_orders(company_id)) then
        raise exception 'Someone else changed this order while you had it open. Reload the page and make your change again.';
      end if;
      raise exception 'That order no longer exists.';
    end if;
    -- Lines left out are removed, except one typed back in as a new line in this same save (it is kept below).
    update public.order_lines o set removed_at = now()
    where o.order_id = v_id and o.removed_at is null
      and o.id::text not in (select coalesce(x ->> 'id', '') from jsonb_array_elements(p_lines) x)
      and not exists (select 1 from jsonb_array_elements(p_lines) x
                      where nullif(x ->> 'id', '') is null
                        and lower(btrim(x ->> 'style')) = lower(btrim(o.style))
                        and lower(btrim(coalesce(x ->> 'colour', ''))) = lower(btrim(coalesce(o.colour, ''))));
  end if;

  for l in select t.j, t.n from jsonb_array_elements(p_lines) with ordinality as t (j, n) loop
    v_old := nullif(l.j ->> 'id', '')::uuid;
    if v_old is null then
      -- The same style and colour removed earlier (or just now) comes back with its TNA, QC and dispatches.
      select o.id into v_old from public.order_lines o
      where o.order_id = v_id
        and (o.removed_at is not null
             or o.id::text not in (select coalesce(x ->> 'id', '') from jsonb_array_elements(p_lines) x))
        and lower(btrim(o.style)) = lower(btrim(l.j ->> 'style'))
        and lower(btrim(coalesce(o.colour, ''))) = lower(btrim(coalesce(l.j ->> 'colour', '')))
        and o.id <> all (v_done)
      order by o.removed_at desc nulls first limit 1;
      if v_old is null then
        insert into public.order_lines (order_id, position, style, description, colour, qty, buyer_rate, factory_id, factory_rate)
        values (v_id, l.n, btrim(l.j ->> 'style'), nullif(btrim(l.j ->> 'description'), ''), nullif(btrim(l.j ->> 'colour'), ''),
                (l.j ->> 'qty')::integer, nullif(l.j ->> 'buyer_rate', '')::numeric,
                nullif(l.j ->> 'factory_id', '')::uuid, nullif(l.j ->> 'factory_rate', '')::numeric)
        returning id into v_old;
        v_done := v_done || v_old;
        continue;
      end if;
    end if;
    update public.order_lines set
      position = l.n, style = btrim(l.j ->> 'style'), description = nullif(btrim(l.j ->> 'description'), ''),
      colour = nullif(btrim(l.j ->> 'colour'), ''), qty = (l.j ->> 'qty')::integer,
      buyer_rate = nullif(l.j ->> 'buyer_rate', '')::numeric, factory_rate = nullif(l.j ->> 'factory_rate', '')::numeric,
      -- A style typed back in with no factory picked stays with its factory.
      factory_id = case when nullif(l.j ->> 'id', '') is not null then nullif(l.j ->> 'factory_id', '')::uuid
                        else coalesce(nullif(l.j ->> 'factory_id', '')::uuid, factory_id) end,
      removed_at = null
    where id = v_old and order_id = v_id
      and (removed_at is null or nullif(l.j ->> 'id', '') is null);
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'A style on this order was changed by someone else. Reload the page and try again.';
    end if;
    v_done := v_done || v_old;
  end loop;

  return v_id;
end $$;

-- ---------------------------------------------------------------- 3. the TNA saved over someone else's dates
-- The TNA screen sent every step it had changed with all three values as it had loaded them, so a done date
-- Quality entered in the meantime was wiped by the merchandiser's later save of a target on the same step.
-- Each changed step now also carries what the screen loaded ("was"); only the values the person changed are
-- written, and a value someone else changed in the meantime is refused instead of overwritten.
-- p_rows: [{line_id, stage, planned_on, done_on, not_needed, label, was: {planned_on, done_on, not_needed}}]
create or replace function public.save_line_stages(p_order uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_team boolean := public.can_edit_orders(v_company);
  v_row jsonb;
  v_line uuid;
  v_stage text;
  v_found boolean;
  s_plan date; s_done date; s_nn boolean;
  w_plan date; w_done date; w_nn boolean;
  n_plan date; n_done date; n_nn boolean;
  v_conflict boolean;
begin
  if not (v_team or public.is_quality(v_company)) then
    raise exception 'Only the orders team and Quality can change production.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;

  -- Rows without "was" come from a screen loaded before this change: they are saved as sent, as before.
  if v_team then
    insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed, label)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date,
           coalesce((r ->> 'not_needed')::boolean, false),
           coalesce(nullif(btrim(r ->> 'label'), ''),
                    (select x.label from public.line_stages x where x.line_id = (r ->> 'line_id')::uuid and x.stage = r ->> 'stage'))
    from jsonb_array_elements(p_rows) r
    where not (r ? 'was')
    on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on, not_needed = excluded.not_needed,
      label = coalesce(excluded.label, public.line_stages.label);
  else
    insert into public.line_stages (order_id, line_id, stage, done_on)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'done_on', '')::date
    from jsonb_array_elements(p_rows) r
    where not (r ? 'was')
    on conflict (line_id, stage) do update set done_on = excluded.done_on;
  end if;

  for v_row in select x from jsonb_array_elements(p_rows) x where x ? 'was' loop
    v_line := (v_row ->> 'line_id')::uuid;
    v_stage := v_row ->> 'stage';
    select s.planned_on, s.done_on, s.not_needed, true into s_plan, s_done, s_nn, v_found
    from public.line_stages s where s.line_id = v_line and s.stage = v_stage for update;
    if not coalesce(v_found, false) then
      s_plan := null; s_done := null; s_nn := false; v_found := false;
    end if;
    w_plan := nullif(v_row -> 'was' ->> 'planned_on', '')::date;
    w_done := nullif(v_row -> 'was' ->> 'done_on', '')::date;
    w_nn := coalesce((v_row -> 'was' ->> 'not_needed')::boolean, false);
    -- Start from what is stored and take only what this person changed. Quality changes done dates only.
    n_plan := s_plan; n_done := s_done; n_nn := s_nn;
    v_conflict := false;
    if nullif(v_row ->> 'done_on', '')::date is distinct from w_done then
      v_conflict := v_conflict or s_done is distinct from w_done;
      n_done := nullif(v_row ->> 'done_on', '')::date;
    end if;
    if v_team then
      if nullif(v_row ->> 'planned_on', '')::date is distinct from w_plan then
        v_conflict := v_conflict or s_plan is distinct from w_plan;
        n_plan := nullif(v_row ->> 'planned_on', '')::date;
      end if;
      if coalesce((v_row ->> 'not_needed')::boolean, false) is distinct from w_nn then
        v_conflict := v_conflict or s_nn is distinct from w_nn;
        n_nn := coalesce((v_row ->> 'not_needed')::boolean, false);
      end if;
    end if;
    -- A step marked not needed can't keep a date someone else entered meanwhile.
    if v_conflict or (n_nn and (n_plan is not null or n_done is not null)) then
      raise exception '% on % was changed by someone else while you had the page open. Reload the page and make your change again.',
        coalesce((select x.label from public.line_stages x where x.line_id = v_line and x.stage = v_stage and x.label is not null),
                 (array['Greige', 'Fit sample', 'Fabric', 'Printing / dyeing', 'Strike off', 'PP sample', 'Size set', 'Cutting',
                        'Stitching', 'Inline', 'Mid-line', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'])[array_position(array['greige',
                        'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                        'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'], v_stage)], 'A step'),
        coalesce((select l.style from public.order_lines l where l.id = v_line), 'a style');
    end if;
    if v_found and (n_plan, n_done, n_nn) is not distinct from (s_plan, s_done, s_nn) and nullif(btrim(v_row ->> 'label'), '') is null then
      continue;
    end if;
    if v_found then
      update public.line_stages set planned_on = n_plan, done_on = n_done, not_needed = n_nn,
        label = coalesce(case when v_team then nullif(btrim(v_row ->> 'label'), '') end, label)
      where line_id = v_line and stage = v_stage;
    else
      insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed, label)
      values (p_order, v_line, v_stage, n_plan, n_done, n_nn, case when v_team then nullif(btrim(v_row ->> 'label'), '') end);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. the factory's target date
-- A factory login could read the ship date of any order by its id. It now gets only orders it has a style on.
create or replace function public.factory_target(p_order uuid, p_factory uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce(o.revised_ship_date, o.ship_date) - coalesce(f.buffer_days, 0)
  from public.orders o left join public.factory_pos f on f.order_id = o.id and f.factory_id = p_factory
  where o.id = p_order
    and (public.is_member(o.company_id)
         or exists (select 1 from public.order_lines l
                    where l.order_id = o.id and l.factory_id = p_factory and l.removed_at is null
                      and l.company_id = public.current_company() and public.my_factory() = p_factory))
$$;

-- ---------------------------------------------------------------- 5. releasing a factory PO
-- A style moved to a factory nobody had asked could be released straight away, and with the ship date cleared
-- after the plan request there was no target date left to check against. Release now needs a ship date, the
-- factory asked for its plan, and the factory's answer (or the orders team's "factory agreed") to that request.
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_missing text;
  f public.factory_pos;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'This factory has no styles on the order.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory for update;
  if f.released_at is not null then
    return;
  end if;
  if public.factory_target(p_order, p_factory) is null then
    raise exception 'Enter the PO''s ship date first.';
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
  if f.id is null or (f.plan_requested_at is null and f.plan_requested_on is null) then
    raise exception 'Ask the factory for its plan first.';
  end if;
  if f.factory_sent_at is null or (f.plan_requested_at is not null and f.factory_sent_at < f.plan_requested_at) then
    raise exception 'The factory hasn''t sent its plan for your latest request yet. Wait for it, or press "Factory agreed to targets" if it agreed by phone.';
  end if;
  update public.factory_pos set released_at = now(), released_by = auth.uid()
  where id = f.id and released_at is null;
end $$;

-- The orders team enters the factory's agreed plan only while there is a ship date to plan against.
create or replace function public.accept_targets_for_factory(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_missing text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can enter a factory''s plan on an open order.';
  end if;
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory
                 and (plan_requested_at is not null or plan_requested_on is not null)) then
    raise exception 'Ask the factory for its plan first, so its target date is set.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    raise exception 'The PO is already released.';
  end if;
  if public.factory_target(p_order, p_factory) is null then
    raise exception 'Enter the PO''s ship date first.';
  end if;
  select string_agg(style || ' (' || steps || ')', '; ') into v_missing
  from public.tna_gaps(p_order, p_factory) where kind in ('target', 'beyond');
  if v_missing is not null then
    raise exception 'Set every target on or before the target date first: %', v_missing;
  end if;
  perform set_config('sourcingo.plan_for_factory', 'on', true);
  update public.line_stages s set factory_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and not s.not_needed and s.factory_on is distinct from s.planned_on;
  perform set_config('sourcingo.plan_for_factory', 'off', true);
  update public.factory_pos set factory_sent_at = now(), plan_entered_by = auth.uid()
  where order_id = p_order and factory_id = p_factory;
end $$;

-- The factory saves its dates only while there is a target date to keep them within.
create or replace function public.save_factory_tna(p_order uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
  v_company uuid := public.current_company();
  v_target date;
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
  v_target := public.factory_target(p_order, v_factory);
  if v_target is null then
    raise exception 'Enter the PO''s ship date first.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where nullif(r ->> 'factory_on', '')::date > v_target) then
    raise exception 'Every date must be on or before the target date %.', to_char(v_target, 'DD Mon YYYY');
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

-- ---------------------------------------------------------------- 6. QC needs a photo, always
-- Quality could write a QC check straight into the table with no photo, and take the last photo off a check.
-- Checks are now recorded only through record_qc (which needs a photo), and a live check keeps at least one photo or report.
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
     or not exists (select 1 from jsonb_array_elements(p_files) f where f ->> 'kind' = 'photo') then
    raise exception 'Add at least one photo as proof of the check.';
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
revoke insert on public.qc_checks from authenticated;

create or replace function public.keep_one_qc_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The team often keeps the signed QC report and takes the photo off, so a report also counts as proof here.
  if old.removed_at is null and new.removed_at is not null then
    -- Lock the check so two people can't each take off one of its last two files at the same time.
    perform 1 from public.qc_checks q where q.id = old.qc_id for update;
    if exists (select 1 from public.qc_checks q where q.id = old.qc_id and q.cancelled_at is null)
       and not exists (select 1 from public.qc_photos p where p.qc_id = old.qc_id and p.id <> old.id
                       and p.removed_at is null) then
      raise exception 'A QC check needs at least one photo or report as proof. Add another before removing this one.';
    end if;
  end if;
  return new;
end $$;
create trigger qc_photos_keep_one before update on public.qc_photos
  for each row execute function public.keep_one_qc_photo();
revoke execute on function public.keep_one_qc_photo() from public, anon, authenticated;
