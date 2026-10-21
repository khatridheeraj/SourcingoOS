-- System recheck (21 Oct 2026). Two dead ends when closing an order short, and buyers not seeing part shipments.
--
-- 1. Closing an order short was refused whenever one style had nothing billed at all ("AH-KURTA-02 has no factory
--    bill and invoice in Dispatch yet"), which is exactly the case when a buyer drops a style. An order closed short
--    ships what was billed; a style with nothing billed simply doesn't go.
-- 2. For the same order, the orders team was then refused for a missing final QC on the style that never went.
--    Closed short, final QC is needed only for the styles that were billed. The owner's override is unchanged.
-- 3. The buyer's page showed an order sent in part as 0% shipped. Each style now carries its pieces shipped, and
--    each order whether it was closed short.

create or replace function public.ship_blocker(p_order uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_short timestamptz;
  v_bills text;
  v_styles text;
  v_any boolean;
begin
  select company_id, closed_short_at into v_company, v_short from public.orders where id = p_order;
  if v_company is null or not public.is_member(v_company) then return null; end if;
  select string_agg(purchase_bill_no, ', ' order by purchased_at) into v_bills
  from public.dispatches where order_id = p_order and cancelled_at is null and invoiced_at is null;
  if v_bills is not null then
    return format('Factory bill %s has no invoice to the buyer yet. Invoice it in Dispatch, then mark the order shipped.', v_bills);
  end if;
  select exists (select 1 from public.dispatches where order_id = p_order and cancelled_at is null) into v_any;
  if not v_any then
    return 'Nothing is in Dispatch yet. Record the factory''s bill and our invoice to the buyer there, then mark the order shipped.';
  end if;
  -- Closed short, what was billed is all that goes: a style with nothing billed is not a blocker.
  if v_short is null then
    select string_agg(l.style, ', ' order by l.style) into v_styles
    from public.order_lines l
    where l.order_id = p_order and l.removed_at is null
      and not exists (select 1 from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                      where dl.line_id = l.id and d.cancelled_at is null and d.invoiced_at is not null);
    if v_styles is not null then
      return format('%s %s no factory bill and invoice in Dispatch yet. Record them there, then mark the order shipped.',
                    v_styles, case when position(',' in v_styles) > 0 then 'have' else 'has' end);
    end if;
    select string_agg(format('%s %s of %s pcs', p.style, p.billed, p.ordered), ', ' order by p.style) into v_styles
    from (select l.style, s.billed, s.ordered from public.ship_progress(array[p_order]) s
          join public.order_lines l on l.id = s.line_id where s.billed < s.ordered) p;
    if v_styles is not null then
      return format('Only part of the order is billed so far: %s. Record the next part in Dispatch, or close the order short there.', v_styles);
    end if;
  end if;
  return null;
end $$;

-- Final QC passed on every style that goes: all of them, or for an order closed short, the ones with pieces billed.
create or replace function public.final_qc_passed_shipping(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_lines l where l.order_id = p_order and l.removed_at is null)
     and not exists (
       select 1 from public.order_lines l
       join public.orders o on o.id = l.order_id
       where l.order_id = p_order and l.removed_at is null
         and (o.closed_short_at is null
              or exists (select 1 from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                         where dl.line_id = l.id and dl.qty > 0 and d.cancelled_at is null and d.invoiced_at is not null))
         and coalesce((select q.result = 'pass' from public.qc_checks q
                       where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                       order by q.checked_on desc, q.created_at desc limit 1), false) = false)
$$;
revoke execute on function public.final_qc_passed_shipping(uuid) from public, anon;
grant execute on function public.final_qc_passed_shipping(uuid) to authenticated;

create or replace function public.guard_ship() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_why text;
begin
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status is distinct from 'shipped') and auth.uid() is not null then
    if tg_op = 'INSERT' then
      raise exception 'A new order starts open. Mark it shipped once its factory bill and invoice are in Dispatch.'
        using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    v_why := public.ship_blocker(new.id);
    if v_why is not null then
      raise exception '%', v_why using errcode = 'P0001', hint = 'dispatch_required';
    end if;
    if not public.is_owner(new.company_id) and not public.final_qc_passed_shipping(new.id) then
      raise exception 'Record a passed final QC before marking this order shipped.' using errcode = 'P0001', hint = 'final_qc_required';
    end if;
  end if;
  return new;
end $$;

-- The buyer's orders, as in 0039, plus each style's pieces shipped and whether the order was closed short.
create or replace function public.buyer_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return jsonb_build_object(
    'buyer', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = v_buyer), (select code from public.buyers where id = v_buyer)),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'po_date', o.po_date, 'status', o.status,
        'ship_date', o.ship_date, 'revised_ship_date', o.revised_ship_date, 'closed_short', o.closed_short_at is not null,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'style', l.style, 'colour', l.colour, 'description', l.description, 'qty', l.qty, 'photo_path', l.photo_path,
            'shipped', (select coalesce(sum(dl.qty), 0)::integer from public.dispatch_lines dl
                        join public.dispatches d on d.id = dl.dispatch_id
                        where dl.line_id = l.id and d.cancelled_at is null and d.shipped_at is not null),
            'steps', (select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'label', s.label, 'planned_on', s.planned_on, 'done_on', s.done_on)
                        order by s.pos), '[]'::jsonb) from public.style_steps(l.id) s),
            'final_qc', (select jsonb_build_object('result', q.result, 'checked_on', q.checked_on, 'pieces_checked', q.pieces_checked,
                           'photos', (select coalesce(jsonb_agg(p.path order by p.created_at), '[]'::jsonb) from public.qc_photos p
                                      where p.qc_id = q.id and p.kind = 'photo' and p.removed_at is null))
                         from public.qc_checks q where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                         order by q.checked_on desc, q.created_at desc limit 1))
          order by l.position), '[]'::jsonb)
          from public.order_lines l where l.order_id = o.id and l.removed_at is null))
        order by o.status <> 'open', coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
      from public.orders o
      where o.company_id = public.current_company() and o.buyer_id = v_buyer
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
    ), '[]'::jsonb));
end $$;
