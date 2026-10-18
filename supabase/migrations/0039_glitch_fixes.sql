-- Glitch fixes from the audit of 18 Oct 2026: what buyers and switched-off factories could still see or do,
-- factory updates confirmed on closed orders, and a few missing limits.

-- ---------------------------------------------------------------- 1. buyers saw the factory's own dates
-- Since buyers can open their styles' steps (0032), calling style_steps directly showed them the factory's dates.
-- A buyer login now gets no factory dates; everyone else sees the steps as before.
create or replace function public.style_steps(p_line uuid)
returns table (stage text, label text, pos integer, planned_on date, factory_on date, done_on date)
language sql stable security definer set search_path = '' as $$
  select st.stage, st.label, st.pos::integer, s.planned_on, case when public.my_buyer() is null then s.factory_on end, s.done_on
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
                    'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'],
              array['Greige', 'Fit sample', 'Fabric', 'Printing / dyeing', 'Strike off', 'PP sample', 'Size set',
                    'Cutting', 'Stitching', 'Inline', 'Mid-line', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'])
       with ordinality as st (stage, label, pos)
  left join public.line_stages s on s.line_id = p_line and s.stage = st.stage
  where not coalesce(s.not_needed, false) and public.can_see_line(p_line)
  union all
  select s.stage, s.label, (100 + row_number() over (order by s.added_at, s.stage))::integer, s.planned_on,
         case when public.my_buyer() is null then s.factory_on end, s.done_on
  from public.line_stages s
  where s.line_id = p_line and s.stage like 'extra\_%' and not s.not_needed and public.can_see_line(p_line)
$$;

-- ---------------------------------------------------------------- 2. buyers opened every QC file of their orders
-- A buyer could open any file under <company>/<order>/qc/: inline and mid-line reports, removed photos and report files.
-- Now only the photos buyer_orders hands out: the photos still on the latest final QC (or recheck) of each style
-- still on the order. That check may have failed; the buyer page shows it as "Being reworked" with its photos.
create or replace function public.buyer_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null or v_parts[3] not in ('qc', 'styles') then
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
  return exists (select 1 from public.orders o where o.id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
                 and o.company_id = public.current_company() and o.buyer_id = v_buyer);
exception when invalid_text_representation then
  return false;
end $$;

-- ---------------------------------------------------------------- 3. a switched-off factory kept its access
-- A factory switched off in Factories could still sign in with its WhatsApp link and use its panel.
-- Its logins now count for nothing until it is switched on again.
create or replace function public.my_factory() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.factory_id from public.members m
  join public.factories f on f.id = m.factory_id and f.company_id = m.company_id and f.active
  where m.company_id = public.current_company() and m.user_id = auth.uid() and m.active and m.role = 'factory'
$$;

create or replace function public.factory_link_login(p_secret text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', u.email, 'user_id', k.user_id, 'factory', f.name)
  from public.factory_links k
  join auth.users u on u.id = k.user_id
  join public.factories f on f.id = k.factory_id and f.active
  join public.members m on m.user_id = k.user_id and m.company_id = k.company_id and m.active
  where length(p_secret) >= 24 and k.secret = p_secret
$$;

-- ---------------------------------------------------------------- 3 and 4. making a new link always works
-- A switched-off factory's link couldn't be changed, so it couldn't be stopped. Making a new link (p_renew) now
-- works for it too; only sending a link needs the factory switched on.
-- A link whose login was switched off in Team kept being sent out, dead. Sending it now says so, and making a
-- new link switches the login back on.
create or replace function public.factory_link(p_factory uuid, p_renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_link public.factory_links%rowtype;
  v_name text;
  v_active boolean;
  v_secret text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_user uuid := gen_random_uuid();
  v_email text;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send a factory its link.';
  end if;
  select name, active into v_name, v_active from public.factories where id = p_factory and company_id = v_company;
  select * into v_link from public.factory_links where factory_id = p_factory;
  if v_name is null or (not v_active and not (p_renew and v_link.factory_id is not null)) then
    raise exception 'Pick one of your active factories.';
  end if;
  if v_link.factory_id is not null and not p_renew then
    if not exists (select 1 from public.members where user_id = v_link.user_id and company_id = v_link.company_id and active) then
      raise exception 'This link was switched off in Team. Make a new link to switch it back on.';
    end if;
    return v_link.secret;
  end if;
  if v_link.factory_id is not null then
    update auth.users set encrypted_password = extensions.crypt(v_secret, extensions.gen_salt('bf')), updated_at = now()
    where id = v_link.user_id;
    -- Phones still using the old link are signed out: their sessions end now and can't be refreshed.
    update auth.sessions set not_after = now() where user_id = v_link.user_id and (not_after is null or not_after > now());
    update auth.refresh_tokens set revoked = true where user_id = v_link.user_id::text and not coalesce(revoked, false);
    update public.factory_links set secret = v_secret, renewed_at = now() where factory_id = p_factory;
    -- The new link works: a login switched off in Team comes back on (a switched-off factory still can't sign in).
    update public.members set active = true where user_id = v_link.user_id and company_id = v_link.company_id and not active;
    return v_secret;
  end if;
  -- A login nobody types: no mail is ever sent to this address.
  v_email := 'factory-' || replace(v_user::text, '-', '') || '@links.sourcingo.in';
  insert into public.invites (company_id, email, role, factory_id, created_by)
  values (v_company, v_email, 'factory', p_factory, auth.uid());
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
          extensions.crypt(v_secret, extensions.gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', v_name || ' (WhatsApp link)'),
          now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  if not exists (select 1 from public.members where user_id = v_user and company_id = v_company and role = 'factory' and factory_id = p_factory) then
    raise exception 'The factory login could not be set up.';
  end if;
  insert into public.factory_links (factory_id, company_id, user_id, secret) values (p_factory, v_company, v_user, v_secret);
  return v_secret;
end $$;

-- ---------------------------------------------------------------- 5. updates confirmed on closed orders
-- An update could be confirmed after its order was shipped or cancelled, its style removed, or the style moved
-- to another factory. Those can now only be sent back.
create or replace function public.review_step_update(p_id uuid, p_confirm boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_u public.step_updates%rowtype;
begin
  select * into v_u from public.step_updates where id = p_id for update;
  if v_u.id is null or not (public.can_edit_orders(v_u.company_id) or public.is_quality(v_u.company_id)) then
    raise exception 'Only the orders team and Quality confirm factory updates.';
  end if;
  if v_u.status <> 'pending' then
    raise exception 'This update was already answered. Reload the page.';
  end if;
  if p_confirm then
    if not exists (select 1 from public.orders where id = v_u.order_id and status = 'open') then
      raise exception 'This order is no longer open, so the update can''t be confirmed. Send it back instead.';
    end if;
    if exists (select 1 from public.order_lines where id = v_u.line_id and removed_at is not null) then
      raise exception 'This style was removed from the order, so the update can''t be confirmed. Send it back instead.';
    end if;
    if not exists (select 1 from public.order_lines where id = v_u.line_id and factory_id = v_u.factory_id) then
      raise exception 'This style has moved to another factory since the update was sent, so it can''t be confirmed. Send it back instead.';
    end if;
    update public.line_stages set done_on = v_u.done_on where line_id = v_u.line_id and stage = v_u.stage and done_on is null;
    if not found then
      insert into public.line_stages (company_id, order_id, line_id, stage, done_on)
      select v_u.company_id, v_u.order_id, v_u.line_id, v_u.stage, v_u.done_on
      where not exists (select 1 from public.line_stages where line_id = v_u.line_id and stage = v_u.stage);
    end if;
  elsif nullif(btrim(p_note), '') is null then
    raise exception 'Say why, so the factory knows what to fix.';
  end if;
  update public.step_updates set status = case when p_confirm then 'confirmed' else 'declined' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id;
end $$;

-- Updates still waiting on orders that are shipped or cancelled, or on removed styles, can never be confirmed:
-- they are sent back with the reason, so they stop counting as waiting. Run once below; kept for checking it.
create or replace function public.close_stale_step_updates() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.step_updates u
  set status = 'declined', reviewed_at = now(),
      review_note = 'The order was shipped or cancelled, or the style was removed, before this was checked.'
  from public.order_lines l, public.orders o
  where u.status = 'pending' and l.id = u.line_id and o.id = u.order_id
    and (o.status <> 'open' or l.removed_at is not null);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.close_stale_step_updates() from public, anon, authenticated;
do $$ begin perform public.close_stale_step_updates(); end $$;

-- The morning brief counted those as waiting too. Only updates on open orders and styles still on them count now.
create or replace function public.brief_data_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_name text;
  v_today date := public.india_today();
begin
  select p.current_company_id, coalesce(nullif(p.full_name, ''), p.email) into v_company, v_name from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is null or v_role in ('factory', 'buyer') then
    raise exception 'The morning brief is for the Sourcingo team.';
  end if;
  return jsonb_build_object(
    'company', (select name from public.companies where id = v_company),
    'name', v_name,
    'role', v_role,
    'today', v_today,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po,
        'buyer', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = o.buyer_id), b.code),
        'due', coalesce(o.revised_ship_date, o.ship_date),
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'style', l.style, 'factory', f.name,
            'released', exists (select 1 from public.factory_pos fp where fp.order_id = o.id and fp.factory_id = l.factory_id and fp.released_at is not null),
            'steps', (select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'label', s.label, 'planned_on', s.planned_on, 'done_on', s.done_on)
                        order by s.pos), '[]'::jsonb)
                      from (select st.stage, st.label, st.pos, ls.planned_on, ls.done_on
                            from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set',
                                              'cutting', 'stitching', 'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory'],
                                        array['Greige', 'Fit sample', 'Fabric', 'Printing / dyeing', 'Strike off', 'PP sample', 'Size set',
                                              'Cutting', 'Stitching', 'Inline', 'Mid-line', 'Finishing', 'Packed', 'Final QC', 'Ex-factory'])
                                 with ordinality as st (stage, label, pos)
                            left join public.line_stages ls on ls.line_id = l.id and ls.stage = st.stage
                            union all
                            select ls.stage, ls.label, 100 + row_number() over (order by ls.added_at, ls.stage), ls.planned_on, ls.done_on
                            from public.line_stages ls where ls.line_id = l.id and ls.stage like 'extra\_%' and not ls.not_needed) s))
            order by l.position)
          from public.order_lines l left join public.factories f on f.id = l.factory_id
          where l.order_id = o.id and l.removed_at is null), '[]'::jsonb))
        order by coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
      from public.orders o join public.buyers b on b.id = o.buyer_id
      where o.company_id = v_company and o.status = 'open'), '[]'::jsonb),
    -- Factories asked for their plan more than 24 hours ago that haven't sent it.
    'plans_overdue', coalesce((
      select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'factory', f.name, 'asked_at', fp.plan_requested_at) order by fp.plan_requested_at)
      from public.factory_pos fp join public.orders o on o.id = fp.order_id join public.factories f on f.id = fp.factory_id
      where fp.company_id = v_company and o.status = 'open' and fp.released_at is null and fp.plan_requested_at < now() - interval '24 hours'
        and (fp.factory_sent_at is null or fp.factory_sent_at < fp.plan_requested_at)), '[]'::jsonb),
    'updates_waiting', (select count(*) from public.step_updates u
                        join public.orders o on o.id = u.order_id and o.status = 'open'
                        join public.order_lines l on l.id = u.line_id and l.removed_at is null
                        where u.company_id = v_company and u.status = 'pending'),
    'pos_to_check', case when v_role <> 'quality' then
      (select count(*) from public.incoming_pos i where i.company_id = v_company and i.status = 'to_check') end,
    'cheques', case when v_role in ('owner', 'accounts') then jsonb_build_object(
      'to_clear', (select count(*) from public.cheques c where c.company_id = v_company and c.status = 'deposited' and c.deposited_on <= v_today - 7),
      'to_clear_amount', (select coalesce(sum(c.amount), 0) from public.cheques c where c.company_id = v_company and c.status = 'deposited' and c.deposited_on <= v_today - 7),
      'to_deposit', (select count(*) from public.cheques c where c.company_id = v_company and c.status = 'in_hand' and c.cheque_date <= v_today and c.cheque_date + 90 >= v_today),
      'to_deposit_amount', (select coalesce(sum(c.amount), 0) from public.cheques c where c.company_id = v_company and c.status = 'in_hand' and c.cheque_date <= v_today and c.cheque_date + 90 >= v_today)
    ) end
  );
end $$;

-- ---------------------------------------------------------------- 6. factories marking Final QC or ex-factory done
-- Final QC is Quality's check and ex-factory is the dispatch; a factory's word isn't enough for either.
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

-- ---------------------------------------------------------------- 7. the health report for factory and buyer logins
-- Any login could read the health report. The hourly health check calls it with no login (the public key) and keeps
-- working; staff still can; factory and buyer logins can't.
create or replace function public.system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_storage numeric;
begin
  if auth.uid() is not null and not public.is_member(public.current_company()) then
    raise exception 'The health report is for the Sourcingo team.';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select round(coalesce(sum((metadata ->> ''size'')::bigint), 0) / 1048576.0) from storage.objects' into v_storage;
  end if;
  return jsonb_build_object(
    'tally_enabled', coalesce((select bool_or(enabled) from public.tally_settings), false),
    'tally_seen_hours', (select round(extract(epoch from now() - max(agent_seen_at)) / 3600, 1) from public.tally_settings where enabled),
    'tally_read_hours', (select round(extract(epoch from now() - max(snapshot_at)) / 3600, 1) from public.tally_settings where enabled),
    'email_hours', (select round(extract(epoch from now() - max(created_at)) / 3600, 1) from public.incoming_pos where source = 'email'),
    'failed_reads_24h', (select count(*) from public.incoming_pos where status = 'failed' and created_at > now() - interval '24 hours'),
    'db_mb', (select pg_database_size(current_database()) / 1048576),
    'storage_mb', v_storage);
end $$;

-- ---------------------------------------------------------------- 8. marker photos had no size limit
-- The app sends at most 4 MB of photos at a time (the hosting limit is 4.5 MB); a direct insert could send any amount.
alter table public.marker_job_parts add constraint marker_job_parts_size check (octet_length(files::text) <= 4500000) not valid;
alter table public.marker_job_parts validate constraint marker_job_parts_size;
