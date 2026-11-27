-- Door-to-door shipment tracking (six-month plan, batch 10). Each shipped part (a dispatches row) gets how it travels,
-- the carrier and its number (B/L, AWB, container or docket), where it is going and when it should arrive, and a dated
-- update at each stage until it is delivered. The team keeps it; the buyer reads it on its page. No paid tracking API:
-- the app links to the carrier's own public tracking page. Export papers live in dispatches.export (0098); this stays apart.
-- Additive only.

alter table public.dispatches
  add column track_mode text check (track_mode in ('road', 'sea', 'air', 'courier')),
  add column track_carrier text check (track_carrier is null or char_length(btrim(track_carrier)) between 1 and 60),
  add column track_no text check (track_no is null or char_length(btrim(track_no)) between 1 and 60),
  add column track_to text check (track_to is null or char_length(btrim(track_to)) between 1 and 80),
  add column track_eta date,
  add column track_delivered_on date;

-- The stages a part passes, in order. Road and courier skip the ports.
create function public.track_stages(p_mode text) returns text[] language sql immutable as $$
  select case when p_mode in ('sea', 'air') then array['shipped', 'origin_port', 'departed', 'arrived', 'customs', 'out', 'delivered']
              else array['shipped', 'transit', 'out', 'delivered'] end
$$;

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  dispatch_id uuid not null references public.dispatches (id),
  stage text not null check (stage in ('shipped', 'transit', 'origin_port', 'departed', 'arrived', 'customs', 'out', 'delivered')),
  happened_on date not null,
  place text check (place is null or char_length(place) <= 80),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index shipment_events_dispatch_idx on public.shipment_events (dispatch_id, happened_on) where cancelled_at is null;
alter table public.shipment_events enable row level security;
revoke all on public.shipment_events from anon, authenticated;
grant select on public.shipment_events to authenticated;
create policy shipment_events_read on public.shipment_events for select to authenticated using (public.can_edit_orders(company_id));

-- How a shipped part travels. Only once it has left us.
create function public.save_tracking(p_dispatch uuid, p_mode text, p_carrier text, p_no text, p_to text, p_eta date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.dispatches%rowtype;
begin
  select * into v_d from public.dispatches where id = p_dispatch and company_id = public.current_company() and cancelled_at is null;
  if v_d.id is null then raise exception 'That shipment isn''t here any more. Reload the page.'; end if;
  if not public.can_edit_orders(v_d.company_id) then raise exception 'Only the orders team keeps tracking.'; end if;
  if v_d.shipped_at is null then raise exception 'Add the LR first: tracking starts once the goods leave.'; end if;
  if p_mode is null or p_mode not in ('road', 'sea', 'air', 'courier') then raise exception 'Pick how it travels.'; end if;
  if char_length(btrim(coalesce(p_carrier, ''))) > 60 or char_length(btrim(coalesce(p_no, ''))) > 60 then
    raise exception 'Keep the carrier and number under 60 letters.';
  end if;
  if char_length(btrim(coalesce(p_to, ''))) > 80 then raise exception 'Keep the destination under 80 letters.'; end if;
  if p_eta is not null and (p_eta < (v_d.shipped_at at time zone 'Asia/Kolkata')::date or p_eta > public.india_today() + 180) then
    raise exception 'The arrival date is after it left and within 6 months.';
  end if;
  update public.dispatches set track_mode = p_mode, track_carrier = nullif(btrim(coalesce(p_carrier, '')), ''),
    track_no = nullif(btrim(coalesce(p_no, '')), ''), track_to = nullif(btrim(coalesce(p_to, '')), ''), track_eta = p_eta
  where id = p_dispatch;
end $$;
revoke execute on function public.save_tracking(uuid, text, text, text, text, date) from public, anon;
grant execute on function public.save_tracking(uuid, text, text, text, text, date) to authenticated;

-- A dated update at a stage. "Delivered" marks the part delivered (the buyer's GRN still follows as before).
create function public.add_shipment_event(p_dispatch uuid, p_stage text, p_on date, p_place text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.dispatches%rowtype;
  v_id uuid;
begin
  select * into v_d from public.dispatches where id = p_dispatch and company_id = public.current_company() and cancelled_at is null for update;
  if v_d.id is null then raise exception 'That shipment isn''t here any more. Reload the page.'; end if;
  if not public.can_edit_orders(v_d.company_id) then raise exception 'Only the orders team keeps tracking.'; end if;
  if v_d.shipped_at is null then raise exception 'Add the LR first: tracking starts once the goods leave.'; end if;
  if p_stage is null or not (p_stage = any (public.track_stages(v_d.track_mode))) then raise exception 'Pick where the goods are.'; end if;
  if p_on is null or p_on > public.india_today() or p_on < (v_d.shipped_at at time zone 'Asia/Kolkata')::date then
    raise exception 'The date is between the day it left and today.';
  end if;
  if char_length(coalesce(p_place, '')) > 80 or char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Keep the place under 80 letters and the note under 300.';
  end if;
  insert into public.shipment_events (company_id, dispatch_id, stage, happened_on, place, note)
  values (v_d.company_id, p_dispatch, p_stage, p_on, nullif(btrim(coalesce(p_place, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  if p_stage = 'delivered' then
    update public.dispatches set track_delivered_on = p_on where id = p_dispatch;
  end if;
  return v_id;
end $$;
revoke execute on function public.add_shipment_event(uuid, text, date, text, text) from public, anon;
grant execute on function public.add_shipment_event(uuid, text, date, text, text) to authenticated;

-- Take a wrong update back. Taking back "delivered" un-delivers the part, unless another delivered update stands.
create function public.cancel_shipment_event(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.shipment_events%rowtype;
begin
  select * into v_e from public.shipment_events where id = p_id and company_id = public.current_company() and cancelled_at is null;
  if v_e.id is null then raise exception 'That update isn''t here any more. Reload the page.'; end if;
  if not public.can_edit_orders(v_e.company_id) then raise exception 'Only the orders team keeps tracking.'; end if;
  update public.shipment_events set cancelled_at = now() where id = p_id;
  if v_e.stage = 'delivered' then
    update public.dispatches set track_delivered_on = (select max(happened_on) from public.shipment_events
      where dispatch_id = v_e.dispatch_id and stage = 'delivered' and cancelled_at is null)
    where id = v_e.dispatch_id;
  end if;
end $$;
revoke execute on function public.cancel_shipment_event(uuid) from public, anon;
grant execute on function public.cancel_shipment_event(uuid) to authenticated;

-- Delivered (for the Guarantee's "on delivery" milestone): every part that left has a GRN or a delivered update.
create or replace function public.order_delivered_on(p_order uuid) returns date
language sql stable security definer set search_path = '' as $$
  select case when public.order_shipped_on(p_order) is not null
                and not exists (select 1 from public.dispatches d where d.order_id = p_order and d.cancelled_at is null
                                and d.shipped_at is not null and d.grn_at is null and d.track_delivered_on is null)
              then (select max(coalesce(d.track_delivered_on, (d.grn_at at time zone 'Asia/Kolkata')::date)) from public.dispatches d
                    where d.order_id = p_order and d.cancelled_at is null and d.shipped_at is not null) end
$$;

-- The buyer's shipments, as in 0075, with how each travels, its number, where it is going, when it should arrive and
-- each stage it has passed. Never a factory.
create or replace function public.buyer_shipments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'order_id', d.order_id, 'shipped_on', (d.shipped_at at time zone 'Asia/Kolkata')::date,
      'pieces', (select coalesce(sum(dl.qty), 0)::integer from public.dispatch_lines dl where dl.dispatch_id = d.id),
      'cartons', d.cartons, 'transporter', d.transporter, 'lr_no', d.lr_no, 'lr_date', d.lr_date, 'invoice_no', d.invoice_no,
      'received_on', (d.grn_at at time zone 'Asia/Kolkata')::date, 'received_qty', d.grn_received_qty,
      'mode', d.track_mode, 'carrier', d.track_carrier, 'track_no', d.track_no, 'to', d.track_to, 'eta', d.track_eta,
      'delivered_on', d.track_delivered_on,
      'events', (select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'on', e.happened_on, 'place', e.place, 'note', e.note)
                   order by e.happened_on, e.created_at), '[]'::jsonb)
                 from public.shipment_events e where e.dispatch_id = d.id and e.cancelled_at is null))
    order by d.shipped_at desc), '[]'::jsonb)
  from public.dispatches d
  join public.orders o on o.id = d.order_id and o.company_id = d.company_id
  where d.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
    and d.cancelled_at is null and d.shipped_at is not null
    and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
$$;
