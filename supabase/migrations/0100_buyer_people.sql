-- Buyer team access (0100, Dheeraj, 28 Nov 2026). A real brand has three to five people on one order: sourcing,
-- design, quality, accounts. Each person now gets their own private link to the buyer's page, so the team knows
-- who wrote each message and can stop one person's access without touching the others. A person's link works
-- exactly like the buyer's status link (0072): behind it is a buyer login nobody types, and the secret is its
-- password. Every person sees the same page: the buyer's own orders, never factories or rates.
-- Nothing here is ever deleted; stopping a person switches their login off.

create table public.buyer_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  buyer_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 80),
  job text not null default 'other' check (job in ('owner', 'sourcing', 'design', 'quality', 'accounts', 'other')),
  phone text check (length(phone) <= 30),
  email text check (length(email) <= 200),
  user_id uuid not null unique,
  secret text not null unique,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  renewed_at timestamptz,
  stopped_at timestamptz,
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
create index buyer_people_buyer_idx on public.buyer_people (company_id, buyer_id);
alter table public.buyer_people enable row level security;
revoke all on public.buyer_people from public, anon, authenticated;
grant select (id, company_id, buyer_id, name, job, phone, email, user_id, created_at, renewed_at, stopped_at) on public.buyer_people to authenticated;
create policy buyer_people_read on public.buyer_people for select to authenticated using (public.can_edit_orders(company_id));

-- Adds a person at a buyer with their own login. Returns the person's id.
create function public.add_buyer_person(p_buyer uuid, p_name text, p_job text default 'other', p_phone text default null, p_email text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer text;
  v_name text := btrim(coalesce(p_name, ''));
  v_job text := coalesce(nullif(btrim(p_job), ''), 'other');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_secret text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_user uuid := gen_random_uuid();
  v_login text;
  v_id uuid;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can give a buyer''s people access.';
  end if;
  select coalesce((select n.real_name from public.buyer_names n where n.buyer_id = b.id), b.code)
    into v_buyer from public.buyers b where b.id = p_buyer and b.company_id = v_company and b.active;
  if v_buyer is null then raise exception 'Pick one of your active buyers.'; end if;
  if length(v_name) < 2 then raise exception 'Write the person''s name.'; end if;
  if length(v_name) > 80 then raise exception 'Keep the name under 80 letters.'; end if;
  if v_job not in ('owner', 'sourcing', 'design', 'quality', 'accounts', 'other') then raise exception 'Pick what the person does.'; end if;
  if v_phone is not null and (length(regexp_replace(v_phone, '\D', '', 'g')) < 8 or length(v_phone) > 30) then
    raise exception 'Write the WhatsApp number with its country code, like +44 7700 900123.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Check the email address.'; end if;
  if exists (select 1 from public.buyer_people where buyer_id = p_buyer and lower(name) = lower(v_name) and stopped_at is null) then
    raise exception '% already has a link for %.', v_buyer, v_name;
  end if;
  -- A login nobody types: no mail is ever sent to this address.
  v_login := 'buyer-' || replace(v_user::text, '-', '') || '@links.sourcingo.in';
  insert into public.invites (company_id, email, role, buyer_id, created_by) values (v_company, v_login, 'buyer', p_buyer, auth.uid());
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_login,
          extensions.crypt(v_secret, extensions.gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', v_name || ' (' || v_buyer || ')'),
          now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_login, 'email_verified', true), 'email', now(), now(), now());
  if not exists (select 1 from public.members where user_id = v_user and company_id = v_company and role = 'buyer' and buyer_id = p_buyer) then
    raise exception 'The login could not be set up.';
  end if;
  insert into public.buyer_people (company_id, buyer_id, name, job, phone, email, user_id, secret)
  values (v_company, p_buyer, v_name, v_job, v_phone, v_email, v_user, v_secret)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_buyer_person(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_buyer_person(uuid, text, text, text, text) to authenticated;

-- A person's link secret, or a fresh one when p_renew is true (which signs out every phone using the old one and
-- switches a stopped person back on).
create function public.buyer_person_link(p_person uuid, p_renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_p public.buyer_people%rowtype;
  v_secret text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can give a buyer''s people access.';
  end if;
  select * into v_p from public.buyer_people where id = p_person and company_id = v_company;
  if v_p.id is null then raise exception 'Pick one of this buyer''s people.'; end if;
  if not p_renew then
    if v_p.stopped_at is not null then raise exception '%''s access is stopped. Make a new link to switch it back on.', v_p.name; end if;
    return v_p.secret;
  end if;
  update auth.users set encrypted_password = extensions.crypt(v_secret, extensions.gen_salt('bf')), updated_at = now() where id = v_p.user_id;
  update auth.sessions set not_after = now() where user_id = v_p.user_id and (not_after is null or not_after > now());
  update auth.refresh_tokens set revoked = true where user_id = v_p.user_id::text and not coalesce(revoked, false);
  update public.buyer_people set secret = v_secret, renewed_at = now(), stopped_at = null where id = p_person;
  update public.members set active = true where user_id = v_p.user_id and company_id = v_company and not active;
  return v_secret;
end $$;
revoke execute on function public.buyer_person_link(uuid, boolean) from public, anon;
grant execute on function public.buyer_person_link(uuid, boolean) to authenticated;

-- Stops one person's access: their link stops working and every phone using it is signed out.
create function public.stop_buyer_person(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_p public.buyer_people%rowtype;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can give a buyer''s people access.';
  end if;
  select * into v_p from public.buyer_people where id = p_person and company_id = v_company;
  if v_p.id is null then raise exception 'Pick one of this buyer''s people.'; end if;
  update public.members set active = false where user_id = v_p.user_id and company_id = v_company;
  update auth.sessions set not_after = now() where user_id = v_p.user_id and (not_after is null or not_after > now());
  update auth.refresh_tokens set revoked = true where user_id = v_p.user_id::text and not coalesce(revoked, false);
  update public.buyer_people set stopped_at = coalesce(stopped_at, now()) where id = p_person;
end $$;
revoke execute on function public.stop_buyer_person(uuid) from public, anon;
grant execute on function public.stop_buyer_person(uuid) to authenticated;

-- The sign-in behind a link: the buyer's shared status link, or one person's own link.
create or replace function public.buyer_link_login(p_secret text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select x.login from (
    select jsonb_build_object('email', u.email, 'user_id', k.user_id) as login
    from public.buyer_links k
    join auth.users u on u.id = k.user_id
    join public.buyers b on b.id = k.buyer_id and b.active
    join public.members m on m.user_id = k.user_id and m.company_id = k.company_id and m.active
    where length(p_secret) >= 24 and k.secret = p_secret
    union all
    select jsonb_build_object('email', u.email, 'user_id', k.user_id, 'name', k.name)
    from public.buyer_people k
    join auth.users u on u.id = k.user_id
    join public.buyers b on b.id = k.buyer_id and b.active
    join public.members m on m.user_id = k.user_id and m.company_id = k.company_id and m.active
    where length(p_secret) >= 24 and k.secret = p_secret and k.stopped_at is null
  ) x limit 1
$$;

-- The buyer's messages now say which of its people wrote each one ('who', null for the shared link and for Sourcingo).
create or replace function public.buyer_messages_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'order_id', m.order_id, 'body', m.body, 'from_buyer', m.from_buyer,
                                               'at', m.created_at, 'who', case when m.from_buyer then p.name end) order by m.created_at), '[]'::jsonb)
  from public.buyer_messages m
  join public.orders o on o.id = m.order_id and o.company_id = m.company_id and o.status = 'open' and o.removed_at is null
  left join public.buyer_people p on p.user_id = m.created_by
  where m.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
$$;

-- Who is looking: the signed-in person's own name at the buyer, for the page to greet them.
create function public.buyer_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', p.name, 'job', p.job)
  from public.buyer_people p where p.user_id = auth.uid() and p.stopped_at is null
$$;
revoke execute on function public.buyer_me() from public, anon;
grant execute on function public.buyer_me() to authenticated;
