-- The owner locks every factory PO (0048). Dheeraj chose this on 20 Oct 2026, as in the first version of the app:
-- the orders team plans a factory's styles and sends the plan for the owner's lock; only the owner releases the PO,
-- which locks the targets as before. The owner can also send a plan back with a reason the team sees.
-- POs already released stay released.

alter table public.factory_pos
  add column lock_requested_at timestamptz,
  add column lock_requested_by uuid references public.profiles (id),
  -- Why the owner sent the plan back, until it is sent for the lock again.
  add column lock_note text check (length(lock_note) <= 300),
  add column lock_note_at timestamptz;

-- What still stops a factory's PO from being released, in words, or null when nothing does.
-- These are the checks release_factory_po made itself (0036), moved here so sending for the lock makes them too.
create function public.release_blocker(p_order uuid, p_factory uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text;
  f public.factory_pos;
begin
  if not exists (select 1 from public.orders where id = p_order and status = 'open' and company_id = public.current_company()) then
    return 'This order isn''t open.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    return 'This factory has no styles on the order.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory;
  if f.released_at is not null then
    return null;
  end if;
  if public.factory_target(p_order, p_factory) is null then
    return 'Enter the PO''s ship date first.';
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
    return 'The plan is not complete yet. Missing: ' || v_missing;
  end if;
  if f.id is null or (f.plan_requested_at is null and f.plan_requested_on is null) then
    return 'Ask the factory for its plan first.';
  end if;
  if f.factory_sent_at is null or (f.plan_requested_at is not null and f.factory_sent_at < f.plan_requested_at) then
    return 'The factory hasn''t sent its plan for your latest request yet. Wait for it, or press "Factory agreed to targets" if it agreed by phone.';
  end if;
  return null;
end $$;
revoke execute on function public.release_blocker(uuid, uuid) from public, anon;
grant execute on function public.release_blocker(uuid, uuid) to authenticated;

-- The orders team sends a complete plan for the owner's lock.
create function public.request_po_lock(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send a plan for the lock on an open order.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    raise exception 'The PO is already released.';
  end if;
  v_block := public.release_blocker(p_order, p_factory);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  update public.factory_pos
  set lock_requested_at = now(), lock_requested_by = auth.uid(), lock_note = null, lock_note_at = null
  where order_id = p_order and factory_id = p_factory;
end $$;
revoke execute on function public.request_po_lock(uuid, uuid) from public, anon;
grant execute on function public.request_po_lock(uuid, uuid) to authenticated;

-- The owner sends a plan back to the team, saying what to change.
create function public.send_back_po_lock(p_order uuid, p_factory uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or v_company is distinct from public.current_company() or not public.is_owner(v_company) then
    raise exception 'Only the owner can send a plan back.';
  end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say what to change, so the team knows.';
  end if;
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is null) then
    raise exception 'There is no plan waiting for the lock on this factory.';
  end if;
  update public.factory_pos
  set lock_requested_at = null, lock_requested_by = null, lock_note = left(btrim(p_note), 300), lock_note_at = now()
  where order_id = p_order and factory_id = p_factory and released_at is null;
end $$;
revoke execute on function public.send_back_po_lock(uuid, uuid, text) from public, anon;
grant execute on function public.send_back_po_lock(uuid, uuid, text) to authenticated;

-- Only the owner releases (locks) a factory PO now. The checks are the same as before.
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
  f public.factory_pos;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not public.is_owner(v_company) then
    raise exception 'Only the owner locks and releases a factory PO. Send the plan for the owner''s lock.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory for update;
  if f.released_at is not null then
    return;
  end if;
  v_block := public.release_blocker(p_order, p_factory);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  update public.factory_pos set released_at = now(), released_by = auth.uid(), lock_note = null, lock_note_at = null
  where id = f.id and released_at is null;
  -- The plan as released is the baseline that later lateness is measured from.
  update public.line_stages s set baseline_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and s.baseline_on is null and s.planned_on is not null and not s.not_needed;
end $$;
-- The lock columns get no update grant (factory_pos grants updates column by column), so they move only through
-- the functions above.
