-- Every factory's full details and papers, taken when it is added, so no PO waits on them later (Dheeraj, 28 Nov 2026:
-- "take all the factory details while adding the factory itself… collect all the necessary documents").
-- A factory is Ready for POs when factory_gaps() lists nothing. A factory PO can't be sent for approval, or approved,
-- until then. The team fills the details on the factory's page; the factory can fill them and upload its papers
-- from its own panel. Papers reuse factory_certificates (0108) with a kind, so checking, expiry reminders on Home
-- and storage all work as they do for certificates. Additive only.

-- ================================================================ the details
alter table public.factories
  add column if not exists legal_name text check (length(legal_name) <= 200),
  add column if not exists state text check (length(state) <= 60),
  add column if not exists pin text check (pin ~ '^[1-9][0-9]{5}$'),
  add column if not exists pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add column if not exists udyam_no text check (udyam_no ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  add column if not exists no_gst_reason text check (length(no_gst_reason) <= 200),
  add column if not exists whatsapp text check (length(whatsapp) <= 30),
  add column if not exists bank_holder text check (length(bank_holder) <= 120),
  add column if not exists bank_account text check (bank_account ~ '^[0-9]{9,18}$'),
  add column if not exists bank_ifsc text check (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  add column if not exists bank_name text check (length(bank_name) <= 120),
  add column if not exists pay_days smallint check (pay_days between 0 and 365),
  -- Bank details the factory itself changed after they were set: confirm by phone before paying into them.
  add column if not exists bank_changed_at timestamptz,
  add column if not exists details_by uuid references public.profiles (id),
  add column if not exists details_at timestamptz;

-- Papers are certificates with a kind: 'cert' (GOTS, OEKO-TEX…, 0108) or one of the papers below.
alter table public.factory_certificates
  add column if not exists kind text not null default 'cert'
    check (kind in ('cert', 'gst', 'pan', 'cheque', 'agreement', 'udyam', 'licence'));
create index if not exists factory_certificates_kind_idx on public.factory_certificates (factory_id, kind) where removed_at is null;

-- The state a GSTIN's first two digits stand for.
create or replace function public.gst_state(p_code text) returns text
language sql immutable set search_path = '' as $$
  select s from (values ('35','Andaman and Nicobar Islands'),('37','Andhra Pradesh'),('12','Arunachal Pradesh'),('18','Assam'),
    ('10','Bihar'),('04','Chandigarh'),('22','Chhattisgarh'),('26','Dadra and Nagar Haveli and Daman and Diu'),('07','Delhi'),
    ('30','Goa'),('24','Gujarat'),('06','Haryana'),('02','Himachal Pradesh'),('01','Jammu and Kashmir'),('20','Jharkhand'),
    ('29','Karnataka'),('32','Kerala'),('38','Ladakh'),('31','Lakshadweep'),('23','Madhya Pradesh'),('27','Maharashtra'),
    ('14','Manipur'),('17','Meghalaya'),('15','Mizoram'),('13','Nagaland'),('21','Odisha'),('34','Puducherry'),('03','Punjab'),
    ('08','Rajasthan'),('11','Sikkim'),('33','Tamil Nadu'),('36','Telangana'),('16','Tripura'),('09','Uttar Pradesh'),
    ('05','Uttarakhand'),('19','West Bengal')) v(c, s) where c = p_code
$$;

-- ================================================================ what is missing
-- One row per factory the caller may see: the team sees its company's factories, a factory login only its own.
-- `missing` is in the order a person fills them; `total` is how many items count for this factory.
create or replace function public.factory_gaps(p_factory uuid default null)
returns table (factory_id uuid, missing text[], total integer)
language sql stable security definer set search_path = '' as $$
  with f as (
    select fa.*, coalesce(fa.gstin, fp.gstin) as g, coalesce(fa.address, fp.address) as addr,
           (fa.no_gst_reason is not null and coalesce(fa.gstin, fp.gstin) is null) as no_gst,
           st.days as ledger_days
    from public.factories fa
    left join public.factory_profiles fp on fp.factory_id = fa.id
    left join public.supplier_terms st on st.company_id = fa.company_id and st.ledger = fa.tally_ledger
    where fa.company_id = public.current_company()
      and (p_factory is null or fa.id = p_factory)
      and (public.is_member(fa.company_id) or fa.id = public.viewing_factory())
  ), d as (
    select c.factory_id, array_agg(distinct c.kind) as kinds from public.factory_certificates c
    join f on f.id = c.factory_id
    where c.removed_at is null and c.status <> 'turned_down' and c.path is not null and c.kind <> 'cert'
    group by c.factory_id
  )
  select f.id, array_remove(array[
      case when f.legal_name is null then 'Legal name' end,
      case when f.g is null and not f.no_gst then 'GSTIN' end,
      case when f.pan is null and f.g is null then 'PAN' end,
      case when f.addr is null then 'Address' end,
      case when f.state is null then 'State' end,
      case when f.pin is null then 'PIN code' end,
      case when f.contact_name is null then 'Contact person' end,
      case when f.phone is null then 'Mobile' end,
      case when coalesce(f.email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then 'Email' end,
      case when f.bank_account is null or f.bank_ifsc is null then 'Bank account and IFSC' end,
      case when f.pay_days is null and f.ledger_days is null then 'Payment terms' end,
      case when not f.no_gst and not coalesce('gst' = any (d.kinds), false) then 'GST certificate' end,
      case when not coalesce('pan' = any (d.kinds), false) then 'PAN card' end,
      case when not coalesce('cheque' = any (d.kinds), false) then 'Cancelled cheque' end,
      case when not coalesce('agreement' = any (d.kinds), false) then 'Signed vendor agreement' end
    ], null), case when f.no_gst then 14 else 15 end
  from f left join d on d.factory_id = f.id
$$;
revoke execute on function public.factory_gaps(uuid) from public, anon;
grant execute on function public.factory_gaps(uuid) to authenticated;

-- Why a factory can't have a PO sent yet, or null when it is Ready for POs.
create or replace function public.factory_kyc_blocker(p_factory uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when cardinality(g.missing) > 0 then
    'The factory''s details are not complete yet. Missing: ' || array_to_string(g.missing, ', ')
    || '. Fill them on the factory''s page, or send the factory its link to fill them.' end
  from public.factory_gaps(p_factory) g
$$;
revoke execute on function public.factory_kyc_blocker(uuid) from public, anon;
grant execute on function public.factory_kyc_blocker(uuid) to authenticated;

-- ================================================================ saving the details
-- The team (orders team) or the factory itself. Only the keys present in `p` change; '' clears a field.
create or replace function public.save_factory_details(p_factory uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_factory uuid := coalesce(p_factory, public.my_factory());
  v_mine boolean := coalesce(public.my_factory() = coalesce(p_factory, public.my_factory()), false);
  f public.factories;
  v text;
  v_gstin text; v_pan text; v_state text; v_ifsc text; v_acct text; v_udyam text; v_pin text; v_email text; v_days smallint;
  v_bank_moved boolean;
begin
  if v_factory is null or not (v_mine or public.can_edit_orders(v_company)) then
    raise exception 'Only the factory itself or the orders team can change these details.';
  end if;
  select * into f from public.factories where id = v_factory and company_id = v_company for update;
  if f.id is null then
    raise exception 'That factory is not in your company.';
  end if;
  -- Each value as given, trimmed; missing keys keep what is there.
  v_gstin := case when p ? 'gstin' then nullif(upper(regexp_replace(p ->> 'gstin', '\s+', '', 'g')), '') else f.gstin end;
  v_pan := case when p ? 'pan' then nullif(upper(regexp_replace(p ->> 'pan', '\s+', '', 'g')), '') else f.pan end;
  v_state := case when p ? 'state' then nullif(btrim(p ->> 'state'), '') else f.state end;
  v_pin := case when p ? 'pin' then nullif(regexp_replace(p ->> 'pin', '\s+', '', 'g'), '') else f.pin end;
  v_udyam := case when p ? 'udyam_no' then nullif(upper(regexp_replace(p ->> 'udyam_no', '\s+', '', 'g')), '') else f.udyam_no end;
  v_ifsc := case when p ? 'bank_ifsc' then nullif(upper(regexp_replace(p ->> 'bank_ifsc', '\s+', '', 'g')), '') else f.bank_ifsc end;
  v_acct := case when p ? 'bank_account' then nullif(regexp_replace(p ->> 'bank_account', '\s+', '', 'g'), '') else f.bank_account end;
  v_email := case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else f.email end;
  if v_gstin is not null then
    if v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
      raise exception 'A GSTIN has 15 letters and numbers, like 08ABCDE1234F1Z5.';
    end if;
    if public.gst_state(left(v_gstin, 2)) is null then
      raise exception 'A GSTIN starts with a state code; % isn''t one.', left(v_gstin, 2);
    end if;
    if v_state is not null and v_state <> public.gst_state(left(v_gstin, 2)) then
      raise exception 'This GSTIN is from %, but the state says %. Check either.', public.gst_state(left(v_gstin, 2)), v_state;
    end if;
    -- The PAN is inside the GSTIN: take it from there when not given.
    v_pan := coalesce(v_pan, substr(v_gstin, 3, 10));
    if v_pan <> substr(v_gstin, 3, 10) then
      raise exception 'The PAN doesn''t match the GSTIN, whose PAN is %.', substr(v_gstin, 3, 10);
    end if;
    v_state := coalesce(v_state, public.gst_state(left(v_gstin, 2)));
  end if;
  if v_state is not null and v_state not in (select public.gst_state(lpad(n::text, 2, '0')) from generate_series(1, 38) n) then
    raise exception 'Pick the state from the list.';
  end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'A PAN has 10 letters and numbers, like ABCDE1234F.';
  end if;
  if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then
    raise exception 'A PIN code has 6 digits, like 302022.';
  end if;
  if v_udyam is not null and v_udyam !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then
    raise exception 'A Udyam number looks like UDYAM-RJ-17-0012345.';
  end if;
  if v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'An IFSC has 11 letters and numbers, like SBIN0001234 (the fifth is a zero).';
  end if;
  if v_acct is not null and v_acct !~ '^[0-9]{9,18}$' then
    raise exception 'A bank account number has 9 to 18 digits.';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'That email doesn''t look right. It looks like name@factory.com.';
  end if;
  if p ? 'pay_days' then
    v := nullif(btrim(p ->> 'pay_days'), '');
    if v is not null and v !~ '^[0-9]{1,3}$' then
      raise exception 'Payment terms are a number of days, like 60.';
    end if;
    v_days := v::smallint;
    if v_mine then
      v_days := f.pay_days;  -- terms are agreed with Sourcingo, not set by the factory
    end if;
  else
    v_days := f.pay_days;
  end if;
  v_bank_moved := v_mine and (f.bank_account is not null or f.bank_ifsc is not null)
                  and (v_acct, v_ifsc) is distinct from (f.bank_account, f.bank_ifsc);
  update public.factories set
    legal_name = case when p ? 'legal_name' then nullif(btrim(p ->> 'legal_name'), '') else legal_name end,
    gstin = v_gstin, pan = v_pan, state = v_state, pin = v_pin, udyam_no = v_udyam, email = v_email,
    no_gst_reason = case when v_gstin is not null then null
                         when p ? 'no_gst_reason' then nullif(btrim(p ->> 'no_gst_reason'), '') else no_gst_reason end,
    address = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else address end,
    city = case when p ? 'city' then nullif(btrim(p ->> 'city'), '') else city end,
    contact_name = case when p ? 'contact_name' then nullif(btrim(p ->> 'contact_name'), '') else contact_name end,
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else phone end,
    whatsapp = case when p ? 'whatsapp' then nullif(btrim(p ->> 'whatsapp'), '') else whatsapp end,
    bank_holder = case when p ? 'bank_holder' then nullif(btrim(p ->> 'bank_holder'), '') else bank_holder end,
    bank_name = case when p ? 'bank_name' then nullif(btrim(p ->> 'bank_name'), '') else bank_name end,
    bank_account = v_acct, bank_ifsc = v_ifsc, pay_days = v_days,
    bank_changed_at = case when v_bank_moved then now() when not v_mine and (p ? 'bank_account' or p ? 'bank_ifsc') then null else bank_changed_at end,
    details_by = auth.uid(), details_at = now()
  where id = v_factory;
exception
  when check_violation then raise exception 'Some text is too long. Shorten it and save again.';
end $$;
revoke execute on function public.save_factory_details(uuid, jsonb) from public, anon;
grant execute on function public.save_factory_details(uuid, jsonb) to authenticated;

-- The factory's own details, for its panel (or the team's preview of it).
create or replace function public.factory_details_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'factory_id', fa.id, 'name', fa.name, 'legal_name', fa.legal_name, 'gstin', coalesce(fa.gstin, fp.gstin), 'no_gst_reason', fa.no_gst_reason,
    'pan', fa.pan, 'udyam_no', fa.udyam_no, 'address', coalesce(fa.address, fp.address), 'city', fa.city, 'state', fa.state, 'pin', fa.pin,
    'contact_name', fa.contact_name, 'phone', fa.phone, 'whatsapp', fa.whatsapp, 'email', fa.email,
    'bank_holder', fa.bank_holder, 'bank_account', fa.bank_account, 'bank_ifsc', fa.bank_ifsc, 'bank_name', fa.bank_name,
    'pay_days', coalesce(fa.pay_days, st.days),
    'missing', (select to_jsonb(g.missing) from public.factory_gaps(fa.id) g), 'total', (select g.total from public.factory_gaps(fa.id) g))
  from public.factories fa
  left join public.factory_profiles fp on fp.factory_id = fa.id
  left join public.supplier_terms st on st.company_id = fa.company_id and st.ledger = fa.tally_ledger
  where fa.id = public.viewing_factory() and fa.company_id = public.current_company()
$$;
revoke execute on function public.factory_details_mine() from public, anon;
grant execute on function public.factory_details_mine() to authenticated;

-- ================================================================ papers
-- A paper of one kind: saving a new one puts the old one of that kind away. The team's go in checked; the factory's
-- wait for the team's check, like its certificates.
create or replace function public.save_factory_document(p_factory uuid, p_kind text, p_no text, p_until date, p_path text, p_file_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_mine uuid := public.my_factory();
  v_team boolean := public.can_vouch_factory(public.current_company()) or public.can_edit_orders(public.current_company());
  v_factory uuid := coalesce(p_factory, public.my_factory());
  v_label text;
  v_id uuid;
begin
  if v_factory is null or not ((v_team and v_mine is null) or coalesce(v_mine = v_factory, false)) then
    raise exception 'Only the factory itself or the team can add its papers.';
  end if;
  if not exists (select 1 from public.factories where id = v_factory and company_id = v_company) then
    raise exception 'That factory is not in your company.';
  end if;
  v_label := case p_kind when 'gst' then 'GST certificate' when 'pan' then 'PAN card' when 'cheque' then 'Cancelled cheque'
                         when 'agreement' then 'Signed vendor agreement' when 'udyam' then 'Udyam (MSME) certificate'
                         when 'licence' then 'Factory licence' end;
  if v_label is null then
    raise exception 'Pick which paper this is.';
  end if;
  if p_path is null or p_path not like v_company::text || '/factory-files/' || v_factory::text || '/certs/%' then
    raise exception 'Add a photo or PDF of the paper.';
  end if;
  if length(p_no) > 60 then
    raise exception 'Keep the number under 60 characters.';
  end if;
  update public.factory_certificates set removed_at = now(), removed_by = auth.uid()
  where factory_id = v_factory and kind = p_kind and removed_at is null;
  insert into public.factory_certificates (company_id, factory_id, kind, name, cert_no, valid_until, path, file_name, status, status_by, status_at, from_factory)
  values (v_company, v_factory, p_kind, v_label, nullif(btrim(coalesce(p_no, '')), ''), p_until, p_path, nullif(btrim(coalesce(p_file_name, '')), ''),
          case when v_mine is null then 'checked' else 'pending' end,
          case when v_mine is null then auth.uid() end, case when v_mine is null then now() end, v_mine is not null)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_factory_document(uuid, text, text, date, text, text) from public, anon;
grant execute on function public.save_factory_document(uuid, text, text, date, text, text) to authenticated;

-- Its certificates and papers, now with their kind, so the panel shows each in its place.
create or replace function public.factory_certificates_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'cert_no', cert_no, 'valid_until', valid_until,
                                               'path', path, 'file_name', file_name, 'status', status, 'status_note', status_note)
                            order by name, created_at), '[]'::jsonb)
  from public.factory_certificates
  where factory_id = public.viewing_factory() and company_id = public.current_company() and removed_at is null
$$;

-- ================================================================ no PO until the factory is ready
create or replace function public.po_send_blocker(p_order uuid, p_factory uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text;
begin
  select string_agg(style, ', ' order by position) into v_missing from public.order_lines
  where order_id = p_order and factory_id = p_factory and removed_at is null and photo_path is null;
  if v_missing is not null then
    return 'Add the style photo first: ' || v_missing || '. The factory works from the picture.';
  end if;
  if not exists (select 1 from public.factories where id = p_factory and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    return 'Add the factory''s email in PO details first, so the PO can be emailed once it is approved.';
  end if;
  return public.factory_kyc_blocker(p_factory);
end $$;

-- The owner's approval: the same as 0063, but a factory that isn't ready can't be approved either (a PO sent for
-- approval before 0135 would otherwise be released without its email).
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
  f public.factory_pos;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not public.is_owner(v_company) then
    raise exception 'Only the owner approves and releases a factory PO. Send the PO for approval.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory for update;
  if f.released_at is not null then
    return;
  end if;
  v_block := coalesce(public.release_blocker(p_order, p_factory), public.factory_kyc_blocker(p_factory));
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  update public.factory_pos set released_at = now(), released_by = auth.uid(), lock_note = null, lock_note_at = null
  where id = f.id and released_at is null;
  -- The plan as released is the baseline that later lateness is measured from.
  update public.line_stages s set baseline_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and s.baseline_on is null and s.planned_on is not null and not s.not_needed;
  -- Approved means sent: the PO email goes out with the next run of the email task.
  if public.po_send_blocker(p_order, p_factory) is null then
    update public.factory_pos fp set mail_to = lower(btrim(fa.email)),
      mail_cc = (select lower(p.email) from public.profiles p where p.id = f.lock_requested_by and p.id is distinct from auth.uid()),
      mail_requested_at = now(), mail_requested_by = auth.uid(), reply_at = null, reply_text = null, updated_at = now()
    from public.factories fa
    where fp.id = f.id and fa.id = p_factory;
  end if;
end $$;
