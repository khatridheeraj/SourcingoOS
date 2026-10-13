-- Done dates entered by Quality never moved the order's stage: the stage triggers ran with Quality's
-- own rights, and Quality can't edit orders, so the update quietly changed nothing. The triggers
-- only ever write the stage the database works out itself, so they now run with the owner's rights.
alter function public.sync_order_stage() security definer;
alter function public.sync_order_stage_lines() security definer;
revoke execute on function public.sync_order_stage(), public.sync_order_stage_lines() from public, anon, authenticated;

-- Bring stages already left behind by this up to date.
update public.orders o set stage = public.order_stage(o.id)
where o.status = 'open' and exists (select 1 from public.line_stages s where s.order_id = o.id and s.done_on is not null)
  and o.stage is distinct from public.order_stage(o.id);
