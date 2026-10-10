-- A full TNA for every style, and a factory PO that is released only once the factory's plan is complete.
-- The merchandiser asks the factory for its plan, enters it, then releases the PO; actual dates come after.

-- TNA steps: samples and approvals, then production, then the final inspection and ex-factory.
alter table public.line_stages drop constraint line_stages_stage_check;
alter table public.line_stages add constraint line_stages_stage_check check (stage in (
  'greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
  'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory'));

-- A step the style doesn't go through (for example no printing) is marked not needed instead of planned.
alter table public.line_stages add column not_needed boolean not null default false,
  add constraint line_stages_not_needed_blank check (not not_needed or (planned_on is null and done_on is null));
grant update (not_needed) on public.line_stages to authenticated;

-- One factory PO per order and factory: when its plan was asked for, and when it was released.
create table public.factory_pos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  factory_id uuid not null,
  plan_requested_on date,
  released_at timestamptz,
  released_by uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, factory_id),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create trigger factory_pos_history after insert or update or delete on public.factory_pos
  for each row execute function public.record_history();
create trigger factory_pos_touch before update on public.factory_pos
  for each row execute function public.touch_updated_at();

alter table public.factory_pos enable row level security;
revoke all on public.factory_pos from anon, authenticated;
grant select, insert (order_id, factory_id, plan_requested_on), update (plan_requested_on) on public.factory_pos to authenticated;
create policy factory_pos_read on public.factory_pos for select to authenticated using (public.is_member(company_id));
create policy factory_pos_insert on public.factory_pos for insert to authenticated with check (public.can_edit_orders(company_id));
create policy factory_pos_update on public.factory_pos for update to authenticated
  using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));

-- Orders already in production when this arrived count as released, so their actual dates keep working.
insert into public.factory_pos (company_id, order_id, factory_id, released_at, note)
select distinct l.company_id, l.order_id, l.factory_id, now(), 'Already with the factory when PO release was added'
from public.order_lines l join public.orders o on o.id = l.order_id
where l.removed_at is null and l.factory_id is not null and o.status <> 'cancelled'
on conflict (order_id, factory_id) do nothing;

-- Releases a factory's PO once every one of its styles has a quantity, a factory rate and a plan for every TNA step.
create function public.release_factory_po(p_order uuid, p_factory uuid) returns void
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
  select string_agg(l.style || ' (' || coalesce(nullif(concat_ws(', ',
           case when l.factory_rate is null then 'factory rate' end,
           (select string_agg(v_labels[array_position(v_steps, st)], ', ' order by array_position(v_steps, st))
              from unnest(v_steps) st
              where not exists (select 1 from public.line_stages s where s.line_id = l.id and s.stage = st
                                and (s.planned_on is not null or s.not_needed)))), ''), '') || ')', '; ' order by l.position)
    into v_missing
  from public.order_lines l
  where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and (l.factory_rate is null or exists (
      select 1 from unnest(v_steps) st
      where not exists (select 1 from public.line_stages s where s.line_id = l.id and s.stage = st
                        and (s.planned_on is not null or s.not_needed))));
  if v_missing is not null then
    raise exception 'The plan is not complete yet. Missing: %', v_missing;
  end if;
  insert into public.factory_pos (company_id, order_id, factory_id, released_at, released_by)
  values (v_company, p_order, p_factory, now(), auth.uid())
  on conflict (order_id, factory_id) do update set released_at = now(), released_by = auth.uid()
  where public.factory_pos.released_at is null;
end $$;
revoke execute on function public.release_factory_po(uuid, uuid) from public, anon;
grant execute on function public.release_factory_po(uuid, uuid) to authenticated;

-- Actual dates come only after the factory PO is released.
create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
begin
  select l.factory_id into v_factory from public.order_lines l
  where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id;
  if not found then
    raise exception 'That style is not on this order.';
  end if;
  if new.done_on is not null and (tg_op = 'INSERT' or new.done_on is distinct from old.done_on)
     and not exists (select 1 from public.factory_pos f where f.order_id = new.order_id and f.factory_id = v_factory and f.released_at is not null) then
    raise exception 'Release the factory PO before entering done dates.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.save_line_stages(p_order uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not public.can_edit_orders(public.current_company()) then
    raise exception 'Only the orders team can change production.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;
  insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed)
  select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date,
         coalesce((r ->> 'not_needed')::boolean, false)
  from jsonb_array_elements(p_rows) r
  on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on, not_needed = excluded.not_needed;
end $$;
