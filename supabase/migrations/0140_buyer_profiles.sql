-- A buyer's full details, taken when the buyer is added, so invoices, export papers and shipments never wait on them.
-- One profile per buyer (legal name, addresses, tax numbers, contacts, terms, export parties, bank for refunds) and
-- the buyer's papers (GST certificate or company registration, PAN, signed buyer agreement, logo and label artwork).
-- What counts as complete, and what each paper needs, is worked out in src/lib/buyer-profile.ts.
--
-- All of it is about the buyer, so it follows the Buyer details switch (0126): the orders team and Accounts with the
-- switch read it; the assistant merchandiser and Quality never do. The buyer fills in and uploads its own details from
-- its private page; it never sees credit limit, deposit or our payment terms notes.

-- ---------------------------------------------------------------- 1. profile
create table public.buyer_profiles (
  buyer_id uuid primary key,
  company_id uuid not null default public.current_company() references public.companies (id),
  legal_name text check (length(legal_name) <= 200),
  brand_name text check (length(brand_name) <= 120),
  billing_address text check (length(billing_address) <= 500),
  country text check (length(country) <= 60),
  more_addresses text check (length(more_addresses) <= 1500),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tax_id text check (length(tax_id) <= 40),
  eori text check (length(eori) <= 20),
  contacts jsonb not null default '[]' check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 12),
  payment_terms text check (length(payment_terms) <= 300),
  deposit_pct numeric check (deposit_pct between 0 and 100),
  credit_limit numeric check (credit_limit >= 0),
  incoterm text check (incoterm in ('FOB', 'CIF', 'CFR', 'EXW', 'FCA', 'DAP', 'DDP')),
  port text check (length(port) <= 120),
  consignee text check (length(consignee) <= 600),
  notify_party text check (length(notify_party) <= 600),
  bank_holder text check (length(bank_holder) <= 120),
  bank_name text check (length(bank_name) <= 120),
  bank_account text check (length(bank_account) <= 40),
  bank_code text check (length(bank_code) <= 20),
  asked_at timestamptz,
  asked_by uuid references public.profiles (id),
  buyer_filled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id) on delete cascade
);
alter table public.buyer_profiles enable row level security;
create policy buyer_profiles_read on public.buyer_profiles for select to authenticated using (
  (public.can_edit_orders(company_id) or public.is_finance(company_id)) and public.can_see_buyers(company_id));
grant select on public.buyer_profiles to authenticated;

-- ---------------------------------------------------------------- 2. papers
create table public.buyer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  buyer_id uuid not null,
  kind text not null check (kind in ('gst', 'registration', 'pan', 'agreement', 'artwork', 'other')),
  path text not null check (path ~ '^[0-9a-f-]{36}/buyer-files/[0-9a-f-]{36}/[^/]+$'),
  file_name text not null check (length(file_name) between 1 and 200),
  by_buyer boolean not null default false,
  added_by uuid default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (company_id, buyer_id) references public.buyers (company_id, id) on delete cascade
);
create index buyer_documents_buyer on public.buyer_documents (buyer_id) where removed_at is null;
alter table public.buyer_documents enable row level security;
create policy buyer_documents_read on public.buyer_documents for select to authenticated using (
  (public.can_edit_orders(company_id) or public.is_finance(company_id)) and public.can_see_buyers(company_id));
grant select on public.buyer_documents to authenticated;

-- ---------------------------------------------------------------- 3. saving (team)
-- Who on the team may change a buyer's details: the orders team or Accounts, with Buyer details.
create function public.can_edit_buyer_profile(p_company uuid) returns boolean
language sql stable set search_path = '' as $$
  select (public.can_edit_orders(p_company) or public.is_finance(p_company)) and public.can_see_buyers(p_company)
$$;
revoke execute on function public.can_edit_buyer_profile(uuid) from public, anon;
grant execute on function public.can_edit_buyer_profile(uuid) to authenticated;

-- Cleans one contact list: name, role, mobile, WhatsApp, email; blank people dropped.
create function public.clean_buyer_contacts(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'name', nullif(left(btrim(c ->> 'name'), 80), ''), 'role', nullif(left(btrim(c ->> 'role'), 60), ''),
    'phone', nullif(left(btrim(c ->> 'phone'), 30), ''), 'whatsapp', nullif(left(btrim(c ->> 'whatsapp'), 30), ''),
    'email', nullif(lower(left(btrim(c ->> 'email'), 200)), '')))), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) c
  where coalesce(btrim(c ->> 'name'), '') <> '' or coalesce(btrim(c ->> 'phone'), '') <> '' or coalesce(btrim(c ->> 'email'), '') <> ''
$$;

-- Writes the fields present in p (a missing key leaves that field as it is; an empty string clears it).
-- p_terms: whether payment terms, deposit and credit limit may be written (the team only).
create function public.write_buyer_profile(p_company uuid, p_buyer uuid, p jsonb, p_terms boolean) returns void
language plpgsql set search_path = '' as $$
declare
  t text;
  v text;
  v_pan text;
begin
  insert into public.buyer_profiles (buyer_id, company_id) values (p_buyer, p_company) on conflict (buyer_id) do nothing;
  foreach t in array array['legal_name', 'brand_name', 'billing_address', 'country', 'more_addresses', 'tax_id', 'eori', 'port',
                           'consignee', 'notify_party', 'bank_holder', 'bank_name', 'bank_account', 'bank_code', 'incoterm'] loop
    if p ? t then
      v := nullif(btrim(regexp_replace(p ->> t, '[ \t]+', ' ', 'g')), '');
      if t in ('tax_id', 'eori', 'bank_account', 'bank_code', 'incoterm') then v := upper(replace(v, ' ', '')); end if;
      execute format('update public.buyer_profiles set %I = $1 where buyer_id = $2', t) using v, p_buyer;
    end if;
  end loop;
  if p ? 'gstin' then
    v := nullif(upper(regexp_replace(p ->> 'gstin', '\s', '', 'g')), '');
    if v is not null and v !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
      raise exception 'The GSTIN should be 15 letters and numbers, like 08ABCDE1234F1Z5.';
    end if;
    update public.buyer_profiles set gstin = v where buyer_id = p_buyer;
  end if;
  if p ? 'pan' then
    v := nullif(upper(regexp_replace(p ->> 'pan', '\s', '', 'g')), '');
    if v is not null and v !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
      raise exception 'The PAN should be 10 letters and numbers, like ABCDE1234F.';
    end if;
    update public.buyer_profiles set pan = v where buyer_id = p_buyer;
  end if;
  -- The PAN is inside every GSTIN (characters 3 to 12): filled in when it is blank.
  select substr(gstin, 3, 10) into v_pan from public.buyer_profiles where buyer_id = p_buyer and gstin is not null and pan is null;
  if v_pan is not null then update public.buyer_profiles set pan = v_pan where buyer_id = p_buyer; end if;
  if p ? 'contacts' then
    update public.buyer_profiles set contacts = public.clean_buyer_contacts(p -> 'contacts') where buyer_id = p_buyer;
  end if;
  if p_terms then
    if p ? 'payment_terms' then
      update public.buyer_profiles set payment_terms = nullif(btrim(p ->> 'payment_terms'), '') where buyer_id = p_buyer;
    end if;
    if p ? 'deposit_pct' then
      update public.buyer_profiles set deposit_pct = nullif(btrim(p ->> 'deposit_pct'), '')::numeric where buyer_id = p_buyer;
    end if;
    if p ? 'credit_limit' then
      update public.buyer_profiles set credit_limit = nullif(regexp_replace(p ->> 'credit_limit', '[,\s]', '', 'g'), '')::numeric where buyer_id = p_buyer;
    end if;
    if p ? 'credit_days' then
      update public.buyers set credit_days = nullif(btrim(p ->> 'credit_days'), '')::integer where id = p_buyer;
    end if;
    if p ? 'currency' and public.is_currency(p ->> 'currency') then
      update public.buyers set currency = p ->> 'currency' where id = p_buyer;
    end if;
  end if;
  -- The main ship-to address is the buyer's delivery address, which the challan and export papers already print.
  if p ? 'delivery_address' then
    update public.buyers set delivery_address = nullif(left(btrim(p ->> 'delivery_address'), 500), '') where id = p_buyer;
  end if;
  update public.buyer_profiles set updated_at = now(), updated_by = auth.uid() where buyer_id = p_buyer;
end $$;
revoke execute on function public.write_buyer_profile(uuid, uuid, jsonb, boolean) from public, anon, authenticated;

create function public.save_buyer_profile(p_buyer uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.buyers where id = p_buyer and company_id = public.current_company();
  if v_company is null then raise exception 'That buyer no longer exists.'; end if;
  if not public.can_edit_buyer_profile(v_company) then
    raise exception 'Only the orders team or Accounts, with Buyer details, can change a buyer''s details.';
  end if;
  perform public.write_buyer_profile(v_company, p_buyer, p, true);
end $$;
revoke execute on function public.save_buyer_profile(uuid, jsonb) from public, anon;
grant execute on function public.save_buyer_profile(uuid, jsonb) to authenticated;

-- A paper the team uploaded into the buyer's folder.
create function public.add_buyer_document(p_buyer uuid, p_kind text, p_path text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_id uuid;
begin
  select company_id into v_company from public.buyers where id = p_buyer and company_id = public.current_company();
  if v_company is null then raise exception 'That buyer no longer exists.'; end if;
  if not public.can_edit_buyer_profile(v_company) then
    raise exception 'Only the orders team or Accounts, with Buyer details, can add a buyer''s papers.';
  end if;
  if split_part(p_path, '/', 1) <> v_company::text or split_part(p_path, '/', 3) <> p_buyer::text then
    raise exception 'That file is not in this buyer''s folder.';
  end if;
  insert into public.buyer_documents (company_id, buyer_id, kind, path, file_name)
  values (v_company, p_buyer, p_kind, p_path, left(btrim(p_name), 200)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_buyer_document(uuid, text, text, text) from public, anon;
grant execute on function public.add_buyer_document(uuid, text, text, text) to authenticated;

create function public.remove_buyer_document(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.buyer_documents;
begin
  select * into v_d from public.buyer_documents where id = p_id and removed_at is null;
  if v_d.id is null then raise exception 'That paper was already taken off.'; end if;
  if not (v_d.company_id = public.current_company() and public.can_edit_buyer_profile(v_d.company_id))
     and not (v_d.by_buyer and v_d.buyer_id = public.my_buyer()) then
    raise exception 'Only the orders team or Accounts, with Buyer details, can take off a buyer''s papers.';
  end if;
  update public.buyer_documents set removed_at = now() where id = p_id;
end $$;
revoke execute on function public.remove_buyer_document(uuid) from public, anon;
grant execute on function public.remove_buyer_document(uuid) to authenticated;

-- The team asks the buyer to fill in what is missing from its own page. The message with the link is made on screen.
create function public.ask_buyer_details(p_buyer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.buyers where id = p_buyer and company_id = public.current_company();
  if v_company is null then raise exception 'That buyer no longer exists.'; end if;
  if not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company)) then
    raise exception 'Only the orders team, with Buyer details, can ask a buyer for its details.';
  end if;
  insert into public.buyer_profiles (buyer_id, company_id) values (p_buyer, v_company) on conflict (buyer_id) do nothing;
  update public.buyer_profiles set asked_at = now(), asked_by = auth.uid() where buyer_id = p_buyer;
end $$;
revoke execute on function public.ask_buyer_details(uuid) from public, anon;
grant execute on function public.ask_buyer_details(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. the buyer's own page
-- Its own details and papers (no deposit, credit limit or terms notes), for the buyer or a team preview of it.
create function public.my_buyer_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'buyer_id', b.id,
    'profile', (select to_jsonb(p) - 'deposit_pct' - 'credit_limit' - 'payment_terms' - 'asked_by' - 'updated_by' - 'company_id'
                from public.buyer_profiles p where p.buyer_id = b.id),
    'delivery_address', b.delivery_address, 'currency', b.currency, 'credit_days', b.credit_days,
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'path', d.path, 'file_name', d.file_name,
                                                         'by_buyer', d.by_buyer, 'added_at', d.added_at) order by d.added_at)
                      from public.buyer_documents d where d.buyer_id = b.id and d.removed_at is null), '[]'::jsonb))
  from public.buyers b where b.id = public.viewing_buyer() and b.company_id = public.current_company()
$$;
revoke execute on function public.my_buyer_profile() from public, anon;
grant execute on function public.my_buyer_profile() to authenticated;

create function public.buyer_save_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
  v_company uuid;
begin
  select company_id into v_company from public.buyers where id = v_buyer and company_id = public.current_company();
  if v_company is null then raise exception 'This login is not set up for a buyer.'; end if;
  perform public.write_buyer_profile(v_company, v_buyer, p - 'payment_terms' - 'deposit_pct' - 'credit_limit' - 'credit_days' - 'currency', false);
  update public.buyer_profiles set buyer_filled_at = now() where buyer_id = v_buyer;
end $$;
revoke execute on function public.buyer_save_profile(jsonb) from public, anon;
grant execute on function public.buyer_save_profile(jsonb) to authenticated;

create function public.buyer_add_document(p_kind text, p_path text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
  v_company uuid;
  v_id uuid;
begin
  select company_id into v_company from public.buyers where id = v_buyer and company_id = public.current_company();
  if v_company is null then raise exception 'This login is not set up for a buyer.'; end if;
  if split_part(p_path, '/', 1) <> v_company::text or split_part(p_path, '/', 3) <> v_buyer::text then
    raise exception 'That file is not in your folder.';
  end if;
  insert into public.buyer_documents (company_id, buyer_id, kind, path, file_name, by_buyer)
  values (v_company, v_buyer, p_kind, p_path, left(btrim(p_name), 200), true) returning id into v_id;
  insert into public.buyer_profiles (buyer_id, company_id) values (v_buyer, v_company) on conflict (buyer_id) do nothing;
  update public.buyer_profiles set buyer_filled_at = now() where buyer_id = v_buyer;
  return v_id;
end $$;
revoke execute on function public.buyer_add_document(text, text, text) from public, anon;
grant execute on function public.buyer_add_document(text, text, text) to authenticated;

-- ---------------------------------------------------------------- 5. files: <company>/buyer-files/<buyer>/<file>
-- Each change is an exact piece of text added in front of a line already in the function, so another thread's
-- change to the same function stays; if a piece is missing, the whole migration stops.
do $$
declare
  p record;
  v_def text;
begin
  for p in select * from (values
    ('public.can_upload_photo(text)'::regprocedure, $a$  if v_parts[2] = 'help' then$a$,
     $b$  if v_parts[2] = 'buyer-files' then
    return array_length(v_parts, 1) = 4 and v_company = public.current_company()
       and (public.can_edit_buyer_profile(v_company) or coalesce(public.my_buyer()::text = v_parts[3], false));
  end if;
$b$),
    ('public.can_read_order_file(text)'::regprocedure, $a$  if not public.is_member(v_parts[1]::uuid) then$a$,
     $b$  if v_parts[2] = 'buyer-files' then
    return public.can_edit_buyer_profile(v_parts[1]::uuid);
  end if;
$b$),
    ('public.buyer_can_read_photo(text)'::regprocedure, $a$  if v_buyer is null or v_parts[3] not in$a$,
     $b$  if v_parts[2] = 'buyer-files' then
    return v_buyer is not null and v_parts[3] = v_buyer::text and v_parts[1] = public.current_company()::text
       and exists (select 1 from public.buyer_documents d where d.path = p_name and d.buyer_id = v_buyer and d.removed_at is null);
  end if;
$b$)
  ) as t (fn, before, ins) loop
    v_def := pg_get_functiondef(p.fn);
    if position(p.before in v_def) = 0 then
      raise exception 'Buyer files: "%" not found in %', p.before, p.fn;
    end if;
    v_def := replace(v_def, p.before, p.ins || p.before);
    execute v_def;
  end loop;
end $$;
