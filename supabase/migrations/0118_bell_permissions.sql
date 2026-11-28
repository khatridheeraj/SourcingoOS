-- One bell for changes, per-person permissions, and the evening email.
--  1. members.perms: the owner switches Money and Download data on or off for each person. Money is the same gate
--     the database already uses for invoices, cheques, bills and Tally (is_finance), so the switch holds everywhere.
--  2. member_settings: when each person last opened Notifications, and whether they get the evening email.
--  3. bell_for(): what changed on the orders since a moment, worded by the app (src/lib/bell.ts).
--  4. evening_data_for_email(): one person's day, for the 7 pm email the scheduled task sends.

-- ---------------------------------------------------------------- 1. per-person permissions
alter table public.members add column perms jsonb not null default '{}'::jsonb
  check (jsonb_typeof(perms) = 'object');

-- What a role gets when the owner hasn't set a switch for the person.
create function public.perm_default(p_role text, p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_key
    when 'money' then p_role in ('owner', 'accounts')
    when 'export' then p_role in ('owner', 'accounts')
    else false end
$$;

-- The signed-in person's switch. The owner always has everything, so they can never lock themselves out.
create function public.my_perm(p_company uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when m.role = 'owner' then true
                when m.role in ('factory', 'buyer') then false
                else coalesce((m.perms ->> p_key)::boolean, public.perm_default(m.role, p_key)) end
    from public.members m where m.company_id = p_company and m.user_id = auth.uid() and m.active), false)
$$;
revoke execute on function public.my_perm(uuid, text) from public, anon;
grant execute on function public.my_perm(uuid, text) to authenticated;

-- Money now follows the person's switch (Owner and Accounts by default, as before).
create or replace function public.is_finance(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select public.my_perm(p_company, 'money') $$;

-- The owner sets a person's switches. Only known keys, only true/false, never on the owner or a partner login.
create function public.set_member_perms(p_user uuid, p_perms jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_role text;
  v_key text;
begin
  if not public.is_owner(v_company) then raise exception 'Only the owner can change what people see.'; end if;
  select role into v_role from public.members where company_id = v_company and user_id = p_user;
  if v_role is null then raise exception 'That person is not on the team.'; end if;
  if v_role in ('owner', 'factory', 'buyer') then raise exception 'The owner sees everything, and factory and buyer logins only see their own page.'; end if;
  if jsonb_typeof(p_perms) <> 'object' then raise exception 'Send the switches as an object.'; end if;
  for v_key in select jsonb_object_keys(p_perms) loop
    if v_key not in ('money', 'export') then raise exception 'Unknown switch: %', v_key; end if;
    if jsonb_typeof(p_perms -> v_key) not in ('boolean', 'null') then raise exception 'Switches are on or off.'; end if;
  end loop;
  update public.members set perms = jsonb_strip_nulls(perms || p_perms)
  where company_id = v_company and user_id = p_user;
  return (select perms from public.members where company_id = v_company and user_id = p_user);
end $$;
revoke execute on function public.set_member_perms(uuid, jsonb) from public, anon;
grant execute on function public.set_member_perms(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. each person's own settings
create table public.member_settings (
  company_id uuid not null references public.companies (id),
  user_id uuid not null,
  bell_seen_at timestamptz,
  evening_email boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
-- Opening Notifications is not a change anyone needs in the activity log (0020 attaches its recorder to every new table).
alter table public.member_settings disable trigger member_settings_history;
alter table public.member_settings enable row level security;
create policy member_settings_own on public.member_settings for select to authenticated using (user_id = auth.uid());
grant select on public.member_settings to authenticated;

-- Opening Notifications marks everything up to now as seen.
create function public.bell_seen() returns void
language sql security definer set search_path = '' as $$
  insert into public.member_settings (company_id, user_id, bell_seen_at)
  select public.current_company(), auth.uid(), now() where public.is_member(public.current_company())
  on conflict (company_id, user_id) do update set bell_seen_at = now(), updated_at = now()
$$;

create function public.set_evening_email(p_on boolean) returns void
language sql security definer set search_path = '' as $$
  insert into public.member_settings (company_id, user_id, evening_email)
  select public.current_company(), auth.uid(), coalesce(p_on, true) where public.is_member(public.current_company())
  on conflict (company_id, user_id) do update set evening_email = coalesce(p_on, true), updated_at = now()
$$;
revoke execute on function public.bell_seen(), public.set_evening_email(boolean) from public, anon;
grant execute on function public.bell_seen(), public.set_evening_email(boolean) to authenticated;

-- ---------------------------------------------------------------- 3. the bell
-- Everything that moved since p_since that this person should hear about, newest first, never their own doing.
-- Rows carry facts, not words: the app words them, so the bell and the evening email read the same.
create function public.bell_for(p_user uuid, p_since timestamptz, p_limit integer default 80)
returns table (at timestamptz, kind text, order_id uuid, order_no text, who text, info jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_orders boolean;
begin
  select p.current_company_id into v_company from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is null or v_role in ('factory', 'buyer') then return; end if;
  v_orders := v_role <> 'quality';
  return query
  with o as (
    select o.id, o.order_no, coalesce(n.real_name, b.code) as buyer
    from public.orders o left join public.buyers b on b.id = o.buyer_id left join public.buyer_names n on n.buyer_id = o.buyer_id
    where o.company_id = v_company and o.removed_at is null
  ), ev as (
    select m.created_at as at, 'buyer_message'::text as kind, m.order_id, null::text as who, jsonb_build_object('body', left(m.body, 160)) as info
      from public.buyer_messages m where v_orders and m.company_id = v_company and m.from_buyer and m.created_at > p_since
    union all
    select c.raised_at, 'buyer_claim', c.order_id, null, jsonb_build_object('claim_no', c.claim_no, 'pieces', c.pieces, 'reason', c.reason)
      from public.buyer_claims c where v_orders and c.company_id = v_company and c.by_buyer and c.raised_at > p_since
    union all
    select q.created_at, 'qc', q.order_id, null, jsonb_build_object('qc_kind', q.kind, 'result', q.result, 'defects', q.defects)
      from public.qc_checks q where q.company_id = v_company and q.cancelled_at is null and q.created_at > p_since
        and q.checked_by is distinct from p_user
    union all
    select fp.accepted_at, 'po_accepted', fp.order_id, f.name, jsonb_build_object('po_no', fp.po_no)
      from public.factory_pos fp join public.factories f on f.id = fp.factory_id
      where v_orders and fp.company_id = v_company and fp.accepted_at > p_since and fp.accepted_by is distinct from p_user
    union all
    select fp.reply_at, 'po_reply', fp.order_id, f.name, jsonb_build_object('po_no', fp.po_no, 'body', left(fp.reply_text, 160))
      from public.factory_pos fp join public.factories f on f.id = fp.factory_id
      where v_orders and fp.company_id = v_company and fp.reply_at > p_since and fp.accepted_at is null
    union all
    select fp.lock_requested_at, 'po_approval', fp.order_id, f.name, jsonb_build_object('po_no', fp.po_no)
      from public.factory_pos fp join public.factories f on f.id = fp.factory_id
      where v_role = 'owner' and fp.company_id = v_company and fp.lock_requested_at > p_since and fp.released_at is null
        and fp.lock_requested_by is distinct from p_user
    union all
    select a.created_at, 'date_ask', a.order_id, f.name, jsonb_build_object('stage', a.stage, 'old_on', a.old_on, 'new_on', a.new_on, 'reason', left(a.reason, 160))
      from public.factory_date_asks a join public.factories f on f.id = a.factory_id
      where a.company_id = v_company and a.created_at > p_since and a.created_by is distinct from p_user
    union all
    select r.created_at, 'goods_ready', r.order_id, f.name, jsonb_build_object('ready_on', r.ready_on, 'cartons', r.cartons)
      from public.factory_ready r join public.factories f on f.id = r.factory_id
      where v_orders and r.company_id = v_company and r.created_at > p_since and r.created_by is distinct from p_user
    union all
    select s.created_at, 'step_update', s.order_id, f.name, jsonb_build_object('stage', s.stage, 'photos', coalesce(array_length(s.photos, 1), 0))
      from public.step_updates s join public.factories f on f.id = s.factory_id
      where s.company_id = v_company and s.created_at > p_since and s.created_by is distinct from p_user
    union all
    select s.sent_at, 'sample_in', s.order_id, f.name, jsonb_build_object('stage', s.stage, 'round', s.round)
      from public.sample_rounds s left join public.factories f on f.id = s.factory_id
      where v_orders and s.company_id = v_company and s.sent_at > p_since and not coalesce(s.sent_by_team, false)
        and s.sent_by is distinct from p_user
    union all
    select s.answered_at, 'sample_answer', s.order_id, null, jsonb_build_object('stage', s.stage, 'status', s.status, 'body', left(s.answer_note, 160))
      from public.sample_rounds s
      where v_orders and s.company_id = v_company and s.answered_at > p_since and not coalesce(s.answered_for_buyer, false)
        and s.answered_by is distinct from p_user
    union all
    select n.created_at, 'tagged', n.order_id, coalesce(nullif(pr.full_name, ''), split_part(pr.email, '@', 1)), jsonb_build_object('body', left(n.body, 160))
      from public.order_notes n left join public.profiles pr on pr.id = n.created_by
      where n.company_id = v_company and n.created_at > p_since and n.mentions @> array[p_user] and n.created_by is distinct from p_user
    union all
    select i.created_at, case when i.status = 'held' then 'email_held' else 'buyer_email' end, i.matched_order_id, null,
           jsonb_build_object('subject', left(i.email_subject, 140), 'from', left(i.email_from, 120))
      from public.incoming_pos i
      where i.company_id = v_company and i.source = 'email' and i.created_at > p_since and coalesce(i.part, 1) <= 1
        and ((v_orders and i.status = 'to_check') or (v_role = 'owner' and i.status = 'held'))
    union all
    select u.created_at, 'buyer_po', null, coalesce(n.real_name, b.code), jsonb_build_object('buyer_po', u.buyer_po)
      from public.buyer_po_uploads u left join public.buyers b on b.id = u.buyer_id left join public.buyer_names n on n.buyer_id = u.buyer_id
      where v_orders and u.company_id = v_company and u.created_at > p_since
    union all
    select i.created_at, 'enquiry', null, coalesce(i.prospect, i.contact_name),
           jsonb_build_object('id', i.id, 'no', i.inquiry_no, 'product', left(i.product, 120), 'country', i.country)
      from public.inquiries i
      where v_orders and i.company_id = v_company and i.created_at > p_since and (i.from_site or i.asked_on_page) and i.created_by is distinct from p_user
    union all
    select i.buyer_answer_at, 'costing_answer', null, coalesce(i.prospect, i.contact_name),
           jsonb_build_object('id', i.id, 'no', i.inquiry_no, 'answer', i.buyer_answer, 'body', left(i.buyer_answer_note, 160))
      from public.inquiries i where v_orders and i.company_id = v_company and i.buyer_answer_at > p_since
    union all
    select a.created_at, 'factory_join', null, a.name, jsonb_build_object('city', a.city, 'makes', left(a.makes, 120))
      from public.factory_applications a where v_orders and a.company_id = v_company and a.created_at > p_since
    union all
    select q.created_at, 'quote', null, f.name, jsonb_build_object('listing_id', q.listing_id)
      from public.market_quotes q join public.factories f on f.id = q.factory_id
      where v_orders and q.company_id = v_company and q.created_at > p_since and q.withdrawn_at is null
  )
  select ev.at, ev.kind, ev.order_id, o.order_no, coalesce(ev.who, o.buyer), ev.info
  from ev left join o on o.id = ev.order_id
  where ev.order_id is null or o.id is not null
  order by ev.at desc
  limit greatest(1, least(coalesce(p_limit, 80), 200));
end $$;
revoke execute on function public.bell_for(uuid, timestamptz, integer) from public, anon, authenticated;

-- The signed-in person's bell: the last 14 days, each row marked fresh when it came after they last looked.
create function public.bell(p_limit integer default 80)
returns table (at timestamptz, kind text, order_id uuid, order_no text, who text, info jsonb, fresh boolean)
language sql stable security definer set search_path = '' as $$
  with s as (select bell_seen_at from public.member_settings where company_id = public.current_company() and user_id = auth.uid())
  select b.*, b.at > coalesce((select bell_seen_at from s), '-infinity'::timestamptz)
  from public.bell_for(auth.uid(), now() - interval '14 days', p_limit) b
$$;

-- How many are new, for the dot on the bell (at most 99).
create function public.bell_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.bell_for(auth.uid(),
    greatest(now() - interval '14 days', coalesce((select bell_seen_at from public.member_settings
      where company_id = public.current_company() and user_id = auth.uid()), '-infinity'::timestamptz)), 99)
$$;
revoke execute on function public.bell(integer), public.bell_count() from public, anon;
grant execute on function public.bell(integer), public.bell_count() to authenticated;

-- ---------------------------------------------------------------- 4. the evening email
-- One person's day: what changed since this morning, steps due tomorrow on open orders, and how many are late.
-- Null when they switched the email off, aren't on the team, or nothing happened and nothing is due.
create function public.evening_data_for_email(p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid;
  v_company uuid;
  v_role text;
  v_name text;
  v_today date := public.india_today();
  v_since timestamptz := (public.india_today()::timestamp at time zone 'Asia/Kolkata');
  v_items jsonb;
  v_tomorrow jsonb;
  v_late integer;
begin
  select p.id, p.current_company_id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into v_user, v_company, v_name from public.profiles p where lower(p.email) = lower(btrim(p_email)) limit 1;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = v_user and m.active;
  if v_role is null or v_role in ('factory', 'buyer') then return null; end if;
  if exists (select 1 from public.member_settings s where s.company_id = v_company and s.user_id = v_user and not s.evening_email) then
    return null;
  end if;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.at desc), '[]'::jsonb) into v_items from public.bell_for(v_user, v_since, 40) b;
  -- Tomorrow's steps (Monday's on a Saturday) on open orders: the orders team sees its own orders and the unassigned ones.
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'style', l.style, 'stage', s.stage, 'label', s.label,
                                               'on', s.planned_on) order by o.order_no, l.position, s.planned_on), '[]'::jsonb)
    into v_tomorrow
  from public.line_stages s join public.order_lines l on l.id = s.line_id join public.orders o on o.id = s.order_id
  where s.company_id = v_company and o.status = 'open' and o.removed_at is null and l.removed_at is null
    and s.done_on is null and not s.not_needed
    and s.planned_on between v_today + 1 and v_today + case when extract(isodow from v_today) = 6 then 2 else 1 end
    and (v_role in ('owner', 'quality', 'accounts') or o.merchandiser_id is null or o.merchandiser_id = v_user);
  select count(*) into v_late
  from public.line_stages s join public.order_lines l on l.id = s.line_id join public.orders o on o.id = s.order_id
  where s.company_id = v_company and o.status = 'open' and o.removed_at is null and l.removed_at is null
    and s.done_on is null and not s.not_needed and s.planned_on < v_today
    and (v_role in ('owner', 'quality', 'accounts') or o.merchandiser_id is null or o.merchandiser_id = v_user);
  if jsonb_array_length(v_items) = 0 and jsonb_array_length(v_tomorrow) = 0 and v_late = 0 then return null; end if;
  return jsonb_build_object('name', v_name, 'email', lower(btrim(p_email)), 'role', v_role, 'date', v_today,
    'company', (select c.name from public.companies c where c.id = v_company),
    'items', v_items, 'tomorrow', v_tomorrow, 'late', v_late);
end $$;
revoke execute on function public.evening_data_for_email(text) from public, anon, authenticated;

-- The team's addresses, for the scheduled task to go through one by one.
create function public.evening_recipients() returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct lower(p.email) from public.members m join public.profiles p on p.id = m.user_id
  where m.active and m.role not in ('factory', 'buyer') and p.email like '%@%'
  order by 1
$$;
revoke execute on function public.evening_recipients() from public, anon, authenticated;
