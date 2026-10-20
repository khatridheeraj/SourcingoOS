-- Style details (0049), brought back from the first version of the app (Dheeraj, 20 Oct 2026).
-- Each style keeps its fabric, its quantity by size, and its files: tech pack or spec sheet, cutting program, and
-- any other reference. The order keeps the buyer's terms (inspection window, penalty clauses). Files sit in the
-- order-photos bucket under <company>/<order>/files/<line>/<file>. The team and Quality read them; a factory reads
-- the files of its own styles. Files are taken off, never deleted.

alter table public.order_lines
  add column fabric text check (length(fabric) <= 160),
  -- Pieces per size, e.g. {"S": 120, "M": 240}. When given, the sizes add up to the style's quantity.
  add column sizes jsonb check (sizes is null or jsonb_typeof(sizes) = 'object');
alter table public.orders add column buyer_terms text check (length(buyer_terms) <= 2000);
-- Order lines are read column by column (rates stay hidden, 0024); fabric and sizes change only through save_style_details.
grant select (fabric, sizes) on public.order_lines to authenticated;
grant update (buyer_terms) on public.orders to authenticated;

create table public.line_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  kind text not null check (kind in ('tech_pack', 'cutting', 'other')),
  path text not null unique,
  file_name text check (length(file_name) <= 200),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index line_files_line_idx on public.line_files (line_id, created_at);
alter table public.line_files enable row level security;
revoke all on public.line_files from public, anon, authenticated;
grant select on public.line_files to authenticated;
create policy line_files_read on public.line_files for select to authenticated using (public.is_member(company_id));

-- Saves a style's fabric and sizes. Sizes are whole pieces, at most 12 of them, and add up to the style's quantity.
create function public.save_style_details(p_line uuid, p_fabric text, p_sizes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_sizes jsonb := case when p_sizes is null or p_sizes = '{}'::jsonb or jsonb_typeof(p_sizes) = 'null' then null else p_sizes end;
  v_sum bigint;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or v_line.company_id is distinct from public.current_company() or not public.can_edit_orders(v_line.company_id) then
    raise exception 'Only the orders team can change a style.';
  end if;
  if length(p_fabric) > 160 then
    raise exception 'Keep the fabric under 160 letters.';
  end if;
  if v_sizes is not null then
    if jsonb_typeof(v_sizes) <> 'object' then
      raise exception 'Enter the sizes again.';
    end if;
    if (select count(*) from jsonb_object_keys(v_sizes)) > 12 then
      raise exception 'Use at most 12 sizes.';
    end if;
    if exists (select 1 from jsonb_each(v_sizes) e
               where length(btrim(e.key)) not between 1 and 12 or jsonb_typeof(e.value) <> 'number'
                  or (e.value #>> '{}')::numeric <> floor((e.value #>> '{}')::numeric) or (e.value #>> '{}')::numeric < 0) then
      raise exception 'Every size needs a short name and a whole number of pieces.';
    end if;
    select sum((e.value #>> '{}')::bigint) into v_sum from jsonb_each(v_sizes) e;
    if v_sum <> v_line.qty then
      raise exception 'The sizes add up to % pcs, but the style is % pcs. Fix the sizes, or change the quantity in Order details.', v_sum, v_line.qty;
    end if;
    -- Sizes with no pieces are left out.
    select jsonb_object_agg(btrim(e.key), e.value) into v_sizes from jsonb_each(v_sizes) e where (e.value #>> '{}')::numeric > 0;
  end if;
  update public.order_lines set fabric = nullif(btrim(p_fabric), ''), sizes = v_sizes where id = p_line;
end $$;
revoke execute on function public.save_style_details(uuid, text, jsonb) from public, anon;
grant execute on function public.save_style_details(uuid, text, jsonb) to authenticated;

-- Adds uploaded files to a style.
create function public.add_line_files(p_line uuid, p_kind text, p_files jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
begin
  select * into v_line from public.order_lines where id = p_line and removed_at is null;
  if v_line.id is null or v_line.company_id is distinct from public.current_company() or not public.can_edit_orders(v_line.company_id) then
    raise exception 'Only the orders team can add files to a style.';
  end if;
  if p_kind is null or p_kind not in ('tech_pack', 'cutting', 'other') then
    raise exception 'Pick what kind of file this is.';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'Pick a file to add.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) f
             where (f ->> 'path') not like v_line.company_id || '/' || v_line.order_id || '/files/' || p_line || '/%' or (f ->> 'path') like '%..%') then
    raise exception 'Those files didn''t upload properly. Try again.';
  end if;
  if (select count(*) from public.line_files where line_id = p_line and removed_at is null) + jsonb_array_length(p_files) > 30 then
    raise exception 'A style can keep up to 30 files. Take off old ones first.';
  end if;
  insert into public.line_files (company_id, order_id, line_id, kind, path, file_name)
  select v_line.company_id, v_line.order_id, p_line, p_kind, f ->> 'path', left(nullif(btrim(f ->> 'file_name'), ''), 200)
  from jsonb_array_elements(p_files) f;
end $$;
revoke execute on function public.add_line_files(uuid, text, jsonb) from public, anon;
grant execute on function public.add_line_files(uuid, text, jsonb) to authenticated;

-- Takes a file off a style. It stays in the activity log and in storage.
create function public.remove_line_file(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.line_files where id = p_id and removed_at is null;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can take a file off a style.';
  end if;
  update public.line_files set removed_at = now(), removed_by = auth.uid() where id = p_id and removed_at is null;
end $$;
revoke execute on function public.remove_line_file(uuid) from public, anon;
grant execute on function public.remove_line_file(uuid) to authenticated;

-- A factory's own styles' tech packs and cutting programs (not the team's other references), for its panel.
create function public.factory_line_files() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'line_id', f.line_id, 'order_id', f.order_id, 'kind', f.kind,
                                               'path', f.path, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
  from public.line_files f
  join public.order_lines l on l.id = f.line_id and l.removed_at is null
  join public.orders o on o.id = f.order_id and o.status = 'open'
  where f.removed_at is null and f.kind in ('tech_pack', 'cutting')
    and f.company_id = public.current_company() and l.factory_id = public.my_factory()
$$;
revoke execute on function public.factory_line_files() from public, anon;
grant execute on function public.factory_line_files() to authenticated;

-- A factory's own styles' fabric and pieces per size, for its panel (the rest of order_lines stays closed to it).
create function public.factory_line_details() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'fabric', l.fabric, 'sizes', l.sizes)), '[]'::jsonb)
  from public.order_lines l
  join public.orders o on o.id = l.order_id and o.status = 'open'
  where l.removed_at is null and (l.fabric is not null or l.sizes is not null)
    and l.company_id = public.current_company() and l.factory_id = public.my_factory()
$$;
revoke execute on function public.factory_line_details() from public, anon;
grant execute on function public.factory_line_details() to authenticated;

-- The factory reads the tech pack and cutting program of its own live styles, besides its own step photos.
create or replace function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if public.my_factory() is null then
    return false;
  end if;
  if v_parts[3] = 'files' then
    return exists (select 1 from public.line_files f join public.order_lines l on l.id = f.line_id and l.removed_at is null
                   where f.path = p_name and f.removed_at is null and f.kind in ('tech_pack', 'cutting')
                     and f.company_id = public.current_company() and l.factory_id = public.my_factory());
  end if;
  if v_parts[3] <> 'factory' then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;
