-- The factory reports its daily piece counts in its panel (step 7 of the buyer and factory sides): for each garment
-- style on a released PO, how many pieces are cut, stitched and packed so far. One count a day per style; a second
-- one the same day replaces it. The team sees the latest count on the order's Styles tab.

create table public.factory_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  factory_id uuid not null,
  counted_on date not null default public.india_today(),
  -- Pieces done so far on the whole style, not just today.
  cut integer not null check (cut >= 0),
  stitched integer not null check (stitched >= 0),
  packed integer not null check (packed >= 0),
  note text check (length(note) <= 300),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (line_id, counted_on),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index factory_counts_order_idx on public.factory_counts (order_id, counted_on desc);
alter table public.factory_counts enable row level security;
revoke all on public.factory_counts from anon, authenticated;
-- The team reads them; the factory writes and reads its own only through the functions below.
grant select on public.factory_counts to authenticated;
create policy factory_counts_read on public.factory_counts for select to authenticated using (public.is_member(company_id));

-- Today's count for one style, from the factory's own login. Packed can't pass stitched, nor stitched pass cut, and no
-- number may be more than double the style's quantity (a slip of the finger).
create function public.post_factory_count(p_line uuid, p_cut integer, p_stitched integer, p_packed integer, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or public.my_factory() is null or not public.factory_owns_line(v_line.company_id, v_line.order_id, p_line) then
    raise exception 'You can count only your own styles on a released PO.';
  end if;
  if v_line.product = 'fabric' then
    raise exception 'Piece counts are for garments. Mark fabric steps done instead.';
  end if;
  if p_cut is null or p_stitched is null or p_packed is null or least(p_cut, p_stitched, p_packed) < 0 then
    raise exception 'Fill cut, stitched and packed (0 if none yet).';
  end if;
  if greatest(p_cut, p_stitched, p_packed) > v_line.qty * 2 then
    raise exception 'That is more than double the % pieces ordered. Check the numbers.', v_line.qty;
  end if;
  if p_stitched > p_cut then
    raise exception 'Stitched can''t be more than cut.';
  end if;
  if p_packed > p_stitched then
    raise exception 'Packed can''t be more than stitched.';
  end if;
  if length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters.';
  end if;
  insert into public.factory_counts (company_id, order_id, line_id, factory_id, cut, stitched, packed, note)
  values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_cut, p_stitched, p_packed, v_note)
  on conflict (line_id, counted_on) do update
    set cut = excluded.cut, stitched = excluded.stitched, packed = excluded.packed, note = excluded.note,
        created_by = excluded.created_by, created_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.post_factory_count(uuid, integer, integer, integer, text) from public, anon;
grant execute on function public.post_factory_count(uuid, integer, integer, integer, text) to authenticated;

-- The latest count of each style of the factory whose panel this is (its own login, or a team member's preview).
create function public.factory_counts_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', c.line_id, 'counted_on', c.counted_on, 'cut', c.cut,
                                               'stitched', c.stitched, 'packed', c.packed, 'note', c.note)), '[]'::jsonb)
  from (select distinct on (c.line_id) c.* from public.factory_counts c
        join public.order_lines l on l.id = c.line_id and l.removed_at is null
        join public.orders o on o.id = c.order_id and o.status = 'open'
        where c.company_id = public.current_company() and l.factory_id = public.viewing_factory()
        order by c.line_id, c.counted_on desc) c
$$;
revoke execute on function public.factory_counts_mine() from public, anon;
grant execute on function public.factory_counts_mine() to authenticated;
