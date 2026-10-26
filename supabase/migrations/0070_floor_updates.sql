-- Quality owns production updates (Dheeraj, 26 Oct 2026): QC visits the factories on time and posts what it saw on
-- every step of every style, with photos. The whole team reads these live updates on the order's TNA.
-- Insert-only: an update is never changed or deleted; a newer one says what changed.

create table public.floor_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  factory_id uuid not null,
  stage text not null,
  -- done: seen finished (enters the step's done date); on_track; behind (with the day it will be ready); issue: a problem.
  status text not null check (status in ('done', 'on_track', 'behind', 'issue')),
  -- Pieces (or metres, for fabric) done so far on this step.
  qty_done integer check (qty_done >= 0),
  expected_on date,
  note text check (length(note) <= 500),
  photos text[] not null default '{}' check (cardinality(photos) between 1 and 10),
  visited_on date not null default public.india_today(),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index floor_updates_order_idx on public.floor_updates (order_id, created_at desc);
create index floor_updates_factory_idx on public.floor_updates (factory_id, visited_on desc);
alter table public.floor_updates enable row level security;
-- The team reads them; they are written only through post_floor_update below.
create policy floor_updates_read on public.floor_updates for select to authenticated using (public.is_member(company_id));
grant select on public.floor_updates to authenticated;

-- One update on one step of one style, from the factory floor. Quality (and the orders team) post them on a released
-- PO's styles. "Done" enters the step's done date for today, so the TNA moves on at once.
create or replace function public.post_floor_update(p_line uuid, p_stage text, p_status text, p_qty integer, p_expected date,
                                                    p_note text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_note text := left(nullif(btrim(p_note), ''), 500);
  v_today date := public.india_today();
  v_done date;
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or v_line.company_id is distinct from public.current_company() then
    raise exception 'That style is not on an open order.';
  end if;
  if not (public.is_quality(v_line.company_id) or public.can_edit_orders(v_line.company_id)) then
    raise exception 'Only Quality and the orders team post production updates.';
  end if;
  if not exists (select 1 from public.orders where id = v_line.order_id and status = 'open') then
    raise exception 'This order is no longer open. Reload the page.';
  end if;
  if v_line.factory_id is null or not exists (select 1 from public.factory_pos f where f.order_id = v_line.order_id
                                               and f.factory_id = v_line.factory_id and f.released_at is not null) then
    raise exception 'Production updates start once the factory PO is released.';
  end if;
  select s.done_on into v_done from public.style_steps(p_line) s where s.stage = p_stage;
  if not found then
    raise exception 'That step is not on this style.';
  end if;
  if v_done is not null then
    raise exception 'That step is already done. Update the next one.';
  end if;
  if p_status is null or p_status not in ('done', 'on_track', 'behind', 'issue') then
    raise exception 'Say how the step is: done, on track, running late or a problem.';
  end if;
  if p_status = 'done' and p_stage in ('fit_sample', 'strike_off', 'pp_sample', 'size_set') then
    raise exception 'A sample is done when the buyer approves it. Post it as on track, or send it from Samples.';
  end if;
  if p_status = 'done' and p_stage = 'final_qc' then
    raise exception 'Final QC is done when its check is recorded. Use Record QC.';
  end if;
  if p_status = 'behind' and (p_expected is null or p_expected < v_today) then
    raise exception 'Give the day the factory will finish it: today or later.';
  end if;
  if p_status = 'issue' and v_note is null then
    raise exception 'Say what the problem is, so the team can act on it.';
  end if;
  if p_qty is not null and (p_qty < 0 or p_qty > v_line.qty * 2) then
    raise exception 'The quantity done looks wrong: this style has % in all.', v_line.qty;
  end if;
  if coalesce(cardinality(p_photos), 0) = 0 then
    raise exception 'Add at least one photo from the floor.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Add at most 10 photos.';
  end if;
  if exists (select 1 from unnest(p_photos) p where p not like v_line.company_id || '/' || v_line.order_id || '/visits/' || p_line || '/%') then
    raise exception 'Those photos are not from this style.';
  end if;

  insert into public.floor_updates (company_id, order_id, line_id, factory_id, stage, status, qty_done, expected_on, note, photos, visited_on)
  values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_stage, p_status, p_qty,
          case when p_status in ('behind', 'issue') then p_expected end, v_note, p_photos, v_today)
  returning id into v_id;

  if p_status = 'done' then
    -- The done date goes in as this person (check_line_stage lets Quality and the orders team enter it).
    update public.line_stages set done_on = v_today where line_id = p_line and stage = p_stage and done_on is null;
    if not found then
      insert into public.line_stages (company_id, order_id, line_id, stage, done_on)
      select v_line.company_id, v_line.order_id, p_line, p_stage, v_today
      where not exists (select 1 from public.line_stages where line_id = p_line and stage = p_stage);
    end if;
    -- A factory's own "done" waiting on this step is answered by what Quality saw.
    update public.step_updates set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = 'Quality saw it done on the factory visit.'
    where line_id = p_line and stage = p_stage and status = 'pending';
  end if;
  return v_id;
end $$;
revoke execute on function public.post_floor_update(uuid, text, text, integer, date, text, text[]) from public, anon;
grant execute on function public.post_floor_update(uuid, text, text, integer, date, text, text[]) to authenticated;

-- Floor photos go in <company>/<order>/visits/<style>/, for Quality and the orders team.
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
  if v_parts[3] = 'visits' then
    return array_length(v_parts, 1) = 5 and (public.is_quality(v_company) or public.can_edit_orders(v_company));
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
