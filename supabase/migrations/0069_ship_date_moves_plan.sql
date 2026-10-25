-- A new ship date moves the plan with it (Dheeraj, 25 Oct 2026). Before, only the ship date changed: every
-- unfinished step kept its old target, so the order still read as late everywhere and the owner had to move
-- each locked target by hand.
--  * move_ship_date sets the new ship date and its reason, and moves every unfinished target later by the same
--    number of days. Done steps and steps marked not needed stay as they are. Each moved target keeps its
--    original date (baseline) and gets the reason as its note, so the order still shows what it was.
--  * check_line_stage lets that one function move released targets for the orders team.

create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
  v_released boolean;
  v_for_factory boolean;
  v_reason text := btrim(coalesce(current_setting('sourcingo.target_reason', true), ''));
begin
  select l.factory_id into v_factory from public.order_lines l
  where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id;
  if not found then
    raise exception 'That style is not on this order.';
  end if;
  v_released := exists (select 1 from public.factory_pos f where f.order_id = new.order_id and f.factory_id = v_factory and f.released_at is not null);
  -- The baseline is written once: at release, or when a step is first planned after release.
  if tg_op = 'UPDATE' and old.baseline_on is not null then
    new.baseline_on := old.baseline_on;
  elsif v_released and new.baseline_on is null and not new.not_needed then
    new.baseline_on := new.planned_on;
  end if;
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
  -- After release a target that was set stays put: moving it (or dropping its step) would hide lateness.
  if tg_op = 'UPDATE' and v_released and old.planned_on is not null
     and (new.planned_on is distinct from old.planned_on or (new.not_needed and not old.not_needed)) then
    -- move_ship_date shifts the unfinished targets with a new ship date, for the orders team too.
    if not public.is_owner(new.company_id) and coalesce(current_setting('sourcingo.ship_move', true), '') <> 'on' then
      raise exception 'Targets are locked once the factory PO is released. Ask the owner to move one, with a reason.';
    end if;
    if v_reason = '' then
      raise exception 'Say why the target moves. Targets are locked once the PO is released.';
    end if;
    new.target_note := left(v_reason, 300);
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
    if not (public.can_edit_orders(new.company_id) or public.is_quality(new.company_id)
            or (current_setting('sourcingo.sample_approval', true) = 'on'
                and exists (select 1 from public.sample_rounds r where r.line_id = new.line_id and r.stage = new.stage
                            and r.status = 'approved' and r.approved_on = new.done_on))) then
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

create or replace function public.move_ship_date(p_order uuid, p_new date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_o public.orders%rowtype;
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
  v_shift integer;
  v_moved integer := 0;
begin
  select * into v_o from public.orders where id = p_order and company_id = public.current_company() for update;
  if not found then
    raise exception 'That order wasn''t found.';
  end if;
  if not public.can_edit_orders(v_o.company_id) then
    raise exception 'Only the orders team can change orders.';
  end if;
  if v_o.status <> 'open' then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;
  -- Cleared: back to the buyer's date. Targets stay where they are.
  if p_new is null then
    update public.orders set revised_ship_date = null, delay_reason = nullif(v_reason, '') where id = p_order;
    return 0;
  end if;
  if v_reason = '' then
    raise exception 'Say why the ship date moved, so everyone knows.';
  end if;
  v_shift := p_new - coalesce(v_o.revised_ship_date, v_o.ship_date);
  update public.orders set revised_ship_date = p_new, delay_reason = v_reason where id = p_order;
  -- Only a later date moves the plan: an earlier one would put targets in the past without anyone choosing them.
  if v_shift > 0 then
    perform set_config('sourcingo.target_reason', 'Ship date moved to ' || to_char(p_new, 'FMDD Mon') || ': ' || v_reason, true);
    perform set_config('sourcingo.ship_move', 'on', true);
    update public.line_stages set planned_on = planned_on + v_shift
    where order_id = p_order and done_on is null and not not_needed and planned_on is not null;
    get diagnostics v_moved = row_count;
    perform set_config('sourcingo.ship_move', '', true);
    perform set_config('sourcingo.target_reason', '', true);
  end if;
  return v_moved;
end $$;
revoke all on function public.move_ship_date(uuid, date, text) from public, anon;
grant execute on function public.move_ship_date(uuid, date, text) to authenticated;
