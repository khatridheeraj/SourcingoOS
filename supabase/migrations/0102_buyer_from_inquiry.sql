-- A buyer page for a new lead (0102, Dheeraj, 28 Nov 2026). Someone who asked for a costing on the website, by email
-- or on WhatsApp isn't a buyer in the app yet, so they can't see our price or answer it. One tap on the inquiry now
-- makes them a buyer (or links the buyer they already are), gives the person who asked their own link (0100), and
-- moves the ask onto their page, where they see the price when it is ready and accept it or ask for changes.
-- Nothing is sent to them by the app: the team sends the link. Nothing here is ever deleted.

-- A short buyer code from a company name: "Areeba Fashion House" -> BYR-AFH, then BYR-AFH2 if that is taken.
create function public.buyer_code_for(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_words text[] := regexp_split_to_array(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9 ]', ' ', 'g')), '\s+');
  v_base text := '';
  v_code text;
  v_n integer := 1;
  w text;
begin
  foreach w in array v_words loop
    if w <> '' and w not in ('THE', 'AND', 'OF', 'LTD', 'LLC', 'INC', 'PVT', 'LIMITED', 'GMBH', 'CO') then v_base := v_base || left(w, 1); end if;
  end loop;
  if length(v_base) < 2 then
    v_base := left(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9]', '', 'g') || 'XX', 3);
  end if;
  v_base := 'BYR-' || left(v_base, 4);
  v_code := v_base;
  while exists (select 1 from public.buyers where company_id = public.current_company() and code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || v_n;
  end loop;
  return v_code;
end $$;
revoke execute on function public.buyer_code_for(text) from public, anon, authenticated;

-- Makes the asker of an open inquiry a buyer with their own link. Returns the buyer, the person and whether the buyer
-- was already in the app.
create function public.make_buyer_from_inquiry(p_inquiry uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_i public.inquiries%rowtype;
  v_buyer uuid;
  v_found boolean := false;
  v_email text;
  v_phone text;
  v_person uuid;
  v_name text;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can add buyers.';
  end if;
  select * into v_i from public.inquiries where id = p_inquiry and company_id = v_company for update;
  if v_i.id is null then raise exception 'That inquiry isn''t in this company.'; end if;
  if v_i.buyer_id is not null then raise exception '% is already for a buyer in the app.', v_i.inquiry_no; end if;
  if v_i.status not in ('new', 'quoted') then raise exception '% is closed. Open a new inquiry for them.', v_i.inquiry_no; end if;
  if nullif(btrim(v_i.prospect), '') is null then raise exception 'Write the company''s name on the inquiry first.'; end if;

  -- The buyer they already are, by name, else a new one.
  select b.id into v_buyer from public.buyers b join public.buyer_names n on n.buyer_id = b.id
  where b.company_id = v_company and b.active and lower(btrim(n.real_name)) = lower(btrim(v_i.prospect)) limit 1;
  v_found := v_buyer is not null;
  if not v_found then
    insert into public.buyers (company_id, code, notes)
    values (v_company, public.buyer_code_for(v_i.prospect), 'Added from ' || v_i.inquiry_no || coalesce(' (' || v_i.country || ')', '') || '.')
    returning id into v_buyer;
    insert into public.buyer_names (buyer_id, real_name) values (v_buyer, left(btrim(v_i.prospect), 120));
  end if;

  update public.inquiries set buyer_id = v_buyer, asked_on_page = true where id = p_inquiry;

  -- The person who asked gets their own link. The contact reads "email · phone" on website asks.
  v_email := lower(substring(coalesce(v_i.contact, '') from '[^@\s·,;]+@[^@\s·,;]+\.[A-Za-z]{2,}'));
  v_phone := nullif(btrim(substring(coalesce(v_i.contact, '') from '\+?[0-9][0-9 ()-]{6,}[0-9]')), '');
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) < 8 then v_phone := null; end if;
  v_name := left(btrim(coalesce(nullif(btrim(v_i.contact_name), ''), v_i.prospect)), 80);
  if length(v_name) < 2 then v_name := left(btrim(v_i.prospect), 80); end if;
  select id into v_person from public.buyer_people where buyer_id = v_buyer and lower(name) = lower(v_name) and stopped_at is null;
  if v_person is null then
    v_person := public.add_buyer_person(v_buyer, v_name, 'sourcing', left(v_phone, 30), left(v_email, 200));
  end if;
  return jsonb_build_object('buyer_id', v_buyer, 'person_id', v_person, 'existing', v_found, 'name', v_name);
end $$;
revoke execute on function public.make_buyer_from_inquiry(uuid) from public, anon;
grant execute on function public.make_buyer_from_inquiry(uuid) to authenticated;
