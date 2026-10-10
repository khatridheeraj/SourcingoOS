-- Production tracking: where each open order is on the floor, and its new ship
-- date when it slips. The buyer's original ship date is never overwritten, so the
-- team can always see how far an order has moved.
-- (0005 is kept free for the Tally reader.)

alter table public.orders
  add column stage text check (stage in ('fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed')),
  add column stage_at timestamptz,
  add column revised_ship_date date,
  add column delay_reason text;

-- Remembers when the stage last changed, so a stage nobody has touched in weeks stands out.
create function public.stamp_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_at := case when new.stage is null then null else now() end;
  end if;
  return new;
end $$;

create trigger orders_stage before insert or update on public.orders
  for each row execute function public.stamp_stage();

create index orders_due_idx on public.orders (company_id, status, (coalesce(revised_ship_date, ship_date)));
