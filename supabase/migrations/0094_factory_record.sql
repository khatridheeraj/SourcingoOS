-- Factory Record (build 1 of the five-year roadmap): trust a factory earns from its real orders, not a badge it buys.
-- The record is worked out from what already happened on every order (steps against their targets, the first Final QC
-- of each style, shipments against the buyer's ship date, claims, asks for a new date, how fast it accepts a PO), plus a
-- "Verified by Sourcingo" visit: our own people went, checked GST and Udyam, and noted its certificates and their expiry.
--
-- Who reads what:
--   the team reads every factory's facts (factory_records);
--   a factory reads only its own (factory_record_mine), so it can see what buyers judge it by;
--   a buyer reads the facts of the factories making its open orders, never their names (buyer_factory_records).
-- The numbers are turned into percentages and words in the app (src/lib/factory-record.ts), so they are tested there.

create table public.factory_verifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  factory_id uuid not null,
  visited_on date not null,
  -- The GSTIN was looked up on the GST portal and is active, in this factory's name.
  gst_ok boolean not null default false,
  udyam_no text check (udyam_no ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  -- [{name, until}]: BSCI, SEDEX, GOTS, OEKO-TEX and the like, with the date each runs out (until may be null).
  certs jsonb not null default '[]'::jsonb check (jsonb_typeof(certs) = 'array' and jsonb_array_length(certs) <= 8),
  note text check (length(note) <= 300),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- A visit saved by mistake is taken back, never deleted.
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index factory_verifications_factory_idx on public.factory_verifications (factory_id, visited_on desc) where cancelled_at is null;
alter table public.factory_verifications enable row level security;
revoke all on public.factory_verifications from anon, authenticated;
grant select on public.factory_verifications to authenticated;
create policy factory_verifications_read on public.factory_verifications for select to authenticated using (public.is_member(company_id));

-- Owner, manager, merchandiser or Quality, after visiting the factory. Accounts does not visit factories.
create function public.verify_factory(p_factory uuid, p_visited_on date, p_gst_ok boolean, p_udyam text, p_certs jsonb, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_udyam text := nullif(upper(regexp_replace(coalesce(p_udyam, ''), '\s+', '', 'g')), '');
  v_certs jsonb := coalesce(p_certs, '[]'::jsonb);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_bad text;
  v_id uuid;
begin
  if coalesce(public.my_role(v_company) in ('owner', 'manager', 'merchandiser', 'quality'), false) is not true then
    raise exception 'Only the owner, a manager, a merchandiser or Quality can verify a factory.';
  end if;
  if not exists (select 1 from public.factories where id = p_factory and company_id = v_company) then
    raise exception 'That factory is not in your company.';
  end if;
  if p_visited_on is null or p_visited_on > public.india_today() or p_visited_on < public.india_today() - 365 then
    raise exception 'Pick the day of the visit: today or within the last year.';
  end if;
  if v_udyam is not null and v_udyam !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then
    raise exception 'Udyam number looks like UDYAM-RJ-17-0012345.';
  end if;
  if jsonb_typeof(v_certs) <> 'array' then
    raise exception 'Certificates must be a list.';
  end if;
  if jsonb_array_length(v_certs) > 8 then
    raise exception 'At most 8 certificates.';
  end if;
  select coalesce(nullif(btrim(x ->> 'name'), ''), 'A certificate') into v_bad
  from jsonb_array_elements(v_certs) x
  where jsonb_typeof(x) <> 'object'
     or length(btrim(coalesce(x ->> 'name', ''))) not between 2 and 60
     or (nullif(x ->> 'until', '') is not null and (x ->> 'until') !~ '^\d{4}-\d{2}-\d{2}$')
  limit 1;
  if found then
    raise exception '%: give the certificate''s name (2 to 60 letters) and, if it has one, the date it runs out.', v_bad;
  end if;
  if length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters.';
  end if;
  insert into public.factory_verifications (company_id, factory_id, visited_on, gst_ok, udyam_no, certs, note)
  values (v_company, p_factory, p_visited_on, coalesce(p_gst_ok, false), v_udyam,
          coalesce((select jsonb_agg(jsonb_build_object('name', btrim(x ->> 'name'), 'until', nullif(x ->> 'until', '')::date))
                    from jsonb_array_elements(v_certs) x), '[]'::jsonb),
          v_note)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.verify_factory(uuid, date, boolean, text, jsonb, text) from public, anon;
grant execute on function public.verify_factory(uuid, date, boolean, text, jsonb, text) to authenticated;

create function public.cancel_factory_verification(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.my_role(public.current_company()) in ('owner', 'manager', 'merchandiser', 'quality'), false) is not true then
    raise exception 'Only the owner, a manager, a merchandiser or Quality can do that.';
  end if;
  update public.factory_verifications set cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_id and company_id = public.current_company() and cancelled_at is null;
  if not found then
    raise exception 'That visit is already taken back. Reload the page.';
  end if;
  return true;
end $$;
revoke execute on function public.cancel_factory_verification(uuid) from public, anon;
grant execute on function public.cancel_factory_verification(uuid) to authenticated;

-- The raw facts for some factories of one company. Not callable from the app: the three readers below decide who may
-- see which factories. Cancelled orders and removed styles don't count; a step marked "not needed" doesn't count.
create function public.factory_facts(p_company uuid, p_factories uuid[]) returns jsonb
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
                                                                           'udyam_no', ver.udyam_no, 'certs', ver.certs) end
  ) order by f.name), '[]'::jsonb)
  from f
  left join ord on ord.factory_id = f.id left join st on st.factory_id = f.id left join qc on qc.factory_id = f.id
  left join def on def.factory_id = f.id left join sh on sh.factory_id = f.id left join cl on cl.factory_id = f.id
  left join ask on ask.factory_id = f.id left join acc on acc.factory_id = f.id left join ver on ver.factory_id = f.id
$$;
revoke execute on function public.factory_facts(uuid, uuid[]) from public, anon, authenticated;

-- The team: every factory of the company, or one.
create function public.factory_records(p_factory uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_member(public.current_company()) then
    public.factory_facts(public.current_company(),
      array(select id from public.factories where company_id = public.current_company() and (p_factory is null or id = p_factory)))
  else '[]'::jsonb end
$$;
revoke execute on function public.factory_records(uuid) from public, anon;
grant execute on function public.factory_records(uuid) to authenticated;

-- The factory whose panel this is (its own login, or a team member's preview): its own record only.
create function public.factory_record_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.viewing_factory() is null then null
    else public.factory_facts(public.current_company(), array[public.viewing_factory()]) -> 0 end
$$;
revoke execute on function public.factory_record_mine() from public, anon;
grant execute on function public.factory_record_mine() to authenticated;

-- The buyer whose page this is: for each open order, the factories making it, by city and record, never by name.
-- Claims and money stay inside; the buyer sees how reliably the factory delivers and passes our checks.
create function public.buyer_factory_records() returns jsonb
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
                       'gst_ok', x -> 'verified' -> 'gst_ok', 'certs', x -> 'verified' -> 'certs') end
  )), '[]'::jsonb)
  from (select order_id, factory_id, jsonb_agg(line_id) as line_ids from mine group by 1, 2) m
  join facts on (facts.x ->> 'factory_id')::uuid = m.factory_id
  where public.viewing_buyer() is not null
$$;
revoke execute on function public.buyer_factory_records() from public, anon;
grant execute on function public.buyer_factory_records() to authenticated;

-- ================================================================ approved photos for the buyer
-- The buyer never learns which factory makes its order, but follows it with photos it can trust: the factory sends
-- photos with each step it finishes, Sourcingo's team checks and confirms them, and only then does the buyer see them,
-- beside our own Final QC photos. The team can confirm a step and still keep its photos inside (a photo that shows the
-- factory's name board, say).
alter table public.step_updates add column buyer_sees boolean not null default true;

create function public.review_step_update(p_id uuid, p_confirm boolean, p_note text, p_buyer_sees boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.review_step_update(p_id, p_confirm, p_note);
  update public.step_updates set buyer_sees = coalesce(p_buyer_sees, true) where id = p_id;
end $$;
revoke execute on function public.review_step_update(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.review_step_update(uuid, boolean, text, boolean) to authenticated;

-- The confirmed step photos on the buyer's open orders (and orders shipped in the last 60 days, like its QC photos).
create function public.buyer_step_photos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', u.order_id, 'line_id', u.line_id, 'stage', u.stage, 'done_on', u.done_on,
                                               'photos', to_jsonb(u.photos)) order by u.done_on, u.reviewed_at), '[]'::jsonb)
  from public.step_updates u
  join public.orders o on o.id = u.order_id and o.removed_at is null
  join public.order_lines l on l.id = u.line_id and l.removed_at is null
  where u.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
    and u.status = 'confirmed' and u.buyer_sees
    and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
$$;
revoke execute on function public.buyer_step_photos() from public, anon;
grant execute on function public.buyer_step_photos() to authenticated;

-- The buyer may open those photos too; everything else it could open before stays the same.
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
        and r.status in ('with_buyer', 'approved', 'changes') and (p_name = any (r.photos) or p_name = any (r.answer_photos)))
    or exists (
      select 1 from public.step_updates u join public.orders o on o.id = u.order_id and o.removed_at is null
      where u.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and u.status = 'confirmed' and u.buyer_sees and p_name = any (u.photos)
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days')));
  end if;
  return exists (select 1 from public.orders o where o.id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
                 and o.company_id = public.current_company() and o.buyer_id = v_buyer);
end $$;
