-- The factory says its goods are ready (step 9 of the buyer and factory sides): from which day, how many pieces of each
-- style, in how many cartons, with photos of the packed goods. The order's merchandiser (the owner's when no one owns
-- the order) sees it on Home and on the order, plans Final QC and pickup, and marks it seen with a word back
-- ("Final QC on 14 Nov"). The factory sees that Sourcingo saw it. Photos are the proof: at least one is needed.

create table public.factory_ready (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  factory_id uuid not null,
  ready_on date not null,
  -- [{line_id, pieces}] for the factory's styles that are ready.
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 200),
  cartons integer not null check (cartons between 1 and 10000),
  note text check (length(note) <= 500),
  photos text[] not null check (cardinality(photos) between 1 and 10),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- The team saw it and planned what comes next.
  seen_at timestamptz,
  seen_by uuid references public.profiles (id),
  seen_note text check (length(seen_note) <= 300),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
-- One notice waiting per factory PO; sending again before the team sees it replaces it.
create unique index factory_ready_open_idx on public.factory_ready (order_id, factory_id) where seen_at is null;
create index factory_ready_order_idx on public.factory_ready (order_id, created_at desc);
alter table public.factory_ready enable row level security;
revoke all on public.factory_ready from anon, authenticated;
grant select on public.factory_ready to authenticated;
create policy factory_ready_read on public.factory_ready for select to authenticated using (public.is_member(company_id));

-- The factory, from its own login, on a released PO of its own.
create function public.factory_goods_ready(p_order uuid, p_ready_on date, p_lines jsonb, p_cartons integer, p_note text, p_photos text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_factory uuid := public.my_factory();
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_bad text;
  v_id uuid;
begin
  if v_factory is null or not exists (
      select 1 from public.factory_pos f join public.orders o on o.id = f.order_id and o.status = 'open' and o.removed_at is null
      where f.order_id = p_order and f.factory_id = v_factory and f.released_at is not null and o.company_id = v_company) then
    raise exception 'You can send this only for your own released PO.';
  end if;
  if p_ready_on is null or p_ready_on < public.india_today() - 7 or p_ready_on > public.india_today() + 30 then
    raise exception 'Pick the day the goods are ready: within a week back or a month ahead.';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Fill the pieces ready for at least one style.';
  end if;
  -- Every entry is one of this factory's styles on this PO, once, with whole pieces and not more than double the order.
  select coalesce(l.style, 'A style') into v_bad
  from jsonb_array_elements(v_lines) x
  left join public.order_lines l on l.id = (x ->> 'line_id')::uuid and l.order_id = p_order and l.factory_id = v_factory and l.removed_at is null
  where case when l.id is null or jsonb_typeof(x -> 'pieces') is distinct from 'number' then true
             else (x ->> 'pieces')::numeric <> floor((x ->> 'pieces')::numeric)
                  or (x ->> 'pieces')::numeric < 1 or (x ->> 'pieces')::numeric > l.qty * 2 end
  limit 1;
  if found then
    raise exception '%: fill whole pieces, at least 1 and not more than double the order.', v_bad;
  end if;
  if (select count(distinct x ->> 'line_id') from jsonb_array_elements(v_lines) x) <> jsonb_array_length(v_lines) then
    raise exception 'Each style only once.';
  end if;
  if p_cartons is null or p_cartons < 1 or p_cartons > 10000 then
    raise exception 'Fill the number of cartons.';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters.';
  end if;
  if coalesce(cardinality(p_photos), 0) = 0 then
    raise exception 'Add at least one photo of the packed goods.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Send at most 10 photos.';
  end if;
  if exists (select 1 from unnest(p_photos) p
             where p like '%..%' or not exists (select 1 from jsonb_array_elements(v_lines) x
                                                where p like v_company || '/' || p_order || '/factory/' || (x ->> 'line_id') || '/%')) then
    raise exception 'Those photos are not from this PO.';
  end if;
  update public.factory_ready set ready_on = p_ready_on, lines = v_lines, cartons = p_cartons, note = v_note, photos = p_photos,
         created_by = auth.uid(), created_at = now()
  where order_id = p_order and factory_id = v_factory and seen_at is null
  returning id into v_id;
  if v_id is null then
    insert into public.factory_ready (company_id, order_id, factory_id, ready_on, lines, cartons, note, photos)
    values (v_company, p_order, v_factory, p_ready_on,
            (select jsonb_agg(jsonb_build_object('line_id', x ->> 'line_id', 'pieces', (x ->> 'pieces')::integer)) from jsonb_array_elements(v_lines) x),
            p_cartons, v_note, p_photos)
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.factory_goods_ready(uuid, date, jsonb, integer, text, text[]) from public, anon;
grant execute on function public.factory_goods_ready(uuid, date, jsonb, integer, text, text[]) to authenticated;

-- The orders team saw it, with a word back for the factory if it wants ("Final QC on 14 Nov").
create function public.factory_ready_seen(p_id uuid, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.factory_ready;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.factory_ready where id = p_id and company_id = public.current_company() for update;
  if r.id is null or not public.can_edit_orders(r.company_id) then
    raise exception 'Only the orders team can do that.';
  end if;
  if r.seen_at is not null then
    raise exception 'Someone already marked this seen. Reload the page.';
  end if;
  if length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters.';
  end if;
  update public.factory_ready set seen_at = now(), seen_by = auth.uid(), seen_note = v_note where id = p_id;
  return true;
end $$;
revoke execute on function public.factory_ready_seen(uuid, text) from public, anon;
grant execute on function public.factory_ready_seen(uuid, text) to authenticated;

-- The goods-ready notices of the factory whose panel this is (its own login, or a team member's preview), last 60
-- days, on open orders. Who saw it stays inside: the factory sees "Sourcingo".
create function public.factory_ready_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'order_id', r.order_id, 'ready_on', r.ready_on, 'lines', r.lines,
                                               'cartons', r.cartons, 'note', r.note, 'photos', cardinality(r.photos), 'at', r.created_at,
                                               'seen_at', r.seen_at, 'seen_note', r.seen_note)
                            order by r.created_at desc), '[]'::jsonb)
  from public.factory_ready r
  join public.orders o on o.id = r.order_id and o.status = 'open' and o.removed_at is null
  where r.company_id = public.current_company() and r.factory_id = public.viewing_factory()
    and r.created_at > now() - interval '60 days'
$$;
revoke execute on function public.factory_ready_mine() from public, anon;
grant execute on function public.factory_ready_mine() to authenticated;
