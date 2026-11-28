-- Orders tracked style by style (28 Nov 2026).
-- 1. A style may ship on its own date: styles placed at different factories often finish weeks apart. Empty means the
--    PO's ship date, as before. Nothing already saved changes.
-- 2. A step marked done by the team carries photos of the work, as the factory's own updates and Quality's visits
--    already do. The photos are kept per step (step_proofs) and the buyer sees them beside the factory's confirmed ones.
-- Additive only: one column, one table, two new functions, and buyer_step_photos widened to the new photos.

alter table public.order_lines add column ship_date date;
grant select (ship_date) on public.order_lines to authenticated;

-- Sets (or clears, with null) a style's own ship date. A date equal to the PO's is stored as empty, so the style
-- keeps following the PO when that moves.
create function public.set_line_ship_date(p_line uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or v_line.company_id is distinct from public.current_company() then
    raise exception 'That style is not on an order.';
  end if;
  if not public.can_edit_orders(v_line.company_id) then
    raise exception 'Only the orders team sets a style''s ship date.';
  end if;
  select * into v_order from public.orders where id = v_line.order_id;
  if v_order.status <> 'open' then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if p_date is not null and p_date < public.india_today() - 365 then
    raise exception 'That date looks wrong. Pick the day this style ships.';
  end if;
  update public.order_lines
     set ship_date = case when p_date is null or p_date = coalesce(v_order.revised_ship_date, v_order.ship_date) then null else p_date end
   where id = p_line;
end $$;
revoke execute on function public.set_line_ship_date(uuid, date) from public, anon;
grant execute on function public.set_line_ship_date(uuid, date) to authenticated;

create table public.step_proofs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  stage text not null,
  done_on date not null,
  photos text[] not null check (cardinality(photos) between 1 and 10),
  -- false keeps the photos inside the team (a factory name board in the shot, say).
  buyer_sees boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index step_proofs_line_idx on public.step_proofs (line_id, stage);
create index step_proofs_order_idx on public.step_proofs (order_id);
alter table public.step_proofs enable row level security;
create policy step_proofs_read on public.step_proofs for select to authenticated using (public.is_member(company_id));
grant select on public.step_proofs to authenticated;

-- The team marks steps done with photos of the work. p_rows: [{line_id, stage, done_on, photos: [path, ...]}].
-- Each step must be on one of this order's styles and not done yet; the photos must sit in that style's folder.
-- A factory's own "done" waiting on the step is answered by it.
create function public.mark_steps_done(p_order uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_line public.order_lines%rowtype;
  r jsonb;
  v_stage text;
  v_on date;
  v_photos text[];
  v_found boolean;
  v_done date;
begin
  select * into v_order from public.orders where id = p_order and removed_at is null;
  if v_order.id is null or v_order.company_id is distinct from public.current_company() then
    raise exception 'That order is not here any more. Reload the page.';
  end if;
  if not (public.can_edit_orders(v_order.company_id) or public.is_quality(v_order.company_id)) then
    raise exception 'Only the orders team and Quality mark steps done.';
  end if;
  if v_order.status <> 'open' then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'Nothing to save.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_line from public.order_lines where id = (r ->> 'line_id')::uuid and order_id = p_order and removed_at is null;
    if v_line.id is null then
      raise exception 'That style is not on this order. Reload the page.';
    end if;
    v_stage := r ->> 'stage';
    v_on := (r ->> 'done_on')::date;
    v_photos := array(select jsonb_array_elements_text(coalesce(r -> 'photos', '[]'::jsonb)));
    if v_stage = 'final_qc' then
      raise exception 'Final QC is done when its check is recorded. Use Record QC.';
    end if;
    v_found := null; v_done := null;
    select true, s.done_on into v_found, v_done from public.style_steps(v_line.id) s where s.stage = v_stage;
    if not coalesce(v_found, false) then
      raise exception 'That step is not on %.', v_line.style;
    end if;
    if v_done is not null then
      continue;
    end if;
    if v_on is null or v_on > public.india_today() then
      raise exception 'Give the day the step was done: today or before.';
    end if;
    if coalesce(cardinality(v_photos), 0) = 0 then
      raise exception 'Add a photo of the work to mark it done.';
    end if;
    if cardinality(v_photos) > 10 then
      raise exception 'Add at most 10 photos to a step.';
    end if;
    if exists (select 1 from unnest(v_photos) p where p not like v_line.company_id || '/' || p_order || '/styles/' || v_line.id || '/%') then
      raise exception 'Those photos are not from this style.';
    end if;
    insert into public.step_proofs (company_id, order_id, line_id, stage, done_on, photos)
    values (v_line.company_id, p_order, v_line.id, v_stage, v_on, v_photos);
    update public.line_stages set done_on = v_on where line_id = v_line.id and stage = v_stage and done_on is null;
    if not found then
      insert into public.line_stages (company_id, order_id, line_id, stage, done_on)
      select v_line.company_id, p_order, v_line.id, v_stage, v_on
      where not exists (select 1 from public.line_stages where line_id = v_line.id and stage = v_stage);
    end if;
    update public.step_updates set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = 'Marked done by the team with photos.'
    where line_id = v_line.id and stage = v_stage and status = 'pending';
  end loop;
end $$;
revoke execute on function public.mark_steps_done(uuid, jsonb) from public, anon;
grant execute on function public.mark_steps_done(uuid, jsonb) to authenticated;

-- As 0094, plus the team's own step photos. Same shape, so the buyer's page needs no change.
create or replace function public.buyer_step_photos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', x.order_id, 'line_id', x.line_id, 'stage', x.stage, 'done_on', x.done_on,
                                               'photos', to_jsonb(x.photos)) order by x.done_on, x.at), '[]'::jsonb)
  from (
    select u.order_id, u.line_id, u.stage, u.done_on, u.photos, u.reviewed_at as at
    from public.step_updates u
    join public.orders o on o.id = u.order_id and o.removed_at is null
    join public.order_lines l on l.id = u.line_id and l.removed_at is null
    where u.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
      and u.status = 'confirmed' and u.buyer_sees
      and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
    union all
    select p.order_id, p.line_id, p.stage, p.done_on, p.photos, p.created_at
    from public.step_proofs p
    join public.orders o on o.id = p.order_id and o.removed_at is null
    join public.order_lines l on l.id = p.line_id and l.removed_at is null
    where p.company_id = public.current_company() and o.buyer_id = public.viewing_buyer() and p.buyer_sees
      and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
  ) x
$$;
