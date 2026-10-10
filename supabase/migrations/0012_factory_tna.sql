-- Two sides of the TNA. The factory enters its own dates for every step in its own panel; the merchandiser
-- enters the planned dates. The factory PO is released only once both sides are in for every step.
-- After release, the merchandiser and Quality both enter done dates.

-- A factory login: a member with the factory role, tied to one factory. It sees nothing of the company
-- through the usual rules; its panel reads and writes only through the functions below.
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality', 'factory'));
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality', 'factory'));
alter table public.members add column factory_id uuid,
  add constraint members_factory_fk foreign key (company_id, factory_id) references public.factories (company_id, id),
  add constraint members_factory_set check (role <> 'factory' or factory_id is not null);
alter table public.invites add column factory_id uuid,
  add constraint invites_factory_fk foreign key (company_id, factory_id) references public.factories (company_id, id),
  add constraint invites_factory_set check (role <> 'factory' or factory_id is not null);

-- Company members are the staff; a factory login is not one of them.
create or replace function public.is_member(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role(p_company) <> 'factory', false) $$;

-- The factory the signed-in factory login belongs to.
create function public.my_factory() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.factory_id from public.members m
  where m.company_id = public.current_company() and m.user_id = auth.uid() and m.active and m.role = 'factory'
$$;
revoke execute on function public.my_factory() from public, anon;
grant execute on function public.my_factory() to authenticated;

create or replace function public.accept_invites(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (company_id, user_id, role, factory_id)
  select i.company_id, p_user, i.role, i.factory_id from public.invites i where i.email = lower(btrim(p_email)) and i.closed_at is null
  on conflict (company_id, user_id) do nothing;
  update public.invites set closed_at = now() where email = lower(btrim(p_email)) and closed_at is null;
  update public.profiles set current_company_id = (
    select company_id from public.members where user_id = p_user and active order by created_at limit 1)
  where id = p_user and current_company_id is null;
end $$;

-- The owner adds a factory login by email, for one of the company's factories.
create function public.add_factory_member(p_email text, p_factory uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if not public.is_owner(v_company) then
    raise exception 'Only the owner can add people.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.';
  end if;
  if not exists (select 1 from public.factories where id = p_factory and company_id = v_company) then
    raise exception 'Pick one of your factories.';
  end if;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is null then
    insert into public.invites (company_id, email, role, factory_id, created_by) values (v_company, v_email, 'factory', p_factory, auth.uid())
    on conflict (company_id, email) do update set role = 'factory', factory_id = excluded.factory_id, created_by = excluded.created_by, closed_at = null;
    return 'invited';
  end if;
  if exists (select 1 from public.members where company_id = v_company and user_id = v_user and role <> 'factory') then
    raise exception 'That person is already on the team. Use a separate email for the factory login.';
  end if;
  insert into public.members (company_id, user_id, role, factory_id) values (v_company, v_user, 'factory', p_factory)
  on conflict (company_id, user_id) do update set factory_id = excluded.factory_id, active = true;
  update public.profiles set current_company_id = v_company where id = v_user and current_company_id is null;
  return 'added';
end $$;
revoke execute on function public.add_factory_member(text, uuid) from public, anon;
grant execute on function public.add_factory_member(text, uuid) to authenticated;

-- A staff role can't be switched to factory (it needs a factory), and a factory login can't become staff.
create function public.check_member_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (old.role = 'factory') <> (new.role = 'factory') then
    raise exception 'A factory login stays a factory login. Add the person again with the right role.';
  end if;
  return new;
end $$;
create trigger members_check_role before update on public.members
  for each row execute function public.check_member_role();
revoke execute on function public.check_member_role() from public, anon, authenticated;

-- The factory's own date for each step, and when the factory sent its TNA.
-- A step marked not needed simply ignores any date the factory gave for it.
alter table public.line_stages add column factory_on date;
-- The plan request: when it was sent (the factory has 24 hours to answer), and the buffer the merchandiser keeps
-- before the PO's delivery date. The factory's dates must all fall on or before that target date.
alter table public.factory_pos add column factory_sent_at timestamptz,
  add column plan_requested_at timestamptz,
  add column buffer_days integer check (buffer_days between 0 and 90);
grant insert (plan_requested_at, buffer_days), update (plan_requested_at, buffer_days) on public.factory_pos to authenticated;

-- Some steps every style goes through; they can never be marked not needed.
alter table public.line_stages add constraint line_stages_mandatory
  check (not (not_needed and stage in ('pp_sample', 'fabric', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory')));

-- The last date the factory may plan for: the PO's delivery date less the merchandiser's buffer.
create function public.factory_target(p_order uuid, p_factory uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce(o.revised_ship_date, o.ship_date) - coalesce(f.buffer_days, 0)
  from public.orders o left join public.factory_pos f on f.order_id = o.id and f.factory_id = p_factory
  where o.id = p_order
$$;
revoke execute on function public.factory_target(uuid, uuid) from public, anon;
grant execute on function public.factory_target(uuid, uuid) to authenticated;

-- The merchandiser asks a factory for its TNA, with the buffer to keep before delivery. Asking again restarts the 24 hours.
create function public.request_factory_plan(p_order uuid, p_factory uuid, p_buffer_days integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid;
  v_due date;
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
  insert into public.factory_pos (order_id, factory_id, plan_requested_on, plan_requested_at, buffer_days)
  values (p_order, p_factory, public.india_today(), now(), p_buffer_days)
  on conflict (order_id, factory_id) do update
    set plan_requested_on = excluded.plan_requested_on, plan_requested_at = excluded.plan_requested_at, buffer_days = excluded.buffer_days;
end $$;
revoke execute on function public.request_factory_plan(uuid, uuid, integer) from public, anon;
grant execute on function public.request_factory_plan(uuid, uuid, integer) to authenticated;

-- Quality enters done dates too.
create policy line_stages_quality_insert on public.line_stages for insert to authenticated with check (public.is_quality(company_id));
create policy line_stages_quality_update on public.line_stages for update to authenticated
  using (public.is_quality(company_id)) with check (public.is_quality(company_id));

-- Who may change what on a TNA step: the plan and not-needed by the orders team, done dates by the orders team
-- and Quality, the factory's dates only by the factory (through save_factory_tna), and only before release.
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
      or new.not_needed is distinct from (case when tg_op = 'INSERT' then false else old.not_needed end))
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

-- The orders team saves plans and done dates; Quality saves done dates only.
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
    insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date,
           coalesce((r ->> 'not_needed')::boolean, false)
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on, not_needed = excluded.not_needed;
  else
    insert into public.line_stages (order_id, line_id, stage, done_on)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'done_on', '')::date
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set done_on = excluded.done_on;
  end if;
end $$;

-- Release needs, for every style: a factory rate, and for every step either "not needed" or both the factory's date and the plan.
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_steps text[] := array['greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
    'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory'];
  v_labels text[] := array['Greige', 'Fit sample', 'Strike off', 'PP sample', 'Size set',
    'Fabric', 'Printing', 'Cutting', 'Stitching', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'];
  v_missing text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'This factory has no styles on the order.';
  end if;
  with gaps as (
    select l.id, l.style, l.position, l.factory_rate,
      (select string_agg(v_labels[array_position(v_steps, st)], ', ' order by array_position(v_steps, st)) from unnest(v_steps) st
        where not exists (select 1 from public.line_stages s where s.line_id = l.id and s.stage = st and (s.factory_on is not null or s.not_needed))) as factory_gaps,
      (select string_agg(v_labels[array_position(v_steps, st)], ', ' order by array_position(v_steps, st)) from unnest(v_steps) st
        where not exists (select 1 from public.line_stages s where s.line_id = l.id and s.stage = st and (s.planned_on is not null or s.not_needed))) as plan_gaps
    from public.order_lines l
    where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
  )
  select string_agg(style || ' (' || concat_ws('; ',
           case when factory_rate is null then 'factory rate' end,
           case when factory_gaps is not null then 'factory dates: ' || factory_gaps end,
           case when plan_gaps is not null then 'plan: ' || plan_gaps end) || ')', ' | ' order by position)
    into v_missing
  from gaps where factory_rate is null or factory_gaps is not null or plan_gaps is not null;
  if v_missing is not null then
    raise exception 'The plan is not complete yet. Missing: %', v_missing;
  end if;
  if exists (select 1 from public.line_stages s join public.order_lines l on l.id = s.line_id
             where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null and not s.not_needed
               and greatest(s.planned_on, s.factory_on) > public.factory_target(p_order, p_factory)) then
    raise exception 'Some dates fall after the target date %. Bring them on or before it.', to_char(public.factory_target(p_order, p_factory), 'DD Mon YYYY');
  end if;
  insert into public.factory_pos (company_id, order_id, factory_id, released_at, released_by)
  values (v_company, p_order, p_factory, now(), auth.uid())
  on conflict (order_id, factory_id) do update set released_at = now(), released_by = auth.uid()
  where public.factory_pos.released_at is null;
end $$;

-- The factory panel: the factory's name and the open orders it has been asked to plan (or already has), its styles, and its own TNA dates.
-- The merchandiser's plan and the done dates show once the PO is released. No buyer, no buyer prices.
create function public.factory_tna() returns jsonb
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
              'stage', s.stage, 'factory_on', s.factory_on, 'not_needed', s.not_needed,
              'planned_on', case when f.released_at is not null then s.planned_on end,
              'done_on', case when f.released_at is not null then s.done_on end)), '[]'::jsonb)
            from public.line_stages s where s.line_id = l.id)) order by l.position)
        from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null))
      order by f.released_at is not null, coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
    from public.orders o
    join public.factory_pos f on f.order_id = o.id and f.factory_id = v_factory
      and (f.plan_requested_at is not null or f.plan_requested_on is not null or f.released_at is not null)
    where o.company_id = public.current_company() and o.status = 'open'
      and exists (select 1 from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null)
  ), '[]'::jsonb));
end $$;
revoke execute on function public.factory_tna() from public, anon;
grant execute on function public.factory_tna() to authenticated;

-- The factory saves its dates for one order (only its own styles, only before release), and that counts as sending its TNA.
-- p_rows: [{line_id, stage, factory_on}]; a blank date clears it.
create function public.save_factory_tna(p_order uuid, p_rows jsonb) returns void
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
  if exists (select 1 from jsonb_array_elements(p_rows) r where nullif(r ->> 'factory_on', '')::date > public.factory_target(p_order, v_factory)) then
    raise exception 'Every date must be on or before the target date %.', to_char(public.factory_target(p_order, v_factory), 'DD Mon YYYY');
  end if;
  insert into public.line_stages (company_id, order_id, line_id, stage, factory_on)
  select v_company, p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'factory_on', '')::date
  from jsonb_array_elements(p_rows) r
  on conflict (line_id, stage) do update set factory_on = excluded.factory_on
  where not public.line_stages.not_needed;
  insert into public.factory_pos (company_id, order_id, factory_id, factory_sent_at)
  values (v_company, p_order, v_factory, now())
  on conflict (order_id, factory_id) do update set factory_sent_at = now();
end $$;
revoke execute on function public.save_factory_tna(uuid, jsonb) from public, anon;
grant execute on function public.save_factory_tna(uuid, jsonb) to authenticated;
