-- The factory asks for a new date on a step (step 8 of the buyer and factory sides). Once the PO is released the
-- factory's dates are fixed, so a slip used to reach the team only by phone. Now the factory picks a style's step that
-- isn't done, gives the new date and why; the order's merchandiser (the owner's when no one owns the order) sees it on
-- Home and agrees or says no from the order's Styles tab. Agreeing moves the factory's date for that step; the team's
-- own target stays where it is, so lateness still shows.

create table public.factory_date_asks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  factory_id uuid not null,
  stage text not null,
  -- The factory's date when it asked (its plan date, or the team's target when it gave none).
  old_on date,
  new_on date not null,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- null while waiting; true agreed, false not agreed.
  agreed boolean,
  answer text check (length(answer) <= 300),
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  check ((agreed is null) = (answered_at is null)),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
-- One open ask per step at a time.
create unique index factory_date_asks_open_idx on public.factory_date_asks (line_id, stage) where answered_at is null;
create index factory_date_asks_order_idx on public.factory_date_asks (order_id, created_at desc);
alter table public.factory_date_asks enable row level security;
revoke all on public.factory_date_asks from anon, authenticated;
-- The team reads them; the factory asks and reads its own only through the functions below.
grant select on public.factory_date_asks to authenticated;
create policy factory_date_asks_read on public.factory_date_asks for select to authenticated using (public.is_member(company_id));

-- The factory asks, from its own login, on a step of its own style on a released PO.
create function public.ask_factory_date(p_line uuid, p_stage text, p_new date, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_step record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_old date;
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or public.my_factory() is null or not public.factory_owns_line(v_line.company_id, v_line.order_id, p_line) then
    raise exception 'You can ask only on your own styles on a released PO.';
  end if;
  select s.planned_on, s.factory_on, s.done_on into v_step from public.style_steps(p_line) s where s.stage = p_stage;
  if not found then
    raise exception 'Pick a step of this style.';
  end if;
  if v_step.done_on is not null then
    raise exception 'That step is already done.';
  end if;
  if p_new is null then
    raise exception 'Pick the new date.';
  end if;
  if p_new < public.india_today() then
    raise exception 'The new date can''t be in the past.';
  end if;
  if p_new > public.india_today() + 180 then
    raise exception 'Pick a date within the next 6 months.';
  end if;
  v_old := coalesce(v_step.factory_on, v_step.planned_on);
  if p_new = v_old then
    raise exception 'That is the date it already has.';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Say why the date moves.';
  end if;
  if length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters.';
  end if;
  if exists (select 1 from public.factory_date_asks where line_id = p_line and stage = p_stage and answered_at is null) then
    raise exception 'You already asked for a new date on this step. Sourcingo will answer soon.';
  end if;
  insert into public.factory_date_asks (company_id, order_id, line_id, factory_id, stage, old_on, new_on, reason)
  values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_stage, v_old, p_new, v_reason)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.ask_factory_date(uuid, text, date, text) from public, anon;
grant execute on function public.ask_factory_date(uuid, text, date, text) to authenticated;

-- The orders team agrees or says no. Agreeing moves the factory's date for the step (the target stays).
create function public.answer_factory_date(p_id uuid, p_agree boolean, p_answer text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  a public.factory_date_asks;
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
begin
  select * into a from public.factory_date_asks where id = p_id and company_id = public.current_company() for update;
  if a.id is null or not public.can_edit_orders(a.company_id) then
    raise exception 'Only the orders team can answer the factory.';
  end if;
  if a.answered_at is not null then
    raise exception 'Someone already answered this. Reload the page.';
  end if;
  if p_agree is null then
    raise exception 'Agree or say no.';
  end if;
  if length(v_answer) > 300 then
    raise exception 'Keep the answer under 300 characters.';
  end if;
  if p_agree then
    if exists (select 1 from public.line_stages where line_id = a.line_id and stage = a.stage and done_on is not null) then
      raise exception 'That step is already done, so its date can''t move. Say no instead.';
    end if;
    perform set_config('sourcingo.plan_for_factory', 'on', true);
    perform set_config('sourcingo.date_ask', 'on', true);
    insert into public.line_stages (company_id, order_id, line_id, stage, factory_on)
    values (a.company_id, a.order_id, a.line_id, a.stage, a.new_on)
    on conflict (line_id, stage) do update set factory_on = excluded.factory_on;
    perform set_config('sourcingo.plan_for_factory', 'off', true);
    perform set_config('sourcingo.date_ask', 'off', true);
  end if;
  update public.factory_date_asks set agreed = p_agree, answer = v_answer, answered_by = auth.uid(), answered_at = now()
  where id = p_id;
  return p_agree;
end $$;
revoke execute on function public.answer_factory_date(uuid, boolean, text) from public, anon;
grant execute on function public.answer_factory_date(uuid, boolean, text) to authenticated;

-- The asks of the factory whose panel this is (its own login, or a team member's preview): every open one, and the
-- answered ones of the last 30 days. Who answered stays inside: the factory sees "Sourcingo".
create function public.factory_date_asks_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'order_id', a.order_id, 'line_id', a.line_id, 'stage', a.stage,
                                               'old_on', a.old_on, 'new_on', a.new_on, 'reason', a.reason, 'at', a.created_at,
                                               'agreed', a.agreed, 'answer', a.answer, 'answered_at', a.answered_at)
                            order by a.created_at desc), '[]'::jsonb)
  from public.factory_date_asks a
  join public.order_lines l on l.id = a.line_id and l.removed_at is null and l.factory_id = a.factory_id
  join public.orders o on o.id = a.order_id and o.status = 'open' and o.removed_at is null
  where a.company_id = public.current_company() and a.factory_id = public.viewing_factory()
    and (a.answered_at is null or a.answered_at > now() - interval '30 days')
$$;
revoke execute on function public.factory_date_asks_mine() from public, anon;
grant execute on function public.factory_date_asks_mine() to authenticated;

-- check_line_stage as in 0069, with one change: a team member answering a factory's ask may set the factory's date
-- after release (answer_factory_date turns sourcingo.date_ask on for that one write).
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
    -- answer_factory_date sets sourcingo.date_ask for its own transaction when the team agrees to a factory's new date.
    if v_released and not (v_for_factory and (new.factory_on is null or current_setting('sourcingo.date_ask', true) = 'on')) then
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

