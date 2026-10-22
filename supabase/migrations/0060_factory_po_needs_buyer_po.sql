-- A factory PO is issued only against a PO received from the buyer (Dheeraj, 22 Oct 2026): a factory's plan can't be
-- sent for the lock, locked or released until the buyer's PO is on the order, from email, Incoming POs or added by hand.
-- Orders already released stay as they are.

create function public.order_has_buyer_po(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.incoming_pos where order_id = p_order and jsonb_array_length(files) > 0)
      or exists (select 1 from public.order_po_files where order_id = p_order and removed_at is null)
$$;
revoke execute on function public.order_has_buyer_po(uuid) from public, anon, authenticated;

create or replace function public.release_blocker(p_order uuid, p_factory uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text;
  f public.factory_pos;
begin
  if not exists (select 1 from public.orders where id = p_order and status = 'open' and company_id = public.current_company()) then
    return 'This order isn''t open.';
  end if;
  if not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    return 'This factory has no styles on the order.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory;
  if f.released_at is not null then
    return null;
  end if;
  if not public.order_has_buyer_po(p_order) then
    return 'The buyer''s PO isn''t on file yet. A factory PO is issued only against a PO received from the buyer: add the buyer''s PO in the order''s Details first.';
  end if;
  if public.factory_target(p_order, p_factory) is null then
    return 'Enter the PO''s ship date first.';
  end if;
  select string_agg(style || ' (' || what || ')', ' | ' order by first) into v_missing
  from (select style, min(ord) as first, string_agg(case kind
             when 'rate' then 'factory rate'
             when 'target' then 'target: ' || steps
             when 'beyond' then 'target after the PO target date: ' || steps
             when 'factory' then 'factory dates: ' || steps
             else 'factory later than target: ' || steps end, '; ' order by ord) as what
        from (select g.*, row_number() over () as ord from public.tna_gaps(p_order, p_factory) g) n
        group by style) per_style;
  if v_missing is not null then
    return 'The plan is not complete yet. Missing: ' || v_missing;
  end if;
  if f.id is null or (f.plan_requested_at is null and f.plan_requested_on is null) then
    return 'Ask the factory for its plan first.';
  end if;
  if f.factory_sent_at is null or (f.plan_requested_at is not null and f.factory_sent_at < f.plan_requested_at) then
    return 'The factory hasn''t sent its plan for your latest request yet. Wait for it, or press "Factory agreed to targets" if it agreed by phone.';
  end if;
  return null;
end $$;
