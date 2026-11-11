-- Factories shop for orders. The orders team opens a style of a buyer PO to factories: the exact product (photo, fabric,
-- sizes, quantity, tech pack), the date it must be ready by, when quotes close, and a target price if it wants. Every
-- active factory sees open styles in its panel ("Shop orders") like a shop, never the buyer or the buyer's price, and
-- quotes a price and its own ready date. The team compares quotes side by side and awards one: the style takes that
-- factory and price and then runs the usual factory PO, TNA, QC and payment flow, so Sourcingo stays accountable.

create table public.market_listings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  -- Per piece (per metre for a fabric style). Shown to factories as "Target price" when set.
  target_rate numeric check (target_rate > 0 and target_rate < 1000000),
  -- The day goods must be ready at the factory (ex-factory), and the last day to quote.
  ready_by date not null,
  closes_on date not null,
  note text check (length(note) <= 500),
  opened_by uuid not null default auth.uid() references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  awarded_quote uuid,
  foreign key (company_id, order_id) references public.orders (company_id, id),
  check (closes_on <= ready_by)
);
-- A style is open to factories once at a time.
create unique index market_listings_open_idx on public.market_listings (line_id) where closed_at is null;
create index market_listings_company_idx on public.market_listings (company_id, opened_at desc);

create table public.market_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  listing_id uuid not null references public.market_listings (id),
  factory_id uuid not null,
  rate numeric not null check (rate > 0 and rate < 1000000),
  ready_on date not null,
  note text check (length(note) <= 500),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (listing_id, factory_id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
alter table public.market_listings add constraint market_listings_awarded_fk foreign key (awarded_quote) references public.market_quotes (id);

alter table public.market_listings enable row level security;
alter table public.market_quotes enable row level security;
revoke all on public.market_listings, public.market_quotes from anon, authenticated;
grant select on public.market_listings, public.market_quotes to authenticated;
-- The team reads everything; factories read only through market_list() (is_member leaves factory logins out).
create policy market_listings_read on public.market_listings for select to authenticated using (public.is_member(company_id));
-- Quotes are prices: only the orders team and Accounts read them, like line_prices().
create policy market_quotes_read on public.market_quotes for select to authenticated using (public.can_edit_orders(company_id));
-- History triggers attach themselves (0020 history_attach).

-- The orders team opens a style to factories. Ready-by defaults to the factory target: the ship date (revised if moved)
-- less 7 days for a garment, 2 for fabric. A style already on a released factory PO stays where it is.
create function public.market_open(p_line uuid, p_target numeric, p_ready_by date, p_closes_on date, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.order_lines;
  o public.orders;
  v_ready date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select * into l from public.order_lines where id = p_line and company_id = public.current_company() and removed_at is null;
  if l.id is null or not public.can_edit_orders(l.company_id) then
    raise exception 'Only the orders team can open a style to factories.';
  end if;
  select * into o from public.orders where id = l.order_id;
  if o.status <> 'open' or o.removed_at is not null then
    raise exception 'This order is not open.';
  end if;
  if l.factory_id is not null and exists (select 1 from public.factory_pos f where f.order_id = l.order_id and f.factory_id = l.factory_id and f.released_at is not null) then
    raise exception '% is already on a released factory PO.', l.style;
  end if;
  if exists (select 1 from public.market_listings where line_id = p_line and closed_at is null) then
    raise exception '% is already open to factories.', l.style;
  end if;
  v_ready := coalesce(p_ready_by, coalesce(o.revised_ship_date, o.ship_date) - case when l.product = 'fabric' then 2 else 7 end);
  if v_ready is null then
    raise exception 'Give the date goods must be ready by.';
  end if;
  if v_ready < public.india_today() + 1 then
    raise exception 'The ready-by date has to be after today.';
  end if;
  if p_closes_on is null or p_closes_on < public.india_today() or p_closes_on > v_ready then
    raise exception 'Quotes must close between today and the ready-by date.';
  end if;
  if p_target is not null and (p_target <= 0 or p_target >= 1000000) then
    raise exception 'Fill the target price as an amount, or leave it empty.';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters.';
  end if;
  insert into public.market_listings (company_id, order_id, line_id, target_rate, ready_by, closes_on, note)
  values (l.company_id, l.order_id, l.id, p_target, v_ready, p_closes_on, v_note)
  returning id into v_id;
  return v_id;
end $$;

-- The team takes a style back without choosing anyone.
create function public.market_close(p_listing uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m public.market_listings;
begin
  select * into m from public.market_listings where id = p_listing and company_id = public.current_company() for update;
  if m.id is null or not public.can_edit_orders(m.company_id) then
    raise exception 'Only the orders team can do that.';
  end if;
  if m.closed_at is not null then
    raise exception 'This style is already closed. Reload the page.';
  end if;
  update public.market_listings set closed_at = now(), closed_by = auth.uid() where id = p_listing;
  return true;
end $$;

-- The team awards a quote: the style takes that factory and price (the owner-only rule for moving a style off a
-- released PO still holds), and the style closes for everyone else.
create function public.market_award(p_quote uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  q public.market_quotes;
  m public.market_listings;
begin
  select * into q from public.market_quotes where id = p_quote and company_id = public.current_company();
  if q.id is null or not public.can_edit_orders(q.company_id) then
    raise exception 'Only the orders team can award a style.';
  end if;
  select * into m from public.market_listings where id = q.listing_id for update;
  if m.closed_at is not null then
    raise exception 'This style is already closed. Reload the page.';
  end if;
  if q.withdrawn_at is not null then
    raise exception 'The factory took this quote back.';
  end if;
  if not exists (select 1 from public.factories where id = q.factory_id and active) then
    raise exception 'That factory is switched off.';
  end if;
  if not exists (select 1 from public.orders o where o.id = m.order_id and o.status = 'open' and o.removed_at is null) then
    raise exception 'This order is not open.';
  end if;
  update public.order_lines set factory_id = q.factory_id, factory_rate = q.rate where id = m.line_id and removed_at is null;
  if not found then
    raise exception 'This style was removed from the order.';
  end if;
  update public.market_listings set closed_at = now(), closed_by = auth.uid(), awarded_quote = q.id where id = m.id;
  return true;
end $$;

-- A factory quotes (or changes its quote) from its own login, while the style is open and quotes have not closed.
create function public.market_quote(p_listing uuid, p_rate numeric, p_ready_on date, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
  m public.market_listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_factory is null then
    raise exception 'Only a factory login can quote.';
  end if;
  select * into m from public.market_listings where id = p_listing and company_id = public.current_company();
  if m.id is null or m.closed_at is not null or m.closes_on < public.india_today()
     or not exists (select 1 from public.orders o where o.id = m.order_id and o.status = 'open' and o.removed_at is null) then
    raise exception 'Quotes for this style are closed.';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 1000000 then
    raise exception 'Fill your price.';
  end if;
  if p_ready_on is null or p_ready_on < public.india_today() or p_ready_on > m.ready_by + 60 then
    raise exception 'Pick the day your goods will be ready.';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters.';
  end if;
  insert into public.market_quotes (company_id, listing_id, factory_id, rate, ready_on, note)
  values (m.company_id, m.id, v_factory, p_rate, p_ready_on, v_note)
  on conflict (listing_id, factory_id) do update
    set rate = excluded.rate, ready_on = excluded.ready_on, note = excluded.note, updated_at = now(), withdrawn_at = null,
        created_by = auth.uid()
  returning id into v_id;
  return v_id;
end $$;

-- A factory takes its quote back while the style is still open.
create function public.market_withdraw(p_listing uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
begin
  if v_factory is null then
    raise exception 'Only a factory login can do that.';
  end if;
  update public.market_quotes q set withdrawn_at = now(), updated_at = now()
  from public.market_listings m
  where q.listing_id = p_listing and m.id = q.listing_id and m.closed_at is null and q.factory_id = v_factory and q.withdrawn_at is null;
  if not found then
    raise exception 'There is no open quote of yours on this style.';
  end if;
  return true;
end $$;

-- The shop for the factory whose panel this is (its own login, or a team member's preview): every open style, and the
-- styles it quoted on that closed in the last 30 days with the result. Never the buyer, the buyer's price or other
-- factories' prices: only how many quoted.
create function public.market_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  with f as (select public.viewing_factory() as id),
  rows as (
    select m.*, l.style, l.description, l.colour, l.qty, l.fabric, l.sizes, l.photo_path, l.product, o.order_no,
           (select count(*) from public.market_quotes x where x.listing_id = m.id and x.withdrawn_at is null) as quotes,
           mine.id as my_id, mine.rate as my_rate, mine.ready_on as my_ready_on, mine.note as my_note, mine.withdrawn_at as my_withdrawn_at
    from public.market_listings m
    join public.order_lines l on l.id = m.line_id
    join public.orders o on o.id = m.order_id
    cross join f
    left join public.market_quotes mine on mine.listing_id = m.id and mine.factory_id = f.id
    where f.id is not null and m.company_id = public.current_company()
      and ((m.closed_at is null and m.closes_on >= public.india_today() and o.status = 'open' and o.removed_at is null and l.removed_at is null)
           or (m.closed_at > now() - interval '30 days' and mine.id is not null and mine.withdrawn_at is null))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'order_no', r.order_no, 'style', r.style, 'description', r.description, 'colour', r.colour, 'qty', r.qty,
    'fabric', r.fabric, 'sizes', r.sizes, 'photo_path', r.photo_path, 'product', coalesce(r.product, 'garment'),
    'target_rate', r.target_rate, 'ready_by', r.ready_by, 'closes_on', r.closes_on, 'note', r.note, 'opened_at', r.opened_at,
    'quotes', r.quotes,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('path', lf.path, 'kind', lf.kind, 'name', lf.file_name)), '[]'::jsonb)
              from public.line_files lf where lf.line_id = r.line_id and lf.removed_at is null and lf.kind in ('tech_pack', 'cutting')),
    'state', case when r.closed_at is null then 'open' when r.awarded_quote = r.my_id then 'won' else 'closed' end,
    'mine', case when r.my_id is null or r.my_withdrawn_at is not null then null
                 else jsonb_build_object('rate', r.my_rate, 'ready_on', r.my_ready_on, 'note', r.my_note) end)
    order by (r.closed_at is not null), r.closes_on, r.opened_at), '[]'::jsonb)
  from rows r
$$;

-- For the "Shop orders" tab: open styles this factory has not quoted on yet.
create function public.market_open_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.market_listings m
  join public.orders o on o.id = m.order_id and o.status = 'open' and o.removed_at is null
  join public.order_lines l on l.id = m.line_id and l.removed_at is null
  where public.viewing_factory() is not null and m.company_id = public.current_company()
    and m.closed_at is null and m.closes_on >= public.india_today()
    and not exists (select 1 from public.market_quotes q where q.listing_id = m.id and q.factory_id = public.viewing_factory() and q.withdrawn_at is null)
$$;

revoke execute on function public.market_open(uuid, numeric, date, date, text), public.market_close(uuid), public.market_award(uuid),
  public.market_quote(uuid, numeric, date, text), public.market_withdraw(uuid), public.market_list(), public.market_open_count() from public, anon;
grant execute on function public.market_open(uuid, numeric, date, date, text), public.market_close(uuid), public.market_award(uuid),
  public.market_quote(uuid, numeric, date, text), public.market_withdraw(uuid), public.market_list(), public.market_open_count() to authenticated;

-- A factory login may now also open the photo and tech pack of any style open to factories, so it can see exactly
-- what it is quoting on. Everything else is as before (0079).
create or replace function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if public.my_factory() is null then
    return false;
  end if;
  if v_parts[3] in ('styles', 'files') and exists (
      select 1 from public.market_listings m join public.order_lines l on l.id = m.line_id and l.removed_at is null
      where m.closed_at is null and m.company_id = public.current_company() and m.closes_on >= public.india_today()
        and (l.photo_path = p_name
             or exists (select 1 from public.line_files f where f.line_id = l.id and f.path = p_name and f.removed_at is null
                        and f.kind in ('tech_pack', 'cutting')))) then
    return true;
  end if;
  if v_parts[3] = 'files' then
    return exists (select 1 from public.line_files f join public.order_lines l on l.id = f.line_id and l.removed_at is null
                   where f.path = p_name and f.removed_at is null and f.kind in ('tech_pack', 'cutting')
                     and f.company_id = public.current_company() and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] = 'samples' then
    return exists (select 1 from public.sample_rounds r
                   where r.line_id = v_parts[4]::uuid and r.order_id = v_parts[2]::uuid and r.company_id = v_parts[1]::uuid
                     and r.company_id = public.current_company() and r.factory_id = public.my_factory()
                     and (p_name = any (r.answer_photos) or p_name = any (r.photos)));
  end if;
  if v_parts[3] = 'qc' then
    return exists (select 1 from public.qc_photos p
                   join public.qc_checks q on q.id = p.qc_id and q.cancelled_at is null
                   join public.order_lines l on l.id = q.line_id and l.removed_at is null
                   where p.path = p_name and p.removed_at is null and q.company_id = public.current_company()
                     and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] <> 'factory' then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;
