-- Production by style: each style has a planned (TNA) date and an actual date for every stage,
-- and a photo. The order's stage follows its slowest style, so the order list stays true.

alter table public.order_lines add column photo_path text,
  add constraint order_lines_photo_in_company check (photo_path is null or split_part(photo_path, '/', 1) = company_id::text);

create table public.line_stages (
  id uuid not null default gen_random_uuid() unique,
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  stage text not null check (stage in ('fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed')),
  planned_on date,
  done_on date,
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (line_id, stage),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index line_stages_order_idx on public.line_stages (order_id);

create trigger line_stages_history after insert or update or delete on public.line_stages
  for each row execute function public.record_history();

-- A stage row always belongs to the style's own order, and records who changed it last.
create function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.order_lines l where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id) then
    raise exception 'That style is not on this order.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger line_stages_check before insert or update on public.line_stages
  for each row execute function public.check_line_stage();

-- The order's stage is the last stage its slowest style has finished.
-- Orders with no actual dates yet keep the stage set by hand.
create function public.sync_order_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_stages text[] := array['fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed'];
  v_min integer;
begin
  if not exists (select 1 from public.line_stages where order_id = new.order_id and done_on is not null)
     and (tg_op = 'INSERT' or old.done_on is null) then
    return null;
  end if;
  select min(coalesce((select max(array_position(v_stages, s.stage)) from public.line_stages s
                       where s.line_id = l.id and s.done_on is not null), 0))
    into v_min
  from public.order_lines l where l.order_id = new.order_id and l.removed_at is null;
  update public.orders set stage = case when coalesce(v_min, 0) = 0 then null else v_stages[v_min] end
  where id = new.order_id and stage is distinct from (case when coalesce(v_min, 0) = 0 then null else v_stages[v_min] end);
  return null;
end $$;
create trigger line_stages_sync after insert or update on public.line_stages
  for each row execute function public.sync_order_stage();

alter table public.line_stages enable row level security;
revoke all on public.line_stages from anon, authenticated;
grant select, insert, update (planned_on, done_on) on public.line_stages to authenticated;
create policy line_stages_read on public.line_stages for select to authenticated using (public.is_member(company_id));
create policy line_stages_insert on public.line_stages for insert to authenticated with check (public.can_edit_orders(company_id));
create policy line_stages_update on public.line_stages for update to authenticated
  using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));

revoke execute on function public.check_line_stage(), public.sync_order_stage() from public, anon, authenticated;

-- Saves the planned and actual dates for an open order's styles in one go.
-- p_rows: [{line_id, stage, planned_on, done_on}, ...]; a blank date clears it.
create function public.save_line_stages(p_order uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not public.can_edit_orders(public.current_company()) then
    raise exception 'Only the orders team can change production.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;
  insert into public.line_stages (order_id, line_id, stage, planned_on, done_on)
  select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date
  from jsonb_array_elements(p_rows) r
  on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on;
end $$;
revoke execute on function public.save_line_stages(uuid, jsonb) from public, anon;
grant execute on function public.save_line_stages(uuid, jsonb) to authenticated;
