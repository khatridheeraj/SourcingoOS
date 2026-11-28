-- Factories, part 1 of the six-month plan (batches 5 and 6): certificates with expiry, a weekly capacity calendar, and
-- the lead time each factory has really delivered, so the team awards orders to factories that are certified, free and
-- quick, and buyers read "certified" without ever learning the factory's name.
--
--   factory_certificates: GOTS, OEKO-TEX, Sedex and the like, each with its number, expiry and a scan. The team adds
--     one already checked; a factory adds its own from its panel and it counts once the team has checked it.
--   factory_capacity: free pieces a factory says it has, week by week; beside it, what is already due to ship with us.
--   lead_days(): days from PO to the first shipment of every order a factory made, the base of every lead-time promise.
-- Scans and (later) profile photos live in storage under <company>/factory-files/<factory>/<certs|photos>/<file>.

-- ================================================================ certificates
create table public.factory_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  factory_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 60),
  cert_no text check (length(cert_no) <= 60),
  valid_until date,
  path text check (path is null or path ~ '^[0-9a-f-]{36}/factory-files/[0-9a-f-]{36}/certs/[^/]+$'),
  file_name text check (length(file_name) <= 200),
  -- pending: the factory sent it, the team hasn't looked; checked: the team has seen the certificate and it is real;
  -- turned_down: the team said no, with the reason the factory reads.
  status text not null default 'pending' check (status in ('pending', 'checked', 'turned_down')),
  status_note text check (length(status_note) <= 200),
  status_by uuid references public.profiles (id),
  status_at timestamptz,
  from_factory boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Removed, never deleted: a replaced certificate stays on record.
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index factory_certificates_factory_idx on public.factory_certificates (factory_id) where removed_at is null;
create index factory_certificates_todo_idx on public.factory_certificates (company_id, status, valid_until) where removed_at is null;
alter table public.factory_certificates enable row level security;
revoke all on public.factory_certificates from public, anon, authenticated;
grant select on public.factory_certificates to authenticated;
create policy factory_certificates_read on public.factory_certificates for select to authenticated using (public.is_member(company_id));

-- Who vouches for a factory's papers: the same people who may record a visit (0094).
create function public.can_vouch_factory(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role(p_company) in ('owner', 'manager', 'merchandiser', 'quality'), false)
$$;
revoke execute on function public.can_vouch_factory(uuid) from public, anon;
grant execute on function public.can_vouch_factory(uuid) to authenticated;

-- Adds a certificate. The team's is checked at once; a factory's own (p_factory null or its own id) waits for a check.
create function public.save_factory_certificate(p_factory uuid, p_name text, p_no text, p_until date, p_path text, p_file_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_mine uuid := public.my_factory();
  v_team boolean := public.can_vouch_factory(public.current_company());
  v_factory uuid := coalesce(p_factory, public.my_factory());
  v_name text := btrim(coalesce(p_name, ''));
  v_no text := nullif(btrim(coalesce(p_no, '')), '');
  v_id uuid;
begin
  if v_factory is null or not (v_team or coalesce(v_mine = v_factory, false)) then
    raise exception 'Only the factory itself, or the owner, a manager, a merchandiser or Quality, can add a certificate.';
  end if;
  if not exists (select 1 from public.factories where id = v_factory and company_id = v_company) then
    raise exception 'That factory is not in your company.';
  end if;
  if length(v_name) not between 2 and 60 then
    raise exception 'Give the certificate''s name, like GOTS or OEKO-TEX.';
  end if;
  if length(v_no) > 60 then
    raise exception 'Keep the certificate number under 60 characters.';
  end if;
  if p_until is not null and p_until < public.india_today() - 365 then
    raise exception 'That certificate ran out over a year ago. Add the renewed one.';
  end if;
  if p_path is not null and p_path not like v_company::text || '/factory-files/' || v_factory::text || '/certs/%' then
    raise exception 'Upload the certificate again.';
  end if;
  if coalesce(v_mine = v_factory, false) and p_path is null then
    raise exception 'Add a photo or PDF of the certificate, so Sourcingo can check it.';
  end if;
  if (select count(*) from public.factory_certificates where factory_id = v_factory and removed_at is null) >= 20 then
    raise exception 'At most 20 certificates. Remove an old one first.';
  end if;
  insert into public.factory_certificates (company_id, factory_id, name, cert_no, valid_until, path, file_name, status, status_by, status_at, from_factory)
  values (v_company, v_factory, v_name, v_no, p_until, p_path, nullif(btrim(coalesce(p_file_name, '')), ''),
          case when v_team and v_mine is null then 'checked' else 'pending' end,
          case when v_team and v_mine is null then auth.uid() end, case when v_team and v_mine is null then now() end,
          v_mine is not null)
  returning id into v_id;
  return v_id;
end $$;

-- The team checks a factory's certificate: real (it counts) or turned down (the factory reads why).
create function public.check_factory_certificate(p_id uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.can_vouch_factory(public.current_company()) then
    raise exception 'Only the owner, a manager, a merchandiser or Quality can check a certificate.';
  end if;
  if not coalesce(p_ok, false) and v_note is null then
    raise exception 'Say why, so the factory knows what to send instead.';
  end if;
  update public.factory_certificates
  set status = case when p_ok then 'checked' else 'turned_down' end, status_note = left(v_note, 200), status_by = auth.uid(), status_at = now()
  where id = p_id and company_id = public.current_company() and removed_at is null;
  if not found then
    raise exception 'That certificate was removed. Reload the page.';
  end if;
end $$;

-- Removes a certificate: the team any, a factory only one it sent that isn't checked yet.
create function public.remove_factory_certificate(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.factory_certificates set removed_at = now(), removed_by = auth.uid()
  where id = p_id and company_id = public.current_company() and removed_at is null
    and (public.can_vouch_factory(company_id) or (factory_id = public.my_factory() and status <> 'checked'));
  if not found then
    raise exception 'That certificate can''t be removed here. Reload the page.';
  end if;
end $$;

-- The factory's own certificates, for its panel (a team member's preview reads the same).
create function public.factory_certificates_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'cert_no', cert_no, 'valid_until', valid_until,
                                               'path', path, 'file_name', file_name, 'status', status, 'status_note', status_note)
                            order by name, created_at), '[]'::jsonb)
  from public.factory_certificates
  where factory_id = public.viewing_factory() and company_id = public.current_company() and removed_at is null
$$;
revoke execute on function public.save_factory_certificate(uuid, text, text, date, text, text), public.check_factory_certificate(uuid, boolean, text),
  public.remove_factory_certificate(uuid), public.factory_certificates_mine() from public, anon;
grant execute on function public.save_factory_certificate(uuid, text, text, date, text, text), public.check_factory_certificate(uuid, boolean, text),
  public.remove_factory_certificate(uuid), public.factory_certificates_mine() to authenticated;

-- ================================================================ capacity
-- Free pieces a factory says it can still take, per week (weeks start on Monday). Not saying is not "zero".
create table public.factory_capacity (
  company_id uuid not null references public.companies (id),
  factory_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  free_pieces integer not null check (free_pieces between 0 and 5000000),
  note text check (length(note) <= 120),
  updated_by uuid not null default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (factory_id, week_start),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
alter table public.factory_capacity enable row level security;
revoke all on public.factory_capacity from public, anon, authenticated;
grant select on public.factory_capacity to authenticated;
create policy factory_capacity_read on public.factory_capacity for select to authenticated using (public.is_member(company_id));

-- Saves some weeks at once: [{week: '2026-11-30', free: 2000, note: ''}], free null clears the week.
-- The factory saves its own; the orders team may save for a factory that told them on the phone.
create function public.set_factory_capacity(p_factory uuid, p_weeks jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_factory uuid := coalesce(p_factory, public.my_factory());
  v_monday date := date_trunc('week', public.india_today())::date;
  w jsonb;
  v_week date;
  v_free integer;
begin
  if v_factory is null or not (coalesce(public.my_factory() = v_factory, false) or public.can_edit_orders(v_company) or public.can_vouch_factory(v_company)) then
    raise exception 'Only the factory itself or the orders team can set its free capacity.';
  end if;
  if not exists (select 1 from public.factories where id = v_factory and company_id = v_company) then
    raise exception 'That factory is not in your company.';
  end if;
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) > 26 then
    raise exception 'Send up to 26 weeks.';
  end if;
  for w in select * from jsonb_array_elements(p_weeks) loop
    begin
      v_week := (w ->> 'week')::date;
      v_free := nullif(w ->> 'free', '')::numeric::integer;
    exception when others then
      raise exception 'Give the free pieces as a number.';
    end;
    if v_week is null or extract(isodow from v_week) <> 1 or v_week < v_monday or v_week > v_monday + 7 * 25 then
      raise exception 'Weeks run from this Monday up to six months ahead.';
    end if;
    if v_free is null then
      delete from public.factory_capacity where factory_id = v_factory and week_start = v_week;
    elsif v_free < 0 or v_free > 5000000 then
      raise exception 'Free pieces must be between 0 and 50,00,000.';
    else
      insert into public.factory_capacity (company_id, factory_id, week_start, free_pieces, note)
      values (v_company, v_factory, v_week, v_free, nullif(left(btrim(coalesce(w ->> 'note', '')), 120), ''))
      on conflict (factory_id, week_start) do update
        set free_pieces = excluded.free_pieces, note = excluded.note, updated_by = auth.uid(), updated_at = now();
    end if;
  end loop;
end $$;

-- Week by week for some factories: what each said is free, and what is already due to ship with us that week
-- (open orders by their current ship date; garments in pieces, fabric in metres). Not callable from the app.
create function public.capacity_weeks(p_company uuid, p_factories uuid[], p_weeks integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with wk as (
    select generate_series(date_trunc('week', public.india_today())::date,
                           date_trunc('week', public.india_today())::date + 7 * (least(greatest(p_weeks, 1), 26) - 1), interval '7 days')::date as week
  ), due as (
    select l.factory_id, date_trunc('week', coalesce(o.revised_ship_date, o.ship_date))::date as week,
           sum(l.qty) filter (where l.product = 'garment') as pcs, sum(l.qty) filter (where l.product = 'fabric') as m
    from public.order_lines l join public.orders o on o.id = l.order_id and o.status = 'open' and o.removed_at is null
    where l.company_id = p_company and l.removed_at is null and l.factory_id = any(p_factories)
      and coalesce(o.revised_ship_date, o.ship_date) is not null
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('factory_id', f.id, 'weeks', (
    select jsonb_agg(jsonb_build_object('week', wk.week, 'free', c.free_pieces, 'note', c.note,
                                        'due_pcs', coalesce(d.pcs, 0), 'due_m', coalesce(d.m, 0), 'said_at', c.updated_at) order by wk.week)
    from wk
    left join public.factory_capacity c on c.factory_id = f.id and c.week_start = wk.week
    left join due d on d.factory_id = f.id and d.week = wk.week))), '[]'::jsonb)
  from public.factories f where f.company_id = p_company and f.id = any(p_factories)
$$;
revoke execute on function public.capacity_weeks(uuid, uuid[], integer) from public, anon, authenticated;

-- The team: every active factory, or one.
create function public.factory_capacity(p_factory uuid default null, p_weeks integer default 8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_member(public.current_company()) then
    public.capacity_weeks(public.current_company(),
      array(select id from public.factories where company_id = public.current_company() and (p_factory is null or id = p_factory) and (p_factory is not null or active)),
      p_weeks)
  else '[]'::jsonb end
$$;
-- The factory whose panel this is.
create function public.factory_capacity_mine(p_weeks integer default 8) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.viewing_factory() is null then null
    else public.capacity_weeks(public.current_company(), array[public.viewing_factory()], p_weeks) -> 0 end
$$;
revoke execute on function public.set_factory_capacity(uuid, jsonb), public.factory_capacity(uuid, integer), public.factory_capacity_mine(integer) from public, anon;
grant execute on function public.set_factory_capacity(uuid, jsonb), public.factory_capacity(uuid, integer), public.factory_capacity_mine(integer) to authenticated;

-- ================================================================ lead time
-- For every order a factory made: the days from the PO to its first shipment from that factory (its ex-factory step
-- when no dispatch is on record). Cancelled and deleted orders don't count, nor anything over a year.
create function public.lead_days(p_company uuid) returns table (factory_id uuid, product text, order_id uuid, days integer)
language sql stable security definer set search_path = '' as $$
  select x.factory_id, x.product, x.order_id, x.days from (
    select l.factory_id, min(l.product) as product, o.id as order_id,
           coalesce(
             (select min((d.shipped_at at time zone 'Asia/Kolkata')::date) from public.dispatches d
              where d.order_id = o.id and d.factory_id = l.factory_id and d.cancelled_at is null and d.shipped_at is not null),
             (select max(s.done_on) from public.line_stages s join public.order_lines l2 on l2.id = s.line_id and l2.removed_at is null
              where s.order_id = o.id and l2.factory_id = l.factory_id and s.stage = 'ex_factory' and s.done_on is not null)
           ) - coalesce(o.po_date, (o.created_at at time zone 'Asia/Kolkata')::date) as days
    from public.order_lines l join public.orders o on o.id = l.order_id and o.removed_at is null and o.status <> 'cancelled'
    where l.company_id = p_company and l.removed_at is null and l.factory_id is not null
    group by l.factory_id, o.id
  ) x where x.days between 1 and 365
$$;
revoke execute on function public.lead_days(uuid) from public, anon, authenticated;

-- The team: lead times per factory and kind of goods, and for the whole company per kind (factory_id null).
-- mid is the middle value; slow is the 80th percentile, the date we can promise with confidence.
create function public.lead_times() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_member(public.current_company()) then (
    select coalesce(jsonb_agg(jsonb_build_object('factory_id', g.factory_id, 'product', g.product, 'orders', g.orders, 'mid', g.mid, 'slow', g.slow)), '[]'::jsonb)
    from (
      select factory_id, product, count(*) as orders,
             round(percentile_cont(0.5) within group (order by days)) as mid, round(percentile_cont(0.8) within group (order by days)) as slow
      from public.lead_days(public.current_company()) group by grouping sets ((factory_id, product), (product))
    ) g)
  else '[]'::jsonb end
$$;
revoke execute on function public.lead_times() from public, anon;
grant execute on function public.lead_times() to authenticated;

-- ================================================================ the record carries certificates and lead time
create or replace function public.factory_facts(p_company uuid, p_factories uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with f as (
    select id, name, city, tally_ledger from public.factories where company_id = p_company and id = any(p_factories)
  ), ln as (
    select l.id, l.order_id, l.factory_id, l.qty, o.po_date, o.status
    from public.order_lines l
    join public.orders o on o.id = l.order_id and o.removed_at is null and o.status <> 'cancelled'
    where l.company_id = p_company and l.removed_at is null and l.factory_id = any(p_factories)
  ), ord as (
    select factory_id, count(distinct order_id) as orders, sum(qty) as pieces, min(po_date) as since from ln group by 1
  ), st as (
    -- A step finished on or before its target is on time; a step still open past its target on an open order is late.
    select ln.factory_id,
           count(*) filter (where s.done_on is not null and s.planned_on is not null) as finished,
           count(*) filter (where s.done_on is not null and s.planned_on is not null and s.done_on <= s.planned_on) as on_time,
           count(*) filter (where s.done_on is null and s.planned_on < public.india_today() and ln.status = 'open') as overdue
    from public.line_stages s join ln on ln.id = s.line_id
    where not coalesce(s.not_needed, false)
    group by 1
  ), qf as (
    -- Final checks of each factory's styles. A check saved for the whole order counts for every factory on it.
    select distinct on (q.id, ln.factory_id) q.id, q.order_id, q.line_id, q.checked_on, q.created_at, q.result,
           q.pieces_checked, q.defects, ln.factory_id
    from public.qc_checks q join ln on ln.order_id = q.order_id and (q.line_id is null or q.line_id = ln.id)
    where q.company_id = p_company and q.cancelled_at is null and q.kind = 'final'
  ), firsts as (
    -- The first Final check of each style (or of the whole order), by check date.
    select distinct on (factory_id, order_id, coalesce(line_id, factory_id)) factory_id, result
    from qf order by factory_id, order_id, coalesce(line_id, factory_id), checked_on, created_at
  ), qc as (
    select factory_id, count(*) as firsts, count(*) filter (where result = 'pass') as first_pass from firsts group by 1
  ), def as (
    select factory_id, coalesce(sum(pieces_checked), 0) as checked, coalesce(sum(defects), 0) as defects from qf group by 1
  ), sh as (
    select d.factory_id, count(*) as shipments,
           count(*) filter (where o.ship_date is not null) as dated,
           count(*) filter (where o.ship_date is not null and (d.shipped_at at time zone 'Asia/Kolkata')::date <= o.ship_date) as on_time,
           coalesce(sum((select sum(dl.qty) from public.dispatch_lines dl where dl.dispatch_id = d.id)), 0) as pieces
    from public.dispatches d join public.orders o on o.id = d.order_id and o.removed_at is null
    where d.company_id = p_company and d.cancelled_at is null and d.shipped_at is not null and d.factory_id = any(p_factories)
    group by 1
  ), cl as (
    select f.id as factory_id, count(*) as claims, coalesce(sum(c.amount), 0) as amount
    from public.factory_claims c join f on f.tally_ledger is not null and c.ledger = f.tally_ledger
    where c.company_id = p_company and c.cancelled_at is null
    group by 1
  ), ask as (
    select factory_id, count(*) as asks from public.factory_date_asks
    where company_id = p_company and factory_id = any(p_factories) group by 1
  ), acc as (
    -- Hours from the PO reaching the factory to the factory accepting it, middle value.
    select factory_id,
           percentile_cont(0.5) within group (order by extract(epoch from accepted_at - coalesce(mailed_at, factory_sent_at, released_at)) / 3600) as hours
    from public.factory_pos
    where company_id = p_company and factory_id = any(p_factories) and accepted_at is not null
      and coalesce(mailed_at, factory_sent_at, released_at) is not null and accepted_at >= coalesce(mailed_at, factory_sent_at, released_at)
    group by 1
  ), ver as (
    select distinct on (factory_id) factory_id, id, visited_on, gst_ok, udyam_no, certs
    from public.factory_verifications
    where company_id = p_company and cancelled_at is null and factory_id = any(p_factories)
    order by factory_id, visited_on desc, created_at desc
  ), crt as (
    -- Certificates the team has checked (0108). A factory's own upload counts only once the team checks it.
    select factory_id, jsonb_agg(jsonb_build_object('name', name, 'until', valid_until) order by name) as certs
    from public.factory_certificates
    where company_id = p_company and status = 'checked' and removed_at is null and factory_id = any(p_factories)
    group by 1
  ), lead as (
    select factory_id, count(*) as orders, percentile_cont(0.5) within group (order by days) as days
    from public.lead_days(p_company) where factory_id = any(p_factories)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'factory_id', f.id, 'name', f.name, 'city', f.city,
    'orders', coalesce(ord.orders, 0), 'pieces_ordered', coalesce(ord.pieces, 0), 'since', ord.since,
    'steps_finished', coalesce(st.finished, 0), 'steps_on_time', coalesce(st.on_time, 0), 'steps_overdue', coalesce(st.overdue, 0),
    'final_firsts', coalesce(qc.firsts, 0), 'final_first_pass', coalesce(qc.first_pass, 0),
    'pieces_checked', coalesce(def.checked, 0), 'defects', coalesce(def.defects, 0),
    'shipments', coalesce(sh.shipments, 0), 'shipments_dated', coalesce(sh.dated, 0), 'shipments_on_time', coalesce(sh.on_time, 0),
    'pieces_shipped', coalesce(sh.pieces, 0),
    'claims', coalesce(cl.claims, 0), 'claim_amount', coalesce(cl.amount, 0),
    'date_asks', coalesce(ask.asks, 0), 'accept_hours', round(acc.hours::numeric, 1),
    'verified', case when ver.id is null then null else jsonb_build_object('id', ver.id, 'visited_on', ver.visited_on, 'gst_ok', ver.gst_ok,
                                                                           'udyam_no', ver.udyam_no, 'certs', ver.certs) end,
    'certificates', coalesce(crt.certs, '[]'::jsonb),
    'lead_orders', coalesce(lead.orders, 0), 'lead_days', round(lead.days::numeric)
  ) order by f.name), '[]'::jsonb)
  from f
  left join ord on ord.factory_id = f.id left join st on st.factory_id = f.id left join qc on qc.factory_id = f.id
  left join def on def.factory_id = f.id left join sh on sh.factory_id = f.id left join cl on cl.factory_id = f.id
  left join ask on ask.factory_id = f.id left join acc on acc.factory_id = f.id left join ver on ver.factory_id = f.id
  left join crt on crt.factory_id = f.id left join lead on lead.factory_id = f.id
$$;

create or replace function public.buyer_factory_records() returns jsonb
language sql stable security definer set search_path = '' as $$
  with mine as (
    select o.id as order_id, l.id as line_id, l.factory_id
    from public.orders o
    join public.order_lines l on l.order_id = o.id and l.removed_at is null and l.factory_id is not null
    where o.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
      and o.status = 'open' and o.removed_at is null
  ), facts as (
    select x from jsonb_array_elements(public.factory_facts(public.current_company(), array(select distinct factory_id from mine))) x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', m.order_id, 'line_ids', m.line_ids, 'city', x ->> 'city',
    'orders', x -> 'orders', 'since', x -> 'since',
    'steps_finished', x -> 'steps_finished', 'steps_on_time', x -> 'steps_on_time', 'steps_overdue', x -> 'steps_overdue',
    'final_firsts', x -> 'final_firsts', 'final_first_pass', x -> 'final_first_pass',
    'shipments', x -> 'shipments', 'shipments_dated', x -> 'shipments_dated', 'shipments_on_time', x -> 'shipments_on_time',
    'pieces_shipped', x -> 'pieces_shipped',
    'verified', case when x -> 'verified' = 'null'::jsonb then null else jsonb_build_object('visited_on', x -> 'verified' -> 'visited_on',
                       'gst_ok', x -> 'verified' -> 'gst_ok', 'certs', x -> 'verified' -> 'certs') end,
    -- Only certificates still in date: a lapsed one is ours to chase, not the buyer's to read.
    'certificates', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(x -> 'certificates') c
                     where nullif(c ->> 'until', '') is null or (c ->> 'until')::date >= public.india_today())
  )), '[]'::jsonb)
  from (select order_id, factory_id, jsonb_agg(line_id) as line_ids from mine group by 1, 2) m
  join facts on (facts.x ->> 'factory_id')::uuid = m.factory_id
  where public.viewing_buyer() is not null
$$;

-- ================================================================ storage for factory papers
-- <company>/factory-files/<factory>/<certs|photos>/<file>: the factory itself and the team may upload; the team and that
-- factory may open. Everything else is as before (0091, 0094).
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[2] = 'factory-files' then
    return array_length(v_parts, 1) = 5 and v_parts[4] in ('certs', 'photos') and v_company = public.current_company()
       and (public.can_edit_orders(v_company) or public.is_quality(v_company) or coalesce(public.my_factory()::text = v_parts[3], false));
  end if;
  if v_parts[2] = 'help' then
    return array_length(v_parts, 1) = 4 and v_parts[3] = auth.uid()::text and public.my_role(v_company) is not null;
  end if;
  if v_parts[2] = 'inquiries' then
    return public.can_edit_orders(v_company)
        or (array_length(v_parts, 1) = 4 and public.buyer_may_upload_inquiry(v_company, v_parts[3]::uuid));
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
  if v_parts[3] = 'claims' then
    return array_length(v_parts, 1) = 5 and (public.can_edit_orders(v_company) or public.buyer_owns_order(v_company, v_parts[2]::uuid));
  end if;
  if v_parts[3] = 'notes' then
    return array_length(v_parts, 1) = 5 and public.is_member(v_company);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;

create or replace function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if public.my_factory() is null then
    return false;
  end if;
  if v_parts[2] = 'factory-files' then
    return v_parts[1] = public.current_company()::text and v_parts[3] = public.my_factory()::text;
  end if;
  if v_parts[3] in ('styles', 'files') and exists (
      select 1 from public.market_listings m join public.order_lines l on l.id = m.line_id and l.removed_at is null
      where m.closed_at is null and m.company_id = public.current_company() and m.closes_on >= public.india_today()
        and (l.photo_path = p_name
             or exists (select 1 from public.line_files f where f.line_id = l.id and f.path = p_name and f.removed_at is null
                        and f.kind in ('tech_pack', 'cutting')))) then
    return true;
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
  if v_parts[3] = 'qc' then
    return exists (select 1 from public.qc_photos p
                   join public.qc_checks q on q.id = p.qc_id and q.cancelled_at is null
                   join public.order_lines l on l.id = q.line_id and l.removed_at is null
                   where p.path = p_name and p.removed_at is null and q.company_id = public.current_company()
                     and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] <> 'factory' then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;
