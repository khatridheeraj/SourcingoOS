-- An order's stage also changes when a style is added (it has nothing done yet, so the order drops back)
-- or removed (it may have been the slowest). Until now only date changes on the steps moved it.
create or replace function public.sync_order_stage_lines() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_stage text;
begin
  if not exists (select 1 from public.line_stages where order_id = new.order_id and done_on is not null) then
    return null;
  end if;
  v_stage := public.order_stage(new.order_id);
  update public.orders set stage = v_stage where id = new.order_id and stage is distinct from v_stage;
  return null;
end $$;

create trigger order_lines_sync_stage after insert or update of removed_at on public.order_lines
for each row execute function public.sync_order_stage_lines();
