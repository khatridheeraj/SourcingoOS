-- Sample approvals (Dheeraj, 21 Oct 2026: "go"). Fit, strike off, PP and size-set samples stop being chased over
-- WhatsApp and email:
--  * The factory sends a sample from its panel with photos. Each send is a round of that style's step.
--  * The orders team checks it, then sends it to the buyer with the courier and AWB number, or sends it back.
--  * The buyer approves it or asks for changes in its own page, with comments and photos. The team can record the
--    buyer's answer for it too (most buyers still answer by email or WhatsApp).
--  * An approval closes the style's TNA step on the day it was approved. Changes open the next round for the factory.
-- Every style keeps its own rounds (one style, one TNA). A buyer sees only its own orders' samples, and only once the
-- team has sent them; it never sees which factory made them. The factory sees the answers, not the buyer.

-- ---------------------------------------------------------------- the rounds
create table public.sample_rounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  factory_id uuid not null,
  stage text not null check (stage in ('fit_sample', 'strike_off', 'pp_sample', 'size_set')),
  round smallint not null check (round between 1 and 50),
  -- with_team: sent by the factory, the team checks it. returned: the team sent it back to the factory.
  -- with_buyer: on its way to or with the buyer. approved / changes: the buyer's answer.
  status text not null default 'with_team' check (status in ('with_team', 'returned', 'with_buyer', 'approved', 'changes')),
  note text check (length(note) <= 500),
  photos text[] not null check (cardinality(photos) between 1 and 10),
  sent_by uuid default auth.uid() references public.profiles (id),
  sent_at timestamptz not null default now(),
  sent_by_team boolean not null default false,
  courier text check (length(courier) <= 60),
  awb text check (length(awb) <= 60),
  dispatched_on date,
  buyer_note text check (length(buyer_note) <= 500),
  forwarded_by uuid references public.profiles (id),
  forwarded_at timestamptz,
  answer_note text check (length(answer_note) <= 1000),
  answer_photos text[] not null default '{}' check (cardinality(answer_photos) <= 10),
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  answered_for_buyer boolean not null default false,
  approved_on date,
  unique (line_id, stage, round),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id),
  check ((status = 'approved') = (approved_on is not null))
);
-- One round of a style's sample is open at a time: with the team or with the buyer.
create unique index sample_rounds_open_key on public.sample_rounds (line_id, stage) where status in ('with_team', 'with_buyer');
create index sample_rounds_order_idx on public.sample_rounds (order_id, line_id, stage, round);
create index sample_rounds_status_idx on public.sample_rounds (company_id, status);
alter table public.sample_rounds enable row level security;
-- The team reads them; nobody writes them directly, only through the functions below.
create policy sample_rounds_read on public.sample_rounds for select to authenticated using (public.is_member(company_id));
revoke all on public.sample_rounds from anon, authenticated;
grant select on public.sample_rounds to authenticated;

-- ---------------------------------------------------------------- who may do what
-- The buyer the signed-in buyer login belongs to owns this open order.
create function public.buyer_owns_order(p_company uuid, p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_buyer() is not null and exists (
    select 1 from public.orders o where o.id = p_order and o.company_id = p_company and o.company_id = public.current_company()
      and o.buyer_id = public.my_buyer() and o.status = 'open')
$$;
revoke execute on function public.buyer_owns_order(uuid, uuid) from public, anon;
grant execute on function public.buyer_owns_order(uuid, uuid) to authenticated;

-- Photos of the buyer's answer and of a sample the team adds itself go under <company>/<order>/samples/<line>/.
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[2] = 'help' then
    return array_length(v_parts, 1) = 4 and v_parts[3] = auth.uid()::text and public.my_role(v_company) is not null;
  end if;
  if v_parts[3] = 'qc' then
    return public.is_quality(v_company);
  end if;
  if v_parts[3] = 'factory' then
    return array_length(v_parts, 1) = 5 and public.factory_owns_line(v_company, v_parts[2]::uuid, v_parts[4]::uuid);
  end if;
  if v_parts[3] = 'samples' then
    return array_length(v_parts, 1) = 5 and (public.can_edit_orders(v_company) or public.buyer_owns_order(v_company, v_parts[2]::uuid));
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;

-- A buyer opens the photos of its own samples once the team has sent them on, and the photos of its own answers.
create or replace function public.buyer_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null or v_parts[3] not in ('qc', 'styles', 'factory', 'samples') then
    return false;
  end if;
  if v_parts[3] = 'qc' then
    return exists (
      select 1 from public.qc_photos p
      join public.qc_checks q on q.id = p.qc_id
      join public.order_lines l on l.id = q.line_id and l.removed_at is null
      join public.orders o on o.id = q.order_id
      where p.path = p_name and p.removed_at is null and p.kind = 'photo'
        and q.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
        and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
        and q.id = (select q2.id from public.qc_checks q2
                    where q2.line_id = l.id and q2.kind in ('final', 'recheck') and q2.cancelled_at is null
                    order by q2.checked_on desc, q2.created_at desc limit 1));
  end if;
  if v_parts[3] in ('factory', 'samples') then
    return exists (
      select 1 from public.sample_rounds r join public.orders o on o.id = r.order_id
      where r.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and r.status in ('with_buyer', 'approved', 'changes') and (p_name = any (r.photos) or p_name = any (r.answer_photos)));
  end if;
  return exists (select 1 from public.orders o where o.id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
                 and o.company_id = public.current_company() and o.buyer_id = v_buyer);
exception when invalid_text_representation then
  return false;
end $$;

-- A factory opens the photos of the answers to its own styles' samples.
create or replace function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if public.my_factory() is null then
    return false;
  end if;
  if v_parts[3] = 'files' then
    return exists (select 1 from public.line_files f join public.order_lines l on l.id = f.line_id and l.removed_at is null
                   where f.path = p_name and f.removed_at is null and f.kind in ('tech_pack', 'cutting')
                     and f.company_id = public.current_company() and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] = 'samples' then
    return exists (select 1 from public.sample_rounds r
                   where r.line_id = v_parts[4]::uuid and r.order_id = v_parts[2]::uuid and r.company_id = v_parts[1]::uuid
                     and r.company_id = public.current_company() and r.factory_id = public.my_factory()
                     and (p_name = any (r.answer_photos) or p_name = any (r.photos)));
  end if;
  if v_parts[3] <> 'factory' then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;

-- An approved sample enters its step's done date, whoever approved it (the buyer too). The approval sets the flag
-- below for its own transaction, and only a step with an approved round of that sample counts.
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
    if not public.is_owner(new.company_id) then
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

-- Samples go through their own flow, so the buyer approves them: the factory sends them with Send sample.
create or replace function public.post_step_update(p_line uuid, p_stage text, p_done_on date, p_note text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line;
  if v_line.id is null or not public.factory_owns_line(v_line.company_id, v_line.order_id, p_line) then
    raise exception 'You can update only your own styles on a released PO.';
  end if;
  if p_stage in ('final_qc', 'ex_factory') then
    raise exception 'Final QC and ex-factory are entered by Sourcingo, not the factory.';
  end if;
  if p_stage in ('fit_sample', 'strike_off', 'pp_sample', 'size_set') then
    raise exception 'Samples go to the buyer for approval. Use Send sample for this step.';
  end if;
  if not exists (select 1 from public.style_steps(p_line) s where s.stage = p_stage) then
    raise exception 'That step is not on this style.';
  end if;
  if exists (select 1 from public.line_stages s where s.line_id = p_line and s.stage = p_stage and s.done_on is not null) then
    raise exception 'That step is already marked done.';
  end if;
  if p_done_on is null or p_done_on > public.india_today() or p_done_on < public.india_today() - 30 then
    raise exception 'Give the date the step was done: today or in the last 30 days.';
  end if;
  if coalesce(cardinality(p_photos), 0) = 0 then
    raise exception 'Add at least one photo of the work.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Send at most 10 photos.';
  end if;
  if exists (select 1 from unnest(p_photos) p where p not like v_line.company_id || '/' || v_line.order_id || '/factory/' || p_line || '/%') then
    raise exception 'Those photos are not from this style.';
  end if;
  update public.step_updates set done_on = p_done_on, note = nullif(btrim(p_note), ''), photos = p_photos, created_by = auth.uid(), created_at = now()
  where line_id = p_line and stage = p_stage and status = 'pending'
  returning id into v_id;
  if v_id is null then
    insert into public.step_updates (company_id, order_id, line_id, factory_id, stage, done_on, note, photos)
    values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_stage, p_done_on, nullif(btrim(p_note), ''), p_photos)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- sending, checking, answering
-- The factory sends a sample of its own style, or the orders team adds one the factory sent another way.
-- Returns the new round's id.
create function public.send_sample(p_line uuid, p_stage text, p_note text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_team boolean;
  v_last public.sample_rounds%rowtype;
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or v_line.company_id is distinct from public.current_company() then
    raise exception 'That style is not on an open order.';
  end if;
  v_team := public.can_edit_orders(v_line.company_id);
  if not v_team and not public.factory_owns_line(v_line.company_id, v_line.order_id, p_line) then
    raise exception 'Only the factory making this style, or the orders team, can send its sample.';
  end if;
  if not exists (select 1 from public.orders where id = v_line.order_id and status = 'open') then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if v_line.factory_id is null or not exists (select 1 from public.factory_pos f where f.order_id = v_line.order_id
                                               and f.factory_id = v_line.factory_id and f.released_at is not null) then
    raise exception 'Samples are sent once the factory PO is released.';
  end if;
  if p_stage is null or p_stage not in ('fit_sample', 'strike_off', 'pp_sample', 'size_set') then
    raise exception 'Samples are for the fit, strike off, PP and size-set steps.';
  end if;
  if not exists (select 1 from public.style_steps(p_line) s where s.stage = p_stage) then
    raise exception 'That step is not on this style.';
  end if;
  if exists (select 1 from public.line_stages s where s.line_id = p_line and s.stage = p_stage and s.done_on is not null) then
    raise exception 'This step is already done, so no sample is needed.';
  end if;
  select * into v_last from public.sample_rounds where line_id = p_line and stage = p_stage order by round desc limit 1;
  if v_last.status in ('with_team', 'with_buyer') then
    raise exception 'This sample is already with %. Wait for the answer before sending another.',
      case when v_last.status = 'with_team' then 'Sourcingo' else 'the buyer' end;
  end if;
  if coalesce(cardinality(p_photos), 0) = 0 then
    raise exception 'Add at least one photo of the sample.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Send at most 10 photos.';
  end if;
  if exists (select 1 from unnest(p_photos) p
             where p not like v_line.company_id || '/' || v_line.order_id || '/factory/' || p_line || '/%'
               and not (v_team and p like v_line.company_id || '/' || v_line.order_id || '/samples/' || p_line || '/%')) then
    raise exception 'Those photos are not from this style.';
  end if;
  insert into public.sample_rounds (company_id, order_id, line_id, factory_id, stage, round, note, photos, sent_by_team)
  values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_stage, coalesce(v_last.round, 0) + 1,
          left(nullif(btrim(p_note), ''), 500), p_photos, v_team)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.send_sample(uuid, text, text, text[]) from public, anon;
grant execute on function public.send_sample(uuid, text, text, text[]) to authenticated;

-- The orders team sends a checked sample to the buyer: by which courier, its AWB number, and the day it went.
-- A sample handed over in person needs no AWB.
create function public.forward_sample(p_id uuid, p_courier text, p_awb text, p_sent_on date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.sample_rounds%rowtype;
  v_courier text := nullif(btrim(p_courier), '');
  v_awb text := nullif(btrim(p_awb), '');
begin
  select * into v_r from public.sample_rounds where id = p_id for update;
  if v_r.id is null or not public.can_edit_orders(v_r.company_id) then
    raise exception 'Only the orders team sends samples to the buyer.';
  end if;
  if v_r.status <> 'with_team' then
    raise exception 'This sample was already answered or sent. Reload the page.';
  end if;
  if not exists (select 1 from public.orders where id = v_r.order_id and status = 'open') then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if v_courier is null then
    raise exception 'Say how the sample goes: the courier, or By hand.';
  end if;
  if v_awb is null and lower(v_courier) <> 'by hand' then
    raise exception 'Enter the AWB (tracking) number, so the buyer can track the parcel.';
  end if;
  if p_sent_on is null or p_sent_on > public.india_today() or p_sent_on < public.india_today() - 30 then
    raise exception 'Give the day the sample went: today or in the last 30 days.';
  end if;
  update public.sample_rounds set status = 'with_buyer', courier = left(v_courier, 60), awb = left(v_awb, 60), dispatched_on = p_sent_on,
    buyer_note = left(nullif(btrim(p_note), ''), 500), forwarded_by = auth.uid(), forwarded_at = now()
  where id = p_id;
end $$;
revoke execute on function public.forward_sample(uuid, text, text, date, text) from public, anon;
grant execute on function public.forward_sample(uuid, text, text, date, text) to authenticated;

-- The orders team sends a sample back to the factory before the buyer sees it. The factory's next send is a new round.
create function public.return_sample(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.sample_rounds%rowtype;
begin
  select * into v_r from public.sample_rounds where id = p_id for update;
  if v_r.id is null or not public.can_edit_orders(v_r.company_id) then
    raise exception 'Only the orders team sends samples back.';
  end if;
  if v_r.status <> 'with_team' then
    raise exception 'This sample was already answered or sent. Reload the page.';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Say what to fix, so the factory knows.';
  end if;
  update public.sample_rounds set status = 'returned', answer_note = left(btrim(p_note), 1000), answered_by = auth.uid(), answered_at = now()
  where id = p_id;
end $$;
revoke execute on function public.return_sample(uuid, text) from public, anon;
grant execute on function public.return_sample(uuid, text) to authenticated;

-- The buyer approves a sample or asks for changes. The orders team may record the buyer's answer for it, from the
-- day the buyer gave it (today or up to 30 days back); a buyer's own answer is dated today.
-- An approval enters the step's done date. Changes need a comment, so the factory knows what to fix.
create function public.answer_sample(p_id uuid, p_approved boolean, p_note text, p_photos text[], p_on date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.sample_rounds%rowtype;
  v_buyer boolean;
  v_team boolean;
  v_on date;
  v_prev text := current_setting('sourcingo.sample_approval', true);
begin
  select * into v_r from public.sample_rounds where id = p_id for update;
  if v_r.id is null then
    raise exception 'That sample is not there. Reload the page.';
  end if;
  v_team := public.can_edit_orders(v_r.company_id);
  v_buyer := not v_team and public.buyer_owns_order(v_r.company_id, v_r.order_id);
  if not v_team and not v_buyer then
    raise exception 'Only the buyer, or the orders team for the buyer, answers a sample.';
  end if;
  if not exists (select 1 from public.orders where id = v_r.order_id and status = 'open') then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if v_r.status not in ('with_team', 'with_buyer') or (v_buyer and v_r.status <> 'with_buyer') then
    raise exception 'This sample was already answered. Reload the page.';
  end if;
  if p_approved is null then
    raise exception 'Approve the sample or ask for changes.';
  end if;
  if not p_approved and nullif(btrim(p_note), '') is null then
    raise exception 'Say what to change, so the factory can fix it.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Add at most 10 photos.';
  end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) p where p not like v_r.company_id || '/' || v_r.order_id || '/samples/' || v_r.line_id || '/%') then
    raise exception 'Those photos are not from this style.';
  end if;
  v_on := case when v_buyer then public.india_today() else coalesce(p_on, public.india_today()) end;
  if v_on > public.india_today() or v_on < public.india_today() - 30 or v_on < (v_r.sent_at at time zone 'Asia/Kolkata')::date then
    raise exception 'Give the day the buyer answered: on or after the day the sample was sent, and not in the future.';
  end if;
  update public.sample_rounds set status = case when p_approved then 'approved' else 'changes' end,
    answer_note = left(nullif(btrim(p_note), ''), 1000), answer_photos = coalesce(p_photos, '{}'),
    answered_by = auth.uid(), answered_at = now(), answered_for_buyer = v_team,
    approved_on = case when p_approved then v_on end
  where id = p_id;
  if p_approved then
    perform set_config('sourcingo.sample_approval', 'on', true);
    update public.line_stages set done_on = v_on where line_id = v_r.line_id and stage = v_r.stage and done_on is null;
    if not found then
      insert into public.line_stages (company_id, order_id, line_id, stage, done_on)
      select v_r.company_id, v_r.order_id, v_r.line_id, v_r.stage, v_on
      where not exists (select 1 from public.line_stages where line_id = v_r.line_id and stage = v_r.stage);
    end if;
    perform set_config('sourcingo.sample_approval', coalesce(v_prev, ''), true);
  end if;
end $$;
revoke execute on function public.answer_sample(uuid, boolean, text, text[], date) from public, anon;
grant execute on function public.answer_sample(uuid, boolean, text, text[], date) to authenticated;

-- ---------------------------------------------------------------- what the factory and the buyer read
-- The factory's samples on its open orders: every round, with the answers. Nothing about the buyer.
create function public.factory_samples() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'order_id', r.order_id, 'line_id', r.line_id, 'stage', r.stage, 'round', r.round, 'status', r.status,
      'note', r.note, 'photos', to_jsonb(r.photos), 'sent_at', r.sent_at, 'sent_by_team', r.sent_by_team,
      'dispatched_on', r.dispatched_on, 'answer_note', r.answer_note, 'answer_photos', to_jsonb(r.answer_photos),
      'answered_at', r.answered_at, 'approved_on', r.approved_on)
    order by r.line_id, r.stage, r.round), '[]'::jsonb)
  from public.sample_rounds r join public.orders o on o.id = r.order_id and o.status = 'open'
  join public.order_lines l on l.id = r.line_id and l.removed_at is null and l.factory_id = r.factory_id
  where r.company_id = public.current_company() and r.factory_id = public.my_factory()
$$;
revoke execute on function public.factory_samples() from public, anon;
grant execute on function public.factory_samples() to authenticated;

-- The buyer's samples: rounds the team has sent on or answered, on its open and recently shipped orders.
-- No factory, and not the factory's own note (the team writes the buyer its note).
create function public.buyer_samples() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'order_id', r.order_id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'order_open', o.status = 'open',
        'line_id', r.line_id, 'style', l.style, 'colour', l.colour, 'photo_path', l.photo_path,
        'stage', r.stage, 'round', r.round, 'status', r.status, 'photos', to_jsonb(r.photos),
        'note', r.buyer_note, 'courier', r.courier, 'awb', r.awb, 'dispatched_on', r.dispatched_on, 'sent_at', coalesce(r.forwarded_at, r.answered_at),
        'answer_note', r.answer_note, 'answer_photos', to_jsonb(r.answer_photos), 'answered_at', r.answered_at,
        'answered_for_buyer', r.answered_for_buyer, 'approved_on', r.approved_on)
      order by o.order_no, l.position, r.stage, r.round)
    from public.sample_rounds r join public.orders o on o.id = r.order_id
    join public.order_lines l on l.id = r.line_id and l.removed_at is null
    where o.company_id = public.current_company() and o.buyer_id = v_buyer and r.status in ('with_buyer', 'approved', 'changes')
      and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))), '[]'::jsonb);
end $$;
revoke execute on function public.buyer_samples() from public, anon;
grant execute on function public.buyer_samples() to authenticated;

-- ---------------------------------------------------------------- the morning brief
-- Samples to check and send, samples with the buyer, and changes the factory still has to send again.
-- Replaces the 0052 wrapper with the same locks, inquiries, part shipments and team notes plus these.
create or replace function public.brief_data_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_base jsonb := public.brief_data_base(p_user);
  v_today date := public.india_today();
  v_extra jsonb;
begin
  select p.current_company_id into v_company from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is null or v_role not in ('owner', 'manager', 'merchandiser', 'accounts') then
    return v_base;
  end if;
  v_extra := jsonb_build_object(
    -- The owner sees every PO sent for the lock; the team sees the plans the owner sent back.
    'locks', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'factory', f.name,
                                          'at', coalesce(fp.lock_note_at, fp.lock_requested_at), 'note', fp.lock_note)
                       order by coalesce(fp.lock_note_at, fp.lock_requested_at))
      from public.factory_pos fp join public.orders o on o.id = fp.order_id join public.factories f on f.id = fp.factory_id
      where fp.company_id = v_company and o.status = 'open' and fp.released_at is null
        and case when v_role = 'owner' then fp.lock_requested_at is not null else fp.lock_note is not null end), '[]'::jsonb),
    -- Follow-ups due today or late: the owner sees all, the team its own and the unassigned ones.
    'inquiries_due', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'inquiry_no', i.inquiry_no, 'product', left(i.product, 80), 'on', i.next_follow_up,
                                          'who', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = i.buyer_id), b.code, i.prospect))
                       order by i.next_follow_up, i.inquiry_no)
      from public.inquiries i left join public.buyers b on b.id = i.buyer_id
      where i.company_id = v_company and i.status in ('new', 'quoted') and i.next_follow_up <= v_today
        and (v_role = 'owner' or i.merchandiser_id is null or i.merchandiser_id = p_user)), '[]'::jsonb),
    -- Open orders with some pieces shipped and some still to send.
    'part_shipped', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', x.id, 'order_no', x.order_no, 'ordered', x.ordered, 'shipped', x.shipped) order by x.order_no)
      from (select o.id, o.order_no, sum(l.qty)::integer as ordered,
                   coalesce((select sum(dl.qty) from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                             join public.order_lines ll on ll.id = dl.line_id
                             where d.order_id = o.id and d.cancelled_at is null and d.shipped_at is not null and ll.removed_at is null), 0)::integer as shipped
            from public.orders o join public.order_lines l on l.order_id = o.id and l.removed_at is null
            where o.company_id = v_company and o.status = 'open'
            group by o.id, o.order_no) x
      where x.shipped > 0 and x.shipped < x.ordered), '[]'::jsonb),
    -- Each style's open sample, or its last answer when that was changes the factory hasn't sent again yet.
    'samples', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'style', l.style, 'stage', r.stage, 'round', r.round,
                                          'status', r.status, 'factory', f.name, 'at', coalesce(r.answered_at, r.forwarded_at, r.sent_at),
                                          'courier', r.courier, 'awb', r.awb, 'note', left(r.answer_note, 160))
                       order by coalesce(r.answered_at, r.forwarded_at, r.sent_at))
      from public.sample_rounds r
      join public.orders o on o.id = r.order_id and o.status = 'open'
      join public.order_lines l on l.id = r.line_id and l.removed_at is null
      join public.factories f on f.id = r.factory_id
      where r.company_id = v_company and r.status in ('with_team', 'with_buyer', 'changes', 'returned')
        and r.round = (select max(x.round) from public.sample_rounds x where x.line_id = r.line_id and x.stage = r.stage)
        and not exists (select 1 from public.line_stages s where s.line_id = r.line_id and s.stage = r.stage and s.done_on is not null)), '[]'::jsonb));
  if v_role = 'owner' then
    v_extra := v_extra || jsonb_build_object('team_notes', coalesce((
      select jsonb_agg(jsonb_build_object('no', n.no, 'kind', n.kind, 'body', left(n.body, 160), 'by', public.help_sender_label(n.company_id, n.created_by),
                                          'at', n.created_at, 'suggestion', left(n.suggestion, 200)) order by n.created_at)
      from public.team_notes n where n.company_id = v_company and n.status = 'new'), '[]'::jsonb),
    'closed_short', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'reason', left(o.short_reason, 160), 'at', o.closed_short_at,
                                          'by', public.help_sender_label(o.company_id, o.closed_short_by),
                                          'ordered', (select sum(l.qty) from public.order_lines l where l.order_id = o.id and l.removed_at is null),
                                          -- Summed here: the emailed brief runs with no one signed in.
                                          'billed', (select coalesce(sum(dl.qty), 0) from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                                                     join public.order_lines l on l.id = dl.line_id
                                                     where d.order_id = o.id and d.cancelled_at is null and d.invoiced_at is not null and l.removed_at is null))
                       order by o.closed_short_at)
      from public.orders o
      where o.company_id = v_company and o.status = 'shipped' and o.closed_short_at >= now() - interval '2 days'), '[]'::jsonb));
  end if;
  return v_base || v_extra;
end $$;
revoke execute on function public.brief_data_for(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_for(uuid) to service_role;
