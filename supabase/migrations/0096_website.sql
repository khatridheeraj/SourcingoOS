-- The public website (0096, Dheeraj, 27 Nov 2026). Anyone on the internet can ask for a costing or ask to join as a
-- factory, without signing in. A costing ask becomes an inquiry like any other (ENQ-xxxx, follow-up due today, so it
-- is on Home and in the morning brief straight away); a factory's ask waits on the Factories page for the orders team.
-- The website reads one public fact: whether the Sourcingo Guarantee is switched on, and its terms. Nothing else in
-- the database is open to visitors. Nothing here is ever deleted.

-- Which inquiries came from the website, and the buyer's country (overseas buyers mostly).
alter table public.inquiries
  add column from_site boolean not null default false,
  add column country text check (length(country) <= 60);
create index inquiries_site_idx on public.inquiries (company_id, created_at) where from_site;

-- Factories asking to work with Sourcingo.
create table public.factory_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 2 and 120),
  city text not null check (length(btrim(city)) between 2 and 60),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 120),
  phone text not null check (length(btrim(phone)) between 6 and 30),
  email text check (length(email) <= 200),
  makes text not null check (length(btrim(makes)) between 2 and 300),
  pieces_month integer check (pieces_month between 1 and 10000000),
  people integer check (people between 1 and 100000),
  message text check (length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'added', 'declined')),
  status_by uuid references public.profiles (id),
  status_at timestamptz,
  created_at timestamptz not null default now()
);
create index factory_applications_open_idx on public.factory_applications (company_id, status, created_at desc);
alter table public.factory_applications enable row level security;
revoke all on public.factory_applications from public, anon, authenticated;
grant select, update (status, status_by, status_at) on public.factory_applications to authenticated;
create policy factory_applications_read on public.factory_applications for select to authenticated using (public.can_edit_orders(company_id));
create policy factory_applications_update on public.factory_applications for update to authenticated
  using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));

-- The company the public website speaks for (there is one).
create function public.site_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.companies order by created_at, id limit 1
$$;
revoke execute on function public.site_company() from public, anon, authenticated;

-- A visitor's text, trimmed, empty as null, cut to a length.
create function public.site_text(p jsonb, k text, n integer) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(p ->> k, ''), '[[:cntrl:]]+', ' ', 'g')), n), '')
$$;
revoke execute on function public.site_text(jsonb, text, integer) from public, anon, authenticated;

-- What the website shows about the Guarantee: only whether it is on, and its two numbers.
create function public.site_facts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('guarantee', c.guarantee_live, 'deposit_pct', c.guarantee_deposit_pct, 'pay_days', c.guarantee_pay_days)
  from public.companies c where c.id = public.site_company()
$$;
revoke execute on function public.site_facts() from public;
grant execute on function public.site_facts() to anon, authenticated;

-- A costing ask from the website. Returns the inquiry number to show the visitor.
create function public.site_ask_costing(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.site_company();
  v_company_name text := public.site_text(p, 'company', 120);
  v_name text := public.site_text(p, 'name', 120);
  v_email text := lower(public.site_text(p, 'email', 200));
  v_phone text := public.site_text(p, 'phone', 40);
  v_country text := public.site_text(p, 'country', 60);
  v_product text := public.site_text(p, 'product', 200);
  v_qty integer;
  v_notes text;
  v_no text;
begin
  if v_name is null or length(v_name) < 2 then raise exception 'Please tell us your name.'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please give an email address we can reply to.'; end if;
  if v_product is null or length(v_product) < 3 then raise exception 'Please tell us what you would like made.'; end if;
  begin
    v_qty := nullif(regexp_replace(coalesce(p ->> 'qty', ''), '[^0-9]', '', 'g'), '')::integer;
  exception when others then v_qty := null;
  end;
  if v_qty is not null and (v_qty < 1 or v_qty > 10000000) then v_qty := null; end if;
  -- One ask a minute from the same address, and no more than 60 asks an hour in all, so nobody can flood the team.
  if exists (select 1 from public.inquiries where company_id = v_company and from_site and lower(contact) like v_email || '%'
             and created_at > now() - interval '1 minute') then
    raise exception 'We already have your request. We will reply soon.';
  end if;
  if (select count(*) from public.inquiries where company_id = v_company and from_site and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are getting a lot of requests right now. Please try again in an hour.';
  end if;
  v_notes := concat_ws(E'\n',
    'Asked on the website.',
    case when public.site_text(p, 'target', 80) is not null then 'Target price: ' || public.site_text(p, 'target', 80) end,
    case when public.site_text(p, 'when', 80) is not null then 'Needed by: ' || public.site_text(p, 'when', 80) end,
    case when public.site_text(p, 'link', 300) is not null then 'Photos or tech pack: ' || public.site_text(p, 'link', 300) end,
    case when public.site_text(p, 'message', 2000) is not null then E'\n' || public.site_text(p, 'message', 2000) end);
  insert into public.inquiries (company_id, prospect, contact_name, contact, source, product, est_qty, unit, next_follow_up, notes, from_site, country)
  values (v_company, coalesce(v_company_name, v_name), v_name, concat_ws(' · ', v_email, v_phone), 'other', v_product, v_qty,
          case when p ->> 'unit' = 'm' then 'm' else 'pcs' end, (now() at time zone 'Asia/Kolkata')::date, left(v_notes, 4000), true, v_country)
  returning inquiry_no into v_no;
  return v_no;
end $$;
revoke execute on function public.site_ask_costing(jsonb) from public;
grant execute on function public.site_ask_costing(jsonb) to anon, authenticated;

-- A factory asking to join from the website.
create function public.site_join_factory(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.site_company();
  v_phone text := public.site_text(p, 'phone', 30);
  v_pieces integer;
  v_people integer;
begin
  if public.site_text(p, 'name', 120) is null or length(public.site_text(p, 'name', 120)) < 2 then raise exception 'Please give the factory''s name.'; end if;
  if public.site_text(p, 'city', 60) is null or length(public.site_text(p, 'city', 60)) < 2 then raise exception 'Please give the city.'; end if;
  if public.site_text(p, 'contact_name', 120) is null or length(public.site_text(p, 'contact_name', 120)) < 2 then raise exception 'Please give your name.'; end if;
  if v_phone is null or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then raise exception 'Please give a mobile number.'; end if;
  if public.site_text(p, 'makes', 300) is null or length(public.site_text(p, 'makes', 300)) < 2 then raise exception 'Please tell us what you make.'; end if;
  begin
    v_pieces := nullif(regexp_replace(coalesce(p ->> 'pieces_month', ''), '[^0-9]', '', 'g'), '')::integer;
    v_people := nullif(regexp_replace(coalesce(p ->> 'people', ''), '[^0-9]', '', 'g'), '')::integer;
  exception when others then v_pieces := null; v_people := null;
  end;
  if v_pieces is not null and (v_pieces < 1 or v_pieces > 10000000) then v_pieces := null; end if;
  if v_people is not null and (v_people < 1 or v_people > 100000) then v_people := null; end if;
  if exists (select 1 from public.factory_applications where company_id = v_company and phone = v_phone and created_at > now() - interval '1 minute') then
    raise exception 'We already have your details. We will call you soon.';
  end if;
  if (select count(*) from public.factory_applications where company_id = v_company and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are getting a lot of requests right now. Please try again in an hour.';
  end if;
  insert into public.factory_applications (company_id, name, city, contact_name, phone, email, makes, pieces_month, people, message)
  values (v_company, public.site_text(p, 'name', 120), public.site_text(p, 'city', 60), public.site_text(p, 'contact_name', 120), v_phone,
          lower(public.site_text(p, 'email', 200)), public.site_text(p, 'makes', 300), v_pieces, v_people, public.site_text(p, 'message', 2000));
end $$;
revoke execute on function public.site_join_factory(jsonb) from public;
grant execute on function public.site_join_factory(jsonb) to anon, authenticated;
