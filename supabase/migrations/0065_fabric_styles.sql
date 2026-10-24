-- Fabric orders don't go through garment making: a style can be marked Fabric, and its TNA then skips the
-- garment-only steps (fit sample, fabric in-house, PP sample, size set, cutting, stitching, inline, mid-line).
-- Greige, printing / dyeing, strike off, finishing, packed, final QC and ex-factory stay. Garment styles still
-- go through every standard step.
alter table public.order_lines add column product text not null default 'garment' check (product in ('garment', 'fabric'));
-- The app reads it like the other style columns; only the functions below change it.
grant select (product) on public.order_lines to authenticated;

create function public.garment_only_stage(p_stage text) returns boolean
language sql immutable set search_path = '' as $$
  select p_stage = any (array['fit_sample', 'fabric', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline', 'midline'])
$$;

-- The old rule (no standard step can be not needed) now holds for garments only.
alter table public.line_stages drop constraint line_stages_mandatory;
create function public.line_stages_mandatory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.not_needed and new.stage not like 'extra\_%'
     and not (public.garment_only_stage(new.stage)
              and exists (select 1 from public.order_lines l where l.id = new.line_id and l.product = 'fabric')) then
    raise exception 'Every garment style goes through all the standard steps.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger line_stages_mandatory before insert or update of not_needed, stage on public.line_stages
  for each row execute function public.line_stages_mandatory();

-- Marks a style Fabric or Garment and drops or brings back the garment-only steps with it. No checks: callers check.
create function public.apply_line_product(p_line uuid, p_product text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.order_lines;
begin
  select * into l from public.order_lines where id = p_line;
  if p_product = 'fabric' then
    update public.order_lines set product = 'fabric' where id = p_line and product <> 'fabric';
    insert into public.line_stages (company_id, order_id, line_id, stage, not_needed)
    select l.company_id, l.order_id, p_line, st, true
    from unnest(array['fit_sample', 'fabric', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline', 'midline']) st
    on conflict (line_id, stage) do update set not_needed = true, planned_on = null, done_on = null, factory_on = null
      where not public.line_stages.not_needed;
  else
    update public.line_stages set not_needed = false where line_id = p_line and public.garment_only_stage(stage) and not_needed;
    update public.order_lines set product = 'garment' where id = p_line and product <> 'garment';
  end if;
end $$;
revoke execute on function public.apply_line_product(uuid, text) from public, anon, authenticated;

-- The orders team switches a style, only before its factory PO is released and not once a garment-only step is done.
create function public.set_line_product(p_line uuid, p_product text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.order_lines;
begin
  select * into l from public.order_lines where id = p_line and removed_at is null;
  if l.id is null or l.company_id is distinct from public.current_company() or not public.can_edit_orders(l.company_id) then
    raise exception 'Only the orders team can change a style.';
  end if;
  if p_product not in ('garment', 'fabric') then
    raise exception 'A style is a garment or fabric.';
  end if;
  if not exists (select 1 from public.orders where id = l.order_id and status = 'open') then
    raise exception 'This order isn''t open.';
  end if;
  if l.product = p_product then
    return;
  end if;
  if exists (select 1 from public.factory_pos f where f.order_id = l.order_id and f.factory_id = l.factory_id and f.released_at is not null) then
    raise exception 'This factory''s PO is already released, so its steps are locked.';
  end if;
  if p_product = 'fabric' and exists (select 1 from public.line_stages s where s.line_id = p_line and public.garment_only_stage(s.stage) and s.done_on is not null and not s.not_needed) then
    raise exception 'A garment step of this style is already done, so it can''t become fabric.';
  end if;
  perform public.apply_line_product(p_line, p_product);
end $$;
revoke execute on function public.set_line_product(uuid, text) from public, anon;
grant execute on function public.set_line_product(uuid, text) to authenticated;

-- A style typed in with the description Fabric is fabric from the start, so nobody has to remember the switch.
create function public.order_lines_fabric_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.apply_line_product(new.id, 'fabric');
  return null;
end $$;
create trigger order_lines_fabric_on_insert after insert on public.order_lines
  for each row when (lower(btrim(coalesce(new.description, ''))) in ('fabric', 'fabrics'))
  execute function public.order_lines_fabric_on_insert();

-- Styles already on open orders with the description Fabric (SO-0020's two), whose factory PO isn't released yet.
select public.apply_line_product(l.id, 'fabric')
from public.order_lines l
join public.orders o on o.id = l.order_id and o.status = 'open'
where l.removed_at is null and lower(btrim(coalesce(l.description, ''))) in ('fabric', 'fabrics')
  and not exists (select 1 from public.factory_pos f where f.order_id = l.order_id and f.factory_id = l.factory_id and f.released_at is not null);
