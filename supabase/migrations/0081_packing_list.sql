-- Packing list for a lot of goods (Dheeraj, 10 Nov 2026: complete the team panels). Garments go out in cartons; the
-- buyer's warehouse checks each carton against a list of carton numbers, style, colour and pieces per size.
-- Each row is a run of identical cartons: cartons 1 to 10 each hold S 4, M 8, L 8, XL 4 of one style.
-- Saving replaces the list: older rows are kept with removed_at set, never deleted.

create table public.packing_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  dispatch_id uuid not null references public.dispatches (id),
  position integer not null,
  carton_from integer not null check (carton_from >= 1),
  carton_to integer not null check (carton_to >= carton_from and carton_to <= 100000),
  line_id uuid not null references public.order_lines (id),
  -- Pieces of each size in one carton of the run, e.g. {"S": 4, "M": 8}. A style with no sizes uses {"Pieces": n}.
  sizes jsonb not null check (jsonb_typeof(sizes) = 'object'),
  net_kg numeric(8, 2) check (net_kg > 0),
  gross_kg numeric(8, 2) check (gross_kg > 0),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index packing_rows_dispatch_idx on public.packing_rows (dispatch_id) where removed_at is null;

alter table public.packing_rows enable row level security;
revoke all on public.packing_rows from anon, authenticated;
grant select on public.packing_rows to authenticated;
create policy packing_rows_read on public.packing_rows for select to authenticated using (public.can_edit_orders(company_id));

-- Saves a lot's packing list in one go. p_rows: [{carton_from, carton_to, line_id, sizes: {size: pcs}, net_kg, gross_kg}].
-- Every style must be in this lot, carton runs must not overlap, and every carton holds at least one piece.
create or replace function public.save_packing_list(p_dispatch uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.dispatches%rowtype;
  v_row jsonb;
  v_pos integer := 0;
  v_from integer;
  v_to integer;
  v_line uuid;
  v_sizes jsonb;
  v_size record;
  v_pcs integer;
  v_net numeric;
  v_gross numeric;
  v_runs int4range[] := '{}';
  v_last integer := 0;
begin
  select * into v_d from public.dispatches where id = p_dispatch;
  if v_d.id is null or v_d.company_id is distinct from public.current_company() or v_d.cancelled_at is not null then
    raise exception 'That lot is not here any more. Reload the page.';
  end if;
  if not public.can_edit_orders(v_d.company_id) then
    raise exception 'Only the orders team makes packing lists.';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]')) > 500 then
    raise exception 'Keep the packing list under 500 rows.';
  end if;
  update public.packing_rows set removed_at = now() where dispatch_id = p_dispatch and removed_at is null;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_pos := v_pos + 1;
    begin
      v_from := (v_row ->> 'carton_from')::integer;
      v_to := coalesce((v_row ->> 'carton_to')::integer, v_from);
      v_line := (v_row ->> 'line_id')::uuid;
      v_net := nullif(v_row ->> 'net_kg', '')::numeric;
      v_gross := nullif(v_row ->> 'gross_kg', '')::numeric;
    exception when others then
      raise exception 'Row %: carton numbers, style and weights must be numbers.', v_pos;
    end;
    if v_from is null or v_from < 1 or v_to < v_from then
      raise exception 'Row %: cartons run from a number to the same or a bigger number.', v_pos;
    end if;
    if exists (select 1 from unnest(v_runs) r where r && int4range(v_from, v_to, '[]')) then
      raise exception 'Row %: cartons % to % are already on another row.', v_pos, v_from, v_to;
    end if;
    v_runs := v_runs || int4range(v_from, v_to, '[]');
    if not exists (select 1 from public.dispatch_lines where dispatch_id = p_dispatch and line_id = v_line) then
      raise exception 'Row %: that style is not in this lot.', v_pos;
    end if;
    v_sizes := coalesce(v_row -> 'sizes', '{}');
    if jsonb_typeof(v_sizes) <> 'object' then
      raise exception 'Row %: pieces per size are missing.', v_pos;
    end if;
    v_pcs := 0;
    for v_size in select key, value from jsonb_each(v_sizes) loop
      if jsonb_typeof(v_size.value) <> 'number' or (v_size.value)::text::numeric < 0 or (v_size.value)::text::numeric <> trunc((v_size.value)::text::numeric) then
        raise exception 'Row %: pieces of % must be a whole number.', v_pos, v_size.key;
      end if;
      v_pcs := v_pcs + (v_size.value)::text::integer;
    end loop;
    if v_pcs < 1 then
      raise exception 'Row %: a carton holds at least one piece.', v_pos;
    end if;
    if v_net is not null and v_gross is not null and v_gross < v_net then
      raise exception 'Row %: gross weight is the carton with its packing, so it can''t be less than net.', v_pos;
    end if;
    insert into public.packing_rows (company_id, dispatch_id, position, carton_from, carton_to, line_id, sizes, net_kg, gross_kg)
    values (v_d.company_id, p_dispatch, v_pos, v_from, v_to, v_line,
            (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(v_sizes) where (value)::text::integer > 0), v_net, v_gross);
    v_last := greatest(v_last, v_to);
  end loop;
  -- The lot's carton count follows the list when nobody has typed one yet.
  if v_last > 0 and v_d.cartons is null then
    update public.dispatches set cartons = (select sum(carton_to - carton_from + 1) from public.packing_rows where dispatch_id = p_dispatch and removed_at is null)
    where id = p_dispatch;
  end if;
  return v_pos;
end $$;
revoke execute on function public.save_packing_list(uuid, jsonb) from public, anon;
grant execute on function public.save_packing_list(uuid, jsonb) to authenticated;
