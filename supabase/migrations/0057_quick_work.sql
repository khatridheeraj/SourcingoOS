-- Quick work for the orders team: start an order's production from one sheet, close an order that shipped before
-- the app was in use, and keep a record of each factory chased on WhatsApp.

-- ---------------------------------------------------------------- 1. factory and rate from the start sheet
-- The start sheet asks for what is missing before a plan can go for the lock: a factory for a style that has none,
-- and the factory's rate. Only styles whose factory PO is not released yet can change here; prices stay hidden
-- from everyone but the orders team and Accounts, as before.
-- p_rows: [{line_id, factory_id?, factory_rate?}]
create function public.set_style_factory(p_order uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  r jsonb;
  v_line public.order_lines;
  v_factory uuid;
  v_rate numeric;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can change an open order.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Nothing to save.';
  end if;
  for r in select x from jsonb_array_elements(p_rows) x loop
    select * into v_line from public.order_lines where id = nullif(r ->> 'line_id', '')::uuid and order_id = p_order and removed_at is null for update;
    if v_line.id is null then
      raise exception 'That style is no longer on this order. Reload the page.';
    end if;
    v_factory := coalesce(nullif(r ->> 'factory_id', '')::uuid, v_line.factory_id);
    v_rate := coalesce(nullif(regexp_replace(coalesce(r ->> 'factory_rate', ''), '[,₹\s]', '', 'g'), '')::numeric, v_line.factory_rate);
    if v_rate is not null and v_rate < 0 then
      raise exception 'A factory rate can''t be below zero.';
    end if;
    if v_factory is not null and not exists (select 1 from public.factories where id = v_factory and company_id = v_company) then
      raise exception 'Pick one of your factories.';
    end if;
    if (v_factory is distinct from v_line.factory_id or v_rate is distinct from v_line.factory_rate)
       and exists (select 1 from public.factory_pos where order_id = p_order and factory_id = v_line.factory_id and released_at is not null) then
      raise exception '%''s factory PO is already released, so its factory and rate are fixed.', v_line.style;
    end if;
    update public.order_lines set factory_id = v_factory, factory_rate = v_rate where id = v_line.id
      and (factory_id is distinct from v_factory or factory_rate is distinct from v_rate);
  end loop;
end $$;
revoke execute on function public.set_style_factory(uuid, jsonb) from public, anon;
grant execute on function public.set_style_factory(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. orders that shipped before the app
-- Orders loaded when the app started (July to September 2026) shipped long ago with no factory bill or invoice in
-- Dispatch, so Mark shipped could never close them and they stayed "late" on every screen. The orders team can now
-- close one whose ship date is two weeks past and that has nothing in Dispatch, saying how it went.
alter table public.orders add column closed_note text check (char_length(closed_note) <= 300);

create function public.close_old_order(p_order uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from public.current_company() or not public.can_edit_orders(o.company_id) then
    raise exception 'Only the orders team can close an order.';
  end if;
  if o.status <> 'open' then
    raise exception 'This order isn''t open any more. Reload the page.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say how it shipped, for example "Shipped 28 Jul by road, before we used the app".';
  end if;
  if coalesce(o.revised_ship_date, o.ship_date) is null or coalesce(o.revised_ship_date, o.ship_date) > public.india_today() - 14 then
    raise exception 'Only an order whose ship date is more than two weeks past can be closed this way. Use Mark shipped.';
  end if;
  if exists (select 1 from public.dispatches where order_id = p_order and cancelled_at is null) then
    raise exception 'This order has goods in Dispatch. Finish them there and use Mark shipped.';
  end if;
  perform set_config('sourcingo.old_order', 'on', true);
  update public.orders set status = 'shipped', closed_note = left(btrim(p_note), 300) where id = p_order;
  perform set_config('sourcingo.old_order', 'off', true);
end $$;
revoke execute on function public.close_old_order(uuid, text) from public, anon;
grant execute on function public.close_old_order(uuid, text) to authenticated;

-- The ship guard as in 0054, letting close_old_order through for its own transaction only.
create or replace function public.guard_ship() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_why text;
begin
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status is distinct from 'shipped') and auth.uid() is not null then
    if tg_op = 'INSERT' then
      raise exception 'A new order starts open. Mark it shipped once its factory bill and invoice are in Dispatch.'
        using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    if tg_op = 'UPDATE' and current_setting('sourcingo.old_order', true) = 'on' and new.closed_note is not null
       and public.can_edit_orders(new.company_id) then
      return new;
    end if;
    v_why := public.ship_blocker(new.id);
    if v_why is not null then
      raise exception '%', v_why using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    if not public.is_owner(new.company_id) and not public.final_qc_passed_shipping(new.id) then
      raise exception 'Record a passed final QC before marking this order shipped.' using errcode = 'P0001', hint = 'final_qc_required';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 3. factories chased
-- Each WhatsApp chase sent from the app, so the team sees who was chased today and nobody chases twice.
create table public.factory_chases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  factory_id uuid not null references public.factories (id),
  order_id uuid references public.orders (id),
  chased_by uuid not null default auth.uid(),
  chased_at timestamptz not null default now()
);
create index factory_chases_recent on public.factory_chases (company_id, chased_at desc);
alter table public.factory_chases enable row level security;
revoke all on public.factory_chases from anon, authenticated;
grant select, insert on public.factory_chases to authenticated;
create policy factory_chases_read on public.factory_chases for select to authenticated
  using (company_id = (select public.current_company()) and public.can_edit_orders(company_id));
create policy factory_chases_add on public.factory_chases for insert to authenticated
  with check (company_id = (select public.current_company()) and public.can_edit_orders(company_id) and chased_by = auth.uid()
              and exists (select 1 from public.factories f where f.id = factory_id and f.company_id = factory_chases.company_id));
