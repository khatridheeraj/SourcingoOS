-- The next round Dheeraj picked on 18 Oct 2026 ("Top 3"):
--  * Truthful TNA: once a factory's PO is released its targets are locked. Only the owner can move one, and only
--    with a reason. The target at release is kept as the baseline, so a moved target still shows where it started.
--  * Factory links: a factory opens one link from WhatsApp and is signed in to its own panel, with no email or
--    password. Behind the link is an ordinary factory login whose password is the link's secret.
--  * Morning brief: what is late, which ship dates are at risk, and what waits on whom, for the app's Brief page
--    and the 9 am email the Gmail script sends each person to themselves.

-- ---------------------------------------------------------------- locked targets
alter table public.line_stages add column baseline_on date, add column target_note text;
comment on column public.line_stages.baseline_on is 'The target when the factory PO was released (or when the step was first planned after release).';
comment on column public.line_stages.target_note is 'Why the owner moved this target after release.';

create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
  v_released boolean;
  v_reason text := btrim(coalesce(current_setting('sourcingo.target_reason', true), ''));
begin
  select l.factory_id into v_factory from public.order_lines l
  where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id;
  if not found then
    raise exception 'That style is not on this order.';
  end if;
  v_released := exists (select 1 from public.factory_pos f where f.order_id = new.order_id and f.factory_id = v_factory and f.released_at is not null);
  -- The baseline is written once: at release, or when a step is first planned after release.
  if tg_op = 'UPDATE' and old.baseline_on is not null then
    new.baseline_on := old.baseline_on;
  elsif v_released and new.baseline_on is null and not new.not_needed then
    new.baseline_on := new.planned_on;
  end if;
  -- Who may change what applies to people; data loads run by the database owner have no signed-in person.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;
  if (new.planned_on is distinct from (case when tg_op = 'INSERT' then null else old.planned_on end)
      or new.not_needed is distinct from (case when tg_op = 'INSERT' then false else old.not_needed end)
      or new.label is distinct from (case when tg_op = 'INSERT'
        then (select x.label from public.line_stages x where x.line_id = new.line_id and x.stage = new.stage) else old.label end))
     and not public.can_edit_orders(new.company_id) then
    raise exception 'Only the orders team can change the plan.';
  end if;
  -- After release a target that was set stays put: moving it (or dropping its step) would hide lateness.
  if tg_op = 'UPDATE' and v_released and old.planned_on is not null
     and (new.planned_on is distinct from old.planned_on or (new.not_needed and not old.not_needed)) then
    if not public.is_owner(new.company_id) then
      raise exception 'Targets are locked once the factory PO is released. Ask the owner to move one, with a reason.';
    end if;
    if v_reason = '' then
      raise exception 'Say why the target moves. Targets are locked once the PO is released.';
    end if;
    new.target_note := left(v_reason, 300);
  end if;
  if new.factory_on is distinct from (case when tg_op = 'INSERT' then null else old.factory_on end) then
    -- accept_targets_for_factory sets this flag for its own transaction only.
    if public.my_factory() is distinct from v_factory
       and not (current_setting('sourcingo.plan_for_factory', true) = 'on' and public.can_edit_orders(new.company_id)) then
      raise exception 'Only the factory enters its own dates.';
    end if;
    if v_released then
      raise exception 'The PO is released, so the factory''s dates are fixed.';
    end if;
  end if;
  if new.done_on is not null and new.done_on is distinct from (case when tg_op = 'INSERT' then null else old.done_on end) then
    if not (public.can_edit_orders(new.company_id) or public.is_quality(new.company_id)) then
      raise exception 'Only the orders team and Quality enter done dates.';
    end if;
    if not v_released then
      raise exception 'Release the factory PO before entering done dates.';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- p_rows may carry a target_note: the owner's reason for moving locked targets in this save.
create or replace function public.save_line_stages(p_order uuid, p_rows jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not (public.can_edit_orders(v_company) or public.is_quality(v_company)) then
    raise exception 'Only the orders team and Quality can change production.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Only open orders can be updated here. Reload the page.';
  end if;
  perform set_config('sourcingo.target_reason',
    coalesce((select max(btrim(r ->> 'target_note')) from jsonb_array_elements(p_rows) r), ''), true);
  if public.can_edit_orders(v_company) then
    insert into public.line_stages (order_id, line_id, stage, planned_on, done_on, not_needed, label)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'planned_on', '')::date, nullif(r ->> 'done_on', '')::date,
           coalesce((r ->> 'not_needed')::boolean, false),
           coalesce(nullif(btrim(r ->> 'label'), ''),
                    (select x.label from public.line_stages x where x.line_id = (r ->> 'line_id')::uuid and x.stage = r ->> 'stage'))
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on, not_needed = excluded.not_needed,
      label = coalesce(excluded.label, public.line_stages.label);
  else
    insert into public.line_stages (order_id, line_id, stage, done_on)
    select p_order, (r ->> 'line_id')::uuid, r ->> 'stage', nullif(r ->> 'done_on', '')::date
    from jsonb_array_elements(p_rows) r
    on conflict (line_id, stage) do update set done_on = excluded.done_on;
  end if;
  perform set_config('sourcingo.target_reason', '', true);
end $$;

create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_missing text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'This factory has no styles on the order.';
  end if;
  select string_agg(style || ' (' || what || ')', ' | ' order by first) into v_missing
  from (select style, min(ord) as first, string_agg(case kind
             when 'rate' then 'factory rate'
             when 'target' then 'target: ' || steps
             when 'beyond' then 'target after the PO target date: ' || steps
             when 'factory' then 'factory dates: ' || steps
             else 'factory later than target: ' || steps end, '; ' order by ord) as what
        from (select g.*, row_number() over () as ord from public.tna_gaps(p_order, p_factory) g) n
        group by style) per_style;
  if v_missing is not null then
    raise exception 'The plan is not complete yet. Missing: %', v_missing;
  end if;
  insert into public.factory_pos (company_id, order_id, factory_id, released_at, released_by)
  values (v_company, p_order, p_factory, now(), auth.uid())
  on conflict (order_id, factory_id) do update set released_at = now(), released_by = auth.uid()
  where public.factory_pos.released_at is null;
  -- The plan as released is the baseline that later lateness is measured from.
  update public.line_stages s set baseline_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and s.baseline_on is null and s.planned_on is not null and not s.not_needed;
end $$;

-- Plans already released keep the targets they have today as their baseline.
update public.line_stages s set baseline_on = s.planned_on
from public.order_lines l
join public.factory_pos f on f.order_id = l.order_id and f.factory_id = l.factory_id and f.released_at is not null
where l.id = s.line_id and s.baseline_on is null and s.planned_on is not null and not s.not_needed;

-- ---------------------------------------------------------------- factory links
-- One link per factory. The secret is kept so the team can send the same link again; making a new link
-- changes the secret and signs the old link out everywhere.
create table public.factory_links (
  factory_id uuid primary key,
  company_id uuid not null default public.current_company() references public.companies (id),
  user_id uuid not null unique,
  secret text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  renewed_at timestamptz,
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
alter table public.factory_links enable row level security;
create policy factory_links_read on public.factory_links for select to authenticated using (public.can_edit_orders(company_id));
revoke all on public.factory_links from anon, authenticated;
grant select on public.factory_links to authenticated;
-- The activity log records this table on its own; it must not keep the link's secret.
create or replace function public.history_hide_secrets(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p is null then null else p || coalesce((
    select jsonb_object_agg(k, 'hidden ' || left(md5(p ->> k), 6))
    from unnest(array['api_key', 'key_hash', 'secret']) k
    where p ? k and p ->> k is not null), '{}'::jsonb) end
$$;

-- The factory's link (made the first time it is asked for), or a fresh one when p_renew is true.
-- Returns the secret; the app builds the address from it.
create function public.factory_link(p_factory uuid, p_renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_link public.factory_links%rowtype;
  v_name text;
  v_secret text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_user uuid := gen_random_uuid();
  v_email text;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send a factory its link.';
  end if;
  select name into v_name from public.factories where id = p_factory and company_id = v_company and active;
  if v_name is null then
    raise exception 'Pick one of your active factories.';
  end if;
  select * into v_link from public.factory_links where factory_id = p_factory;
  if v_link.factory_id is not null and not p_renew then
    return v_link.secret;
  end if;
  if v_link.factory_id is not null then
    update auth.users set encrypted_password = extensions.crypt(v_secret, extensions.gen_salt('bf')), updated_at = now()
    where id = v_link.user_id;
    -- Phones still using the old link are signed out: their sessions end now and can't be refreshed.
    update auth.sessions set not_after = now() where user_id = v_link.user_id and (not_after is null or not_after > now());
    update auth.refresh_tokens set revoked = true where user_id = v_link.user_id::text and not coalesce(revoked, false);
    update public.factory_links set secret = v_secret, renewed_at = now() where factory_id = p_factory;
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
revoke execute on function public.factory_link(uuid, boolean) from public, anon;
grant execute on function public.factory_link(uuid, boolean) to authenticated;

-- The sign-in address behind a link, for the app to sign the factory in. Knowing the secret is the proof.
create function public.factory_link_login(p_secret text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', u.email, 'user_id', k.user_id, 'factory', f.name)
  from public.factory_links k
  join auth.users u on u.id = k.user_id
  join public.factories f on f.id = k.factory_id
  join public.members m on m.user_id = k.user_id and m.company_id = k.company_id and m.active
  where length(p_secret) >= 24 and k.secret = p_secret
$$;
revoke execute on function public.factory_link_login(text) from public;
grant execute on function public.factory_link_login(text) to anon, authenticated;

-- ---------------------------------------------------------------- morning brief
-- Everything the brief needs for one staff person, without prices. Money (cheques) only for the owner and Accounts.
create function public.brief_data_for(p_user uuid) returns jsonb
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
    'updates_waiting', (select count(*) from public.step_updates u where u.company_id = v_company and u.status = 'pending'),
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
revoke execute on function public.brief_data_for(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_for(uuid) to service_role;

-- The signed-in person's own brief, for the app's Brief page.
create function public.brief_data() returns jsonb
language sql stable security definer set search_path = '' as $$ select public.brief_data_for(auth.uid()) $$;
revoke execute on function public.brief_data() from public, anon;
grant execute on function public.brief_data() to authenticated;

-- The brief for the person whose Gmail script asks: the edge function has checked the mailbox's Google sign-in.
create function public.brief_data_for_email(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.brief_data_for((select id from public.profiles where lower(email) = lower(btrim(p_email)) limit 1))
$$;
revoke execute on function public.brief_data_for_email(text) from public, anon, authenticated;
grant execute on function public.brief_data_for_email(text) to service_role;
