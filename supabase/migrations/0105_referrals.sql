-- Referrals (0105, six-month plan batch 12, 28 Nov 2026). Buyers and factories invite others with their own link
-- (/?ref=<code> for a brand, /for-factories?ref=<code> for a factory). Whoever arrives through it and asks for a costing
-- or asks to join is marked on the inquiry or the factory's ask, so the team knows who to thank and Reports > Leads
-- counts referrals as their own channel. A code never reveals who owns it to the visitor. Nothing is ever deleted.

create table public.referral_codes (
  code text primary key check (code ~ '^[a-z0-9]{8}$'),
  company_id uuid not null references public.companies (id),
  buyer_id uuid references public.buyers (id),
  factory_id uuid references public.factories (id),
  created_at timestamptz not null default now(),
  constraint referral_codes_one_owner check ((buyer_id is null) <> (factory_id is null))
);
create unique index referral_codes_buyer_key on public.referral_codes (buyer_id) where buyer_id is not null;
create unique index referral_codes_factory_key on public.referral_codes (factory_id) where factory_id is not null;
alter table public.referral_codes enable row level security;
revoke all on public.referral_codes from public, anon, authenticated;
grant select on public.referral_codes to authenticated;
create policy referral_codes_read on public.referral_codes for select to authenticated using (public.can_edit_orders(company_id));

alter table public.inquiries
  add column ref_code text,
  add column referred_by_buyer uuid references public.buyers (id),
  add column referred_by_factory uuid references public.factories (id);
alter table public.factory_applications
  add column ref_code text,
  add column referred_by_buyer uuid references public.buyers (id),
  add column referred_by_factory uuid references public.factories (id);

-- The invite code of the buyer or factory whose page this is, made the first time it is asked for.
create function public.my_referral_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := public.viewing_buyer();
  v_factory uuid := case when public.viewing_buyer() is null then public.viewing_factory() end;
  v_code text;
begin
  if v_buyer is null and v_factory is null then return null; end if;
  select code into v_code from public.referral_codes
  where (v_buyer is not null and buyer_id = v_buyer) or (v_factory is not null and factory_id = v_factory);
  if v_code is not null then return v_code; end if;
  loop
    v_code := substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (select 1 from public.referral_codes where code = v_code);
  end loop;
  insert into public.referral_codes (code, company_id, buyer_id, factory_id) values (v_code, public.current_company(), v_buyer, v_factory)
  on conflict do nothing;
  return (select code from public.referral_codes where (v_buyer is not null and buyer_id = v_buyer) or (v_factory is not null and factory_id = v_factory));
end $$;
revoke execute on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated;

-- The two website forms, as in 0096, now keeping the invite code a visitor arrived with.
create or replace function public.site_ask_costing(p jsonb) returns text
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
  v_ref public.referral_codes;
begin
  select * into v_ref from public.referral_codes r where r.code = lower(public.site_text(p, 'ref', 12)) and r.company_id = v_company;
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
  insert into public.inquiries (company_id, prospect, contact_name, contact, source, product, est_qty, unit, next_follow_up, notes, from_site, country,
                                ref_code, referred_by_buyer, referred_by_factory)
  values (v_company, coalesce(v_company_name, v_name), v_name, concat_ws(' · ', v_email, v_phone), 'other', v_product, v_qty,
          case when p ->> 'unit' = 'm' then 'm' else 'pcs' end, (now() at time zone 'Asia/Kolkata')::date, left(v_notes, 4000), true, v_country,
          v_ref.code, v_ref.buyer_id, v_ref.factory_id)
  returning inquiry_no into v_no;
  return v_no;
end $$;
revoke execute on function public.site_ask_costing(jsonb) from public;
grant execute on function public.site_ask_costing(jsonb) to anon, authenticated;

-- A factory asking to join from the website.
create or replace function public.site_join_factory(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.site_company();
  v_phone text := public.site_text(p, 'phone', 30);
  v_pieces integer;
  v_people integer;
  v_ref public.referral_codes;
begin
  select * into v_ref from public.referral_codes r where r.code = lower(public.site_text(p, 'ref', 12)) and r.company_id = v_company;
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
    raise exception 'We already have your details. Thank you.';
  end if;
  if (select count(*) from public.factory_applications where company_id = v_company and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'We are getting a lot of requests right now. Please try again in an hour.';
  end if;
  insert into public.factory_applications (company_id, name, city, contact_name, phone, email, makes, pieces_month, people, message,
                                           ref_code, referred_by_buyer, referred_by_factory)
  values (v_company, public.site_text(p, 'name', 120), public.site_text(p, 'city', 60), public.site_text(p, 'contact_name', 120), v_phone,
          lower(public.site_text(p, 'email', 200)), public.site_text(p, 'makes', 300), v_pieces, v_people, public.site_text(p, 'message', 2000),
          v_ref.code, v_ref.buyer_id, v_ref.factory_id);
end $$;
revoke execute on function public.site_join_factory(jsonb) from public;
grant execute on function public.site_join_factory(jsonb) to anon, authenticated;
