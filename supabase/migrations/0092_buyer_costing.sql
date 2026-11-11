-- A buyer asks for the costing of an exact product from its own page, once its sample is in the Sourcingo office
-- (Dheeraj, 11 Nov 2026). The ask is an inquiry like any other, so follow-ups, Lost and "make the order" all work as
-- before; this adds what is new:
--   * asked_on_page: the buyer asked on its page (product, details, pieces, a target price, photos).
--   * sample_in_on: the day the buyer's sample reached the office. Until then the costing waits for it.
--   * costing_draft: the merchandiser's working costing (fabric in metres, trims, stitching, other, margin), kept
--     between visits. It never reaches the buyer.
--   * inquiry_costings: each quote sent, kept for good. The buyer sees only the price a piece, how long it holds and
--     the note, never the costs or the margin.
--   * buyer_answer: the buyer accepts the latest quote or asks to revise it, with a reason. answer_seen_at is set
--     once the team acts on it (makes the order, sends a revised quote, or taps Done).
-- Nothing here is deleted.

alter table public.inquiries
  add column asked_on_page boolean not null default false,
  add column sample_in_on date,
  add column sample_in_note text check (length(sample_in_note) <= 300),
  add column costing_draft jsonb check (costing_draft is null or jsonb_typeof(costing_draft) = 'object'),
  add column buyer_answer text check (buyer_answer in ('accepted', 'changes')),
  add column buyer_answer_note text check (length(buyer_answer_note) <= 1000),
  add column buyer_answer_at timestamptz,
  add column answer_seen_at timestamptz;
create index inquiries_page_idx on public.inquiries (company_id, buyer_id) where asked_on_page;

create table public.inquiry_costings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  inquiry_id uuid not null references public.inquiries (id),
  -- The breakdown as sent: {fabrics:[{name,metres,rate}], costs:[{name,amount}], margin}. Team only.
  sheet jsonb not null check (jsonb_typeof(sheet) = 'object'),
  cost numeric(12, 2) not null check (cost >= 0),
  price numeric(12, 2) not null check (price > 0),
  qty integer check (qty > 0),
  valid_till date,
  note text check (length(note) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index inquiry_costings_inquiry_idx on public.inquiry_costings (inquiry_id, created_at desc);
alter table public.inquiry_costings enable row level security;
revoke all on public.inquiry_costings from anon, authenticated;
grant select on public.inquiry_costings to authenticated;
create policy inquiry_costings_read on public.inquiry_costings for select to authenticated using (public.can_edit_orders(company_id));

-- The inquiry is the buyer's own ask from its page (for its photos, and for answering a quote).
create function public.buyer_owns_inquiry(p_company uuid, p_inquiry uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.viewing_buyer() is not null and exists (
    select 1 from public.inquiries i where i.id = p_inquiry and i.company_id = p_company and i.company_id = public.current_company()
      and i.buyer_id = public.viewing_buyer() and i.asked_on_page)
$$;
revoke execute on function public.buyer_owns_inquiry(uuid, uuid) from public, anon;
grant execute on function public.buyer_owns_inquiry(uuid, uuid) to authenticated;

-- A buyer login may put photos in a folder for an ask it is about to send (no inquiry has that id yet) or in its own.
create function public.buyer_may_upload_inquiry(p_company uuid, p_inquiry uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_buyer() is not null and p_company = public.current_company()
     and (not exists (select 1 from public.inquiries i where i.id = p_inquiry)
          or exists (select 1 from public.inquiries i where i.id = p_inquiry and i.company_id = p_company
                       and i.buyer_id = public.my_buyer() and i.asked_on_page and i.status in ('new', 'quoted')))
$$;
revoke execute on function public.buyer_may_upload_inquiry(uuid, uuid) from public, anon;
grant execute on function public.buyer_may_upload_inquiry(uuid, uuid) to authenticated;

-- As 0080, plus: a buyer uploads photos for its own costing ask, under <company>/inquiries/<inquiry>/<file>.
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[2] = 'help' then
    return array_length(v_parts, 1) = 4 and v_parts[3] = auth.uid()::text and public.my_role(v_company) is not null;
  end if;
  if v_parts[2] = 'inquiries' then
    return public.can_edit_orders(v_company)
        or (array_length(v_parts, 1) = 4 and public.buyer_may_upload_inquiry(v_company, v_parts[3]::uuid));
  end if;
  if v_parts[3] = 'qc' then
    return public.is_quality(v_company);
  end if;
  if v_parts[3] = 'visits' then
    return array_length(v_parts, 1) = 5 and (public.is_quality(v_company) or public.can_edit_orders(v_company));
  end if;
  if v_parts[3] = 'factory' then
    return array_length(v_parts, 1) = 5 and public.factory_owns_line(v_company, v_parts[2]::uuid, v_parts[4]::uuid);
  end if;
  if v_parts[3] = 'samples' then
    return array_length(v_parts, 1) = 5 and (public.can_edit_orders(v_company) or public.buyer_owns_order(v_company, v_parts[2]::uuid));
  end if;
  if v_parts[3] = 'notes' then
    return array_length(v_parts, 1) = 5 and public.is_member(v_company);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;

-- As 0047, plus: the buyer reads the photos of its own costing asks.
create or replace function public.can_read_order_file(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if v_parts[2] = 'help' then
    return public.my_role(v_parts[1]::uuid) is not null and (v_parts[3] = auth.uid()::text or public.is_owner(v_parts[1]::uuid));
  end if;
  if v_parts[2] = 'inquiries' then
    return public.can_edit_orders(v_parts[1]::uuid) or public.buyer_owns_inquiry(v_parts[1]::uuid, v_parts[3]::uuid);
  end if;
  if not public.is_member(v_parts[1]::uuid) then
    return false;
  end if;
  return v_parts[3] is distinct from 'dispatch' or public.can_edit_orders(v_parts[1]::uuid);
exception when invalid_text_representation then
  return false;
end $$;

-- The buyer asks for a costing: the product, its details, pieces, a target price and photos (already uploaded to
-- <company>/inquiries/<id>/). It becomes inquiry ENQ-xxxx for the merchandiser of the buyer's latest order.
create function public.buyer_ask_costing(p_id uuid, p_product text, p_details text, p_qty integer, p_target numeric, p_photos text[])
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer uuid := public.my_buyer();
  v_product text := btrim(coalesce(p_product, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_photos text[] := coalesce(p_photos, '{}');
  v_merch uuid;
  v_name text;
  v_no text;
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  if v_product = '' then
    raise exception 'Say what the product is, like "Cotton co-ord set".';
  end if;
  if length(v_product) > 200 then
    raise exception 'Keep the product name under 200 characters.';
  end if;
  if length(v_details) > 4000 then
    raise exception 'Keep the details under 4,000 characters.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000000 then
    raise exception 'Enter how many pieces you need.';
  end if;
  if p_target is not null and (p_target <= 0 or p_target > 1000000) then
    raise exception 'Enter the target price a piece in rupees, or leave it empty.';
  end if;
  if cardinality(v_photos) > 12 then
    raise exception 'Send at most 12 photos.';
  end if;
  if exists (select 1 from unnest(v_photos) p where p not like v_company::text || '/inquiries/' || p_id::text || '/%' or p like '%..%') then
    raise exception 'Those photos didn''t upload properly. Try again.';
  end if;
  if exists (select 1 from public.inquiries where id = p_id) then
    raise exception 'This was already sent. Reload the page.';
  end if;
  if (select count(*) from public.inquiries where buyer_id = v_buyer and asked_on_page and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is a lot of costings for one day. Message your Sourcingo merchandiser.';
  end if;
  select o.merchandiser_id into v_merch from public.orders o
  where o.company_id = v_company and o.buyer_id = v_buyer and o.removed_at is null and o.merchandiser_id is not null
  order by o.created_at desc limit 1;
  select n.real_name into v_name from public.buyer_names n where n.buyer_id = v_buyer;
  insert into public.inquiries (id, company_id, buyer_id, contact_name, source, product, est_qty, unit, target_price,
                                merchandiser_id, notes, photos, asked_on_page, created_by)
  values (p_id, v_company, v_buyer, left(v_name, 120), 'other', v_product, p_qty, 'pcs', p_target,
          v_merch, v_details, v_photos, true, auth.uid())
  returning inquiry_no into v_no;
  return v_no;
end $$;
revoke execute on function public.buyer_ask_costing(uuid, text, text, integer, numeric, text[]) from public, anon;
grant execute on function public.buyer_ask_costing(uuid, text, text, integer, numeric, text[]) to authenticated;

-- The team sends a quote: the costing as worked out and the price a piece. The inquiry becomes Quoted at that price,
-- the draft is cleared, and any answer the buyer gave to the last quote is dealt with.
create function public.send_costing(p_inquiry uuid, p_sheet jsonb, p_cost numeric, p_price numeric, p_valid_till date, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_i public.inquiries;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team sends a costing.';
  end if;
  select * into v_i from public.inquiries where id = p_inquiry and company_id = v_company for update;
  if v_i.id is null then
    raise exception 'This inquiry is not here any more. Reload the page.';
  end if;
  if v_i.status not in ('new', 'quoted') then
    raise exception '% is closed. Open it again to send a new price.', v_i.inquiry_no;
  end if;
  if v_i.asked_on_page and v_i.sample_in_on is null then
    raise exception 'Mark the sample as arrived first: the costing is for the exact sample.';
  end if;
  if p_price is null or p_price <= 0 or p_price > 1000000 then
    raise exception 'Enter the price a piece to send.';
  end if;
  if p_cost is null or p_cost < 0 or p_cost > 1000000 then
    raise exception 'The costing doesn''t add up. Check the numbers.';
  end if;
  if p_sheet is null or jsonb_typeof(p_sheet) <> 'object' or length(p_sheet::text) > 20000 then
    raise exception 'The costing doesn''t add up. Check the numbers.';
  end if;
  if p_valid_till is not null and p_valid_till < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The quote can''t end in the past. Pick a later day.';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1,000 characters.';
  end if;
  insert into public.inquiry_costings (company_id, inquiry_id, sheet, cost, price, qty, valid_till, note)
  values (v_company, p_inquiry, p_sheet, round(p_cost, 2), round(p_price, 2), v_i.est_qty, p_valid_till, v_note)
  returning id into v_id;
  update public.inquiries set status = 'quoted', quoted_price = round(p_price, 2), costing_draft = null,
    buyer_answer = null, buyer_answer_note = null, buyer_answer_at = null, answer_seen_at = null,
    lost_reason = null
  where id = p_inquiry;
  return v_id;
end $$;
revoke execute on function public.send_costing(uuid, jsonb, numeric, numeric, date, text) from public, anon;
grant execute on function public.send_costing(uuid, jsonb, numeric, numeric, date, text) to authenticated;

-- The buyer accepts the latest quote, or asks to revise it with a reason.
create function public.buyer_answer_costing(p_inquiry uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer uuid := public.my_buyer();
  v_i public.inquiries;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_c public.inquiry_costings;
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  select * into v_i from public.inquiries
  where id = p_inquiry and company_id = v_company and buyer_id = v_buyer and asked_on_page for update;
  if v_i.id is null then
    raise exception 'This costing is not here any more. Reload the page.';
  end if;
  if v_i.status <> 'quoted' then
    raise exception 'There is no open quote on this. Reload the page.';
  end if;
  select * into v_c from public.inquiry_costings where inquiry_id = p_inquiry order by created_at desc limit 1;
  if v_c.id is null then
    raise exception 'There is no quote on this yet. Reload the page.';
  end if;
  if v_c.valid_till is not null and v_c.valid_till < (now() at time zone 'Asia/Kolkata')::date and p_accept then
    raise exception 'This quote ended on %. Ask Sourcingo to revise it.', to_char(v_c.valid_till, 'DD Mon');
  end if;
  if not coalesce(p_accept, false) and v_note is null then
    raise exception 'Say what to change, like a target price or a different fabric.';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1,000 characters.';
  end if;
  update public.inquiries set buyer_answer = case when p_accept then 'accepted' else 'changes' end,
    buyer_answer_note = v_note, buyer_answer_at = now(), answer_seen_at = null
  where id = p_inquiry;
end $$;
revoke execute on function public.buyer_answer_costing(uuid, boolean, text) from public, anon;
grant execute on function public.buyer_answer_costing(uuid, boolean, text) to authenticated;

-- The buyer's costing asks from the last 6 months (open ones always): where each stands, the latest quote as the
-- buyer may see it, its answer, and the order it became. Costs, margin and who on the team did what stay inside.
create function public.buyer_costings_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'no', i.inquiry_no, 'product', i.product, 'details', i.notes, 'qty', i.est_qty, 'target', i.target_price,
      'photos', to_jsonb(i.photos), 'asked_at', i.created_at, 'status', i.status, 'sample_in_on', i.sample_in_on,
      'answer', i.buyer_answer, 'answer_note', i.buyer_answer_note, 'answer_at', i.buyer_answer_at,
      'quote', (select jsonb_build_object('price', c.price, 'qty', c.qty, 'valid_till', c.valid_till, 'note', c.note, 'sent_at', c.created_at,
                                          'round', (select count(*) from public.inquiry_costings c2 where c2.inquiry_id = i.id))
                from public.inquiry_costings c where c.inquiry_id = i.id order by c.created_at desc limit 1),
      'order_po', case when o.removed_at is null then coalesce(nullif(btrim(o.buyer_po), ''), o.order_no) end)
    order by i.created_at desc), '[]'::jsonb)
  from public.inquiries i
  left join public.orders o on o.id = i.order_id
  where i.company_id = public.current_company() and i.buyer_id = public.viewing_buyer() and i.asked_on_page
    and (i.status in ('new', 'quoted') or i.status_at > now() - interval '180 days')
$$;
revoke execute on function public.buyer_costings_mine() from public, anon;
grant execute on function public.buyer_costings_mine() to authenticated;

-- An inquiry that became an order has its buyer's answer dealt with.
create function public.inquiry_answer_seen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('converted', 'lost') and new.buyer_answer is not null and new.answer_seen_at is null then
    new.answer_seen_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.inquiry_answer_seen() from public, anon, authenticated;
create trigger inquiries_answer_seen before update on public.inquiries
  for each row execute function public.inquiry_answer_seen();
