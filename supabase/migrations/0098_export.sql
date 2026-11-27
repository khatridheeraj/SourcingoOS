-- Selling overseas (roadmap step 3, Dheeraj's go on 27 Nov 2026):
--   * Delivered price: a costing sent to a buyer can carry the price delivered to the buyer's door in its currency
--     (price ex-India + freight + insurance + the buyer's import duty estimate). inquiry_costings.landed keeps it as
--     sent; the buyer sees it, clearly an estimate. companies.freight_rates holds the team's rough freight rates.
--   * Export papers: our exporter details (IEC, AD code, LUT, bank, port) once on the company, and each lot of goods
--     keeps its own export details (currency, Incoterm, ports, HS codes, rates) for the commercial invoice, packing
--     list and shipment sheet.
--   * "Made here before" on the public product pages: real counts of what has shipped, and a style's photo only
--     when the owner chose to show it (copied to the public "site-photos" bucket). Never factory or buyer names.
-- Nothing here is deleted.

alter table public.companies
  add column iec text check (iec ~ '^[A-Z0-9]{10}$'),
  add column ad_code text check (ad_code ~ '^[A-Z0-9]{4,20}$'),
  add column lut_no text check (length(lut_no) <= 40),
  add column lut_date date,
  add column export_bank text check (length(export_bank) <= 500),
  add column export_port text check (length(export_port) <= 80),
  -- {region: {sea: ₹ a kg, air: ₹ a kg}}; null means the app's starting rates.
  add column freight_rates jsonb check (freight_rates is null or (jsonb_typeof(freight_rates) = 'object' and length(freight_rates::text) <= 4000));

alter table public.inquiry_costings add column landed jsonb check (landed is null or (jsonb_typeof(landed) = 'object' and length(landed::text) <= 4000));

alter table public.dispatches add column export jsonb check (export is null or (jsonb_typeof(export) = 'object' and length(export::text) <= 20000));

alter table public.order_lines
  add column site_photo text check (length(site_photo) <= 300),
  add column site_caption text check (length(site_caption) <= 80);
grant select (site_photo, site_caption) on public.order_lines to authenticated;

-- Our exporter details, printed on every commercial invoice. Owner only. Blank boxes clear a value.
create function public.save_exporter(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_iec text := nullif(upper(regexp_replace(coalesce(p ->> 'iec', ''), '\s', '', 'g')), '');
  v_ad text := nullif(upper(regexp_replace(coalesce(p ->> 'ad_code', ''), '\s', '', 'g')), '');
  v_lut text := nullif(btrim(coalesce(p ->> 'lut_no', '')), '');
  v_lut_date date;
  v_bank text := nullif(btrim(coalesce(p ->> 'export_bank', '')), '');
  v_port text := nullif(btrim(coalesce(p ->> 'export_port', '')), '');
begin
  if not public.is_owner(v_company) then
    raise exception 'Only the owner changes our exporter details.';
  end if;
  if v_iec is not null and v_iec !~ '^[A-Z0-9]{10}$' then
    raise exception 'The IEC has 10 letters and digits, like ABCDE1234F.';
  end if;
  if v_ad is not null and v_ad !~ '^[A-Z0-9]{4,20}$' then
    raise exception 'The AD code is letters and digits only, like 0510005.';
  end if;
  if length(v_lut) > 40 then raise exception 'Keep the LUT number under 40 characters.'; end if;
  if length(v_bank) > 500 then raise exception 'Keep the bank details under 500 characters.'; end if;
  if length(v_port) > 80 then raise exception 'Keep the port under 80 characters.'; end if;
  begin
    v_lut_date := nullif(p ->> 'lut_date', '')::date;
  exception when others then
    raise exception 'Enter the LUT date as a date.';
  end;
  update public.companies set iec = v_iec, ad_code = v_ad, lut_no = v_lut, lut_date = v_lut_date, export_bank = v_bank, export_port = v_port
  where id = v_company;
end $$;
revoke execute on function public.save_exporter(jsonb) from public, anon;
grant execute on function public.save_exporter(jsonb) to authenticated;

-- The team's freight rates (₹ a kg, door to door, by region), from forwarder quotes. Orders team.
create function public.save_freight_rates(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  r record;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team changes freight rates.';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 4000 then
    raise exception 'The rates don''t add up. Check the numbers.';
  end if;
  for r in select key, value from jsonb_each(p) loop
    if r.key !~ '^[a-z]{2,12}$' or jsonb_typeof(r.value) <> 'object' then
      raise exception 'The rates don''t add up. Check the numbers.';
    end if;
    if coalesce((r.value ->> 'sea')::numeric, 0) not between 0 and 5000 or coalesce((r.value ->> 'air')::numeric, 0) not between 0 and 5000 then
      raise exception 'A freight rate is rupees a kg, between 0 and 5,000.';
    end if;
  end loop;
  update public.companies set freight_rates = p where id = v_company;
end $$;
revoke execute on function public.save_freight_rates(jsonb) from public, anon;
grant execute on function public.save_freight_rates(jsonb) to authenticated;

-- A lot's export details: {currency, fx, incoterm, mode, invoice_no, invoice_date, port_loading, port_discharge,
-- country, final_dest, vessel, notify, terms, marks, cbm, container, etd, forwarder, freight, insurance,
-- lines: {line_id: {hs, rate}}}. Orders team.
create function public.save_export(p_dispatch uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.dispatches where id = p_dispatch and cancelled_at is null;
  if v_company is null then
    raise exception 'This lot is not here any more. Reload the page.';
  end if;
  if not public.can_edit_orders(v_company) or v_company <> public.current_company() then
    raise exception 'Only the orders team makes export papers.';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 20000 then
    raise exception 'The export details don''t add up. Check them.';
  end if;
  if coalesce(p ->> 'currency', 'USD') !~ '^[A-Z]{3}$' then
    raise exception 'Pick the invoice currency.';
  end if;
  update public.dispatches set export = p where id = p_dispatch;
end $$;
revoke execute on function public.save_export(uuid, jsonb) from public, anon;
grant execute on function public.save_export(uuid, jsonb) to authenticated;

-- As send_costing (0092), with the delivered price as the buyer will see it.
create function public.send_costing(p_inquiry uuid, p_sheet jsonb, p_cost numeric, p_price numeric, p_valid_till date, p_note text, p_landed jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_landed is not null and (jsonb_typeof(p_landed) <> 'object' or length(p_landed::text) > 4000) then
    raise exception 'The delivered price doesn''t add up. Check it.';
  end if;
  v_id := public.send_costing(p_inquiry, p_sheet, p_cost, p_price, p_valid_till, p_note);
  update public.inquiry_costings set landed = p_landed where id = v_id;
  return v_id;
end $$;
revoke execute on function public.send_costing(uuid, jsonb, numeric, numeric, date, text, jsonb) from public, anon;
grant execute on function public.send_costing(uuid, jsonb, numeric, numeric, date, text, jsonb) to authenticated;

-- As 0092, plus the delivered price on the latest quote.
create or replace function public.buyer_costings_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'no', i.inquiry_no, 'product', i.product, 'details', i.notes, 'qty', i.est_qty, 'target', i.target_price,
      'photos', to_jsonb(i.photos), 'asked_at', i.created_at, 'status', i.status, 'sample_in_on', i.sample_in_on,
      'answer', i.buyer_answer, 'answer_note', i.buyer_answer_note, 'answer_at', i.buyer_answer_at,
      'quote', (select jsonb_build_object('price', c.price, 'qty', c.qty, 'valid_till', c.valid_till, 'note', c.note, 'sent_at', c.created_at,
                                          'landed', c.landed,
                                          'round', (select count(*) from public.inquiry_costings c2 where c2.inquiry_id = i.id))
                from public.inquiry_costings c where c.inquiry_id = i.id order by c.created_at desc limit 1),
      'order_po', case when o.removed_at is null then coalesce(nullif(btrim(o.buyer_po), ''), o.order_no) end)
    order by i.created_at desc), '[]'::jsonb)
  from public.inquiries i
  left join public.orders o on o.id = i.order_id
  where i.company_id = public.current_company() and i.buyer_id = public.viewing_buyer() and i.asked_on_page
    and (i.status in ('new', 'quoted') or i.status_at > now() - interval '180 days')
$$;

-- The owner shows a style's photo on the public website (p_path in the site-photos bucket), or takes it off (null).
create function public.set_site_photo(p_line uuid, p_path text, p_caption text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  select company_id into v_company from public.order_lines where id = p_line and removed_at is null;
  if v_company is null then
    raise exception 'This style is not here any more. Reload the page.';
  end if;
  if not public.is_owner(v_company) then
    raise exception 'Only the owner chooses what shows on the website.';
  end if;
  if p_path is not null and (p_path not like v_company::text || '/%' or length(p_path) > 300) then
    raise exception 'That photo is not ours. Try again.';
  end if;
  if length(v_caption) > 80 then
    raise exception 'Keep the caption under 80 characters.';
  end if;
  update public.order_lines set site_photo = p_path, site_caption = case when p_path is null then null else v_caption end where id = p_line;
end $$;
revoke execute on function public.set_site_photo(uuid, text, text) from public, anon;
grant execute on function public.set_site_photo(uuid, text, text) to authenticated;

-- What has shipped through Sourcingo for one product page: styles, pieces (or metres), orders, the last month goods
-- went out, and up to 6 photos the owner chose. Garments match any of p_words in the style or its description
-- (an empty list means every garment); fabric pages count fabric styles. Counts only, never names.
create function public.site_made_before(p_words text[], p_fabric boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  with l as (
    select ol.id, ol.order_id, ol.site_photo, ol.site_caption,
           sum(dl.qty) as sent, max(d.shipped_at) as last_at
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.removed_at is null and o.status <> 'cancelled'
    join public.dispatch_lines dl on dl.line_id = ol.id
    join public.dispatches d on d.id = dl.dispatch_id and d.cancelled_at is null and d.shipped_at is not null
    where ol.company_id = public.site_company() and ol.removed_at is null
      and ol.product = case when p_fabric then 'fabric' else 'garment' end
      and (p_fabric or coalesce(array_length(p_words, 1), 0) = 0
           or lower(ol.style || ' ' || coalesce(ol.description, '')) like any (select '%' || lower(w) || '%' from unnest(p_words) w where length(w) between 3 and 30))
    group by ol.id
  )
  select jsonb_build_object(
    'styles', (select count(*) from l),
    'qty', (select coalesce(sum(sent), 0) from l),
    'orders', (select count(distinct order_id) from l),
    'last_at', (select to_char(max(last_at) at time zone 'Asia/Kolkata', 'YYYY-MM') from l),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('path', site_photo, 'caption', site_caption) order by last_at desc), '[]'::jsonb)
               from (select * from l where site_photo is not null order by last_at desc limit 6) x))
$$;
revoke execute on function public.site_made_before(text[], boolean) from public;
grant execute on function public.site_made_before(text[], boolean) to anon, authenticated;

-- The public bucket for photos the owner put on the website. Anyone reads by its public link; only the owner adds.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site-photos', 'site-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "site photos upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'site-photos' and public.is_member_folder((storage.foldername(name))[1])
                  and public.is_owner(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
