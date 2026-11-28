-- Factory self-onboarding (six-month plan, batch 11, factory half): a factory that asked to join on the website becomes
-- a factory in one tap, gets its panel link on WhatsApp, and fills its own profile there: what it makes, people,
-- machines, pieces a month, floor photos, free capacity (0108) and certificates (0108). Then it asks for a visit and
-- the team books one. The visit itself is still the "Verified by Sourcingo" record (0094); nothing here vouches for it.

-- The factory an application became.
alter table public.factory_applications add column factory_id uuid references public.factories (id);

create table public.factory_profiles (
  factory_id uuid primary key,
  company_id uuid not null references public.companies (id),
  -- What it makes, from the products on the website or typed (src/lib/onboarding.ts MAKES).
  makes text[] not null default '{}' check (cardinality(makes) <= 10),
  about text check (length(about) <= 600),
  address text check (length(address) <= 300),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  people integer check (people between 1 and 100000),
  machines integer check (machines between 1 and 100000),
  pieces_month integer check (pieces_month between 1 and 10000000),
  -- Floor photos: <company>/factory-files/<factory>/photos/<file>, for the team only (never shown to buyers as is).
  photos text[] not null default '{}' check (cardinality(photos) <= 12),
  -- The factory asks for a visit from a day on; the team books the day.
  visit_from date,
  visit_note text check (length(visit_note) <= 300),
  visit_asked_at timestamptz,
  visit_on date,
  visit_booked_by uuid references public.profiles (id),
  visit_booked_at timestamptz,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index factory_profiles_visit_idx on public.factory_profiles (company_id) where visit_asked_at is not null and visit_on is null;
alter table public.factory_profiles enable row level security;
revoke all on public.factory_profiles from public, anon, authenticated;
grant select on public.factory_profiles to authenticated;
create policy factory_profiles_read on public.factory_profiles for select to authenticated using (public.is_member(company_id));

-- Turns an application into a factory (or finds the one with the same name), copies what it told us, and marks the
-- application added. Returns the factory, so the app can open its panel link to send on WhatsApp.
create function public.add_factory_from_application(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_a public.factory_applications%rowtype;
  v_factory uuid;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can add a factory.';
  end if;
  select * into v_a from public.factory_applications where id = p_id and company_id = v_company for update;
  if v_a.id is null then
    raise exception 'That ask was not found. Reload the page.';
  end if;
  v_factory := v_a.factory_id;
  if v_factory is null then
    select id into v_factory from public.factories where company_id = v_company and lower(btrim(name)) = lower(btrim(v_a.name));
  end if;
  if v_factory is null then
    insert into public.factories (company_id, name, city, contact_name, phone, notes)
    values (v_company, btrim(v_a.name), btrim(v_a.city), btrim(v_a.contact_name), btrim(v_a.phone),
            nullif(concat_ws(E'\n', 'Asked to join on the website.', 'Makes: ' || v_a.makes, v_a.email), ''))
    returning id into v_factory;
  end if;
  insert into public.factory_profiles (factory_id, company_id, about, people, pieces_month, updated_by)
  values (v_factory, v_company, left(btrim(v_a.makes), 600), v_a.people, v_a.pieces_month, auth.uid())
  on conflict (factory_id) do nothing;
  update public.factory_applications set status = 'added', status_by = auth.uid(), status_at = now(), factory_id = v_factory where id = v_a.id;
  return v_factory;
end $$;

-- Saves the profile. The factory saves its own; the owner, a manager, a merchandiser or Quality may correct it.
-- Fields left out of p keep their value.
create function public.save_factory_profile(p_factory uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_factory uuid := coalesce(p_factory, public.my_factory());
  v_makes text[];
  v_photos text[];
  v_gstin text := nullif(upper(regexp_replace(coalesce(p ->> 'gstin', ''), '\s+', '', 'g')), '');
  v_prefix text;
begin
  if v_factory is null or not (public.can_vouch_factory(v_company) or coalesce(public.my_factory() = v_factory, false)) then
    raise exception 'Only the factory itself, or the owner, a manager, a merchandiser or Quality, can change this profile.';
  end if;
  if not exists (select 1 from public.factories where id = v_factory and company_id = v_company) then
    raise exception 'That factory is not in your company.';
  end if;
  if p ? 'makes' then
    if jsonb_typeof(p -> 'makes') <> 'array' then
      raise exception 'Pick what you make.';
    end if;
    select coalesce(array_agg(distinct btrim(x)), '{}') into v_makes from jsonb_array_elements_text(p -> 'makes') x where btrim(x) <> '';
    if cardinality(v_makes) > 10 or exists (select 1 from unnest(v_makes) m where length(m) > 40) then
      raise exception 'Pick up to 10 products, each under 40 letters.';
    end if;
  end if;
  if p ? 'photos' then
    v_prefix := v_company::text || '/factory-files/' || v_factory::text || '/photos/';
    select coalesce(array_agg(x), '{}') into v_photos from jsonb_array_elements_text(coalesce(p -> 'photos', '[]')) x;
    if cardinality(v_photos) > 12 then
      raise exception 'Up to 12 photos.';
    end if;
    if exists (select 1 from unnest(v_photos) x where left(x, length(v_prefix)) <> v_prefix) then
      raise exception 'Those photos belong to another factory.';
    end if;
  end if;
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'A GSTIN is 15 letters and numbers, like 08ABCDE1234F1Z5.';
  end if;
  insert into public.factory_profiles (factory_id, company_id) values (v_factory, v_company) on conflict (factory_id) do nothing;
  update public.factory_profiles set
    makes = case when p ? 'makes' then v_makes else makes end,
    about = case when p ? 'about' then nullif(btrim(p ->> 'about'), '') else about end,
    address = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else address end,
    gstin = case when p ? 'gstin' then v_gstin else gstin end,
    people = case when p ? 'people' then nullif(p ->> 'people', '')::integer else people end,
    machines = case when p ? 'machines' then nullif(p ->> 'machines', '')::integer else machines end,
    pieces_month = case when p ? 'pieces_month' then nullif(p ->> 'pieces_month', '')::integer else pieces_month end,
    photos = case when p ? 'photos' then v_photos else photos end,
    updated_by = auth.uid(), updated_at = now()
  where factory_id = v_factory;
exception
  when invalid_text_representation then raise exception 'Give people, machines and pieces as whole numbers.';
  when check_violation then raise exception 'Some numbers are too big or the text is too long. Check and save again.';
end $$;

-- The factory asks Sourcingo to visit, from a day on (within the next 60 days).
create function public.ask_factory_visit(p_from date, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
begin
  if v_factory is null then
    raise exception 'Only the factory can ask for a visit.';
  end if;
  if p_from is null or p_from < public.india_today() or p_from > public.india_today() + 60 then
    raise exception 'Pick a day from today to 60 days ahead.';
  end if;
  insert into public.factory_profiles (factory_id, company_id) values (v_factory, public.current_company()) on conflict (factory_id) do nothing;
  update public.factory_profiles
  set visit_from = p_from, visit_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300), visit_asked_at = now(),
      visit_on = null, visit_booked_by = null, visit_booked_at = null
  where factory_id = v_factory;
end $$;

-- The team books the visit day (or clears it with null).
create function public.book_factory_visit(p_factory uuid, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_vouch_factory(public.current_company()) then
    raise exception 'Only the owner, a manager, a merchandiser or Quality can book a visit.';
  end if;
  if p_on is not null and (p_on < public.india_today() or p_on > public.india_today() + 120) then
    raise exception 'Pick a day from today to 120 days ahead.';
  end if;
  if not exists (select 1 from public.factories where id = p_factory and company_id = public.current_company()) then
    raise exception 'That factory is not in your company.';
  end if;
  insert into public.factory_profiles (factory_id, company_id) values (p_factory, public.current_company()) on conflict (factory_id) do nothing;
  update public.factory_profiles set visit_on = p_on, visit_booked_by = auth.uid(), visit_booked_at = now(),
    visit_asked_at = coalesce(visit_asked_at, case when p_on is not null then now() end)
  where factory_id = p_factory;
end $$;

-- The factory's own profile (and in the team's preview of its panel, the same).
create function public.factory_profile_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.viewing_factory() is null then null else coalesce(
    (select to_jsonb(p) - 'company_id' - 'updated_by' - 'visit_booked_by' from public.factory_profiles p
     where p.factory_id = public.viewing_factory() and p.company_id = public.current_company()),
    jsonb_build_object('factory_id', public.viewing_factory(), 'makes', '[]'::jsonb, 'photos', '[]'::jsonb)) end
$$;

revoke execute on function public.add_factory_from_application(uuid), public.save_factory_profile(uuid, jsonb),
  public.ask_factory_visit(date, text), public.book_factory_visit(uuid, date), public.factory_profile_mine() from public, anon;
grant execute on function public.add_factory_from_application(uuid), public.save_factory_profile(uuid, jsonb),
  public.ask_factory_visit(date, text), public.book_factory_visit(uuid, date), public.factory_profile_mine() to authenticated;
