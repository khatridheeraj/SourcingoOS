-- Part shipments (Dheeraj, 21 Oct 2026): SO-0001 went out as 579 of 600 pieces, with one more part to follow before
-- the order closes. An order already took many dispatches, but nothing showed what was sent and what was left, the
-- order could be marked shipped after the first part, and there was no way to close it with pieces left unsent.
-- Now each style counts its pieces bought, billed and shipped across the order's dispatches; the order stays open
-- until every style is billed in full, or the orders team closes it short with a reason the owner sees.

alter table public.orders
  add column closed_short_at timestamptz,
  add column closed_short_by uuid,
  add column short_reason text;

-- Each style's pieces: ordered, bought (on a live dispatch), billed (invoiced to the buyer) and shipped (LR in).
-- For the staff who see orders; the dispatches themselves stay with the orders team.
create function public.ship_progress(p_orders uuid[])
returns table (order_id uuid, line_id uuid, ordered integer, bought integer, billed integer, shipped integer)
language sql stable security definer set search_path = '' as $$
  select l.order_id, l.id, l.qty,
         coalesce(sum(dl.qty) filter (where d.id is not null), 0)::integer,
         coalesce(sum(dl.qty) filter (where d.invoiced_at is not null), 0)::integer,
         coalesce(sum(dl.qty) filter (where d.shipped_at is not null), 0)::integer
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  left join public.dispatch_lines dl on dl.line_id = l.id
  left join public.dispatches d on d.id = dl.dispatch_id and d.cancelled_at is null
  where l.order_id = any (p_orders) and l.removed_at is null and public.is_member(o.company_id)
  group by l.order_id, l.id, l.qty
$$;
revoke execute on function public.ship_progress(uuid[]) from public, anon;
grant execute on function public.ship_progress(uuid[]) to authenticated;

-- An order is marked shipped once its goods are bought and billed: every dispatch invoiced, and every style billed
-- in full. An order closed short skips the last check: what was sent is all that goes.
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
  select string_agg(l.style, ', ' order by l.style) into v_styles
  from public.order_lines l
  where l.order_id = p_order and l.removed_at is null
    and not exists (select 1 from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                    where dl.line_id = l.id and d.cancelled_at is null and d.invoiced_at is not null);
  if v_styles is not null then
    return format('%s %s no factory bill and invoice in Dispatch yet. Record them there, then mark the order shipped.',
                  v_styles, case when position(',' in v_styles) > 0 then 'have' else 'has' end);
  end if;
  if v_short is null then
    select string_agg(format('%s %s of %s pcs', p.style, p.billed, p.ordered), ', ' order by p.style) into v_styles
    from (select l.style, s.billed, s.ordered from public.ship_progress(array[p_order]) s
          join public.order_lines l on l.id = s.line_id where s.billed < s.ordered) p;
    if v_styles is not null then
      return format('Only part of the order is billed so far: %s. Record the next part in Dispatch, or close the order short there.', v_styles);
    end if;
  end if;
  return null;
end $$;

-- Closes an open order with pieces left unsent. The orders team gives the reason; the owner sees it in the brief.
-- Everything else for shipping still holds: every dispatch invoiced, and (except for the owner) final QC passed.
create function public.close_order_short(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  v_left integer;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not public.can_edit_orders(o.company_id) then
    raise exception 'Only the orders team can close an order.';
  end if;
  if o.status <> 'open' then raise exception 'This order isn''t open any more. Reload the page.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why the rest won''t be sent.'; end if;
  select sum(greatest(ordered - billed, 0)) into v_left from public.ship_progress(array[p_order]);
  if coalesce(v_left, 0) = 0 then
    raise exception 'Every piece is billed in Dispatch. Mark the order shipped instead.';
  end if;
  update public.orders set closed_short_at = now(), closed_short_by = auth.uid(), short_reason = btrim(p_reason) where id = p_order;
  -- The shipping guard runs on this update, with the order now closed short.
  update public.orders set status = 'shipped' where id = p_order;
end $$;
revoke execute on function public.close_order_short(uuid, text) from public, anon;
grant execute on function public.close_order_short(uuid, text) to authenticated;

-- An order opened again is no longer closed short: the rest can still be sent.
create function public.clear_short_on_reopen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'open' and old.status is distinct from 'open' then
    new.closed_short_at := null;
    new.closed_short_by := null;
    new.short_reason := null;
  end if;
  return new;
end $$;
create trigger orders_clear_short before update on public.orders
  for each row execute function public.clear_short_on_reopen();
revoke execute on function public.clear_short_on_reopen() from public, anon, authenticated;

-- The morning brief: open orders sent in part, with what is left, and (for the owner) orders closed short
-- in the last two days. Replaces the 0050 wrapper with the same locks, inquiries and team notes plus these.
create or replace function public.brief_data_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_base jsonb := public.brief_data_base(p_user);
  v_today date := public.india_today();
  v_extra jsonb;
begin
  select p.current_company_id into v_company from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is null or v_role not in ('owner', 'manager', 'merchandiser', 'accounts') then
    return v_base;
  end if;
  v_extra := jsonb_build_object(
    -- The owner sees every PO sent for the lock; the team sees the plans the owner sent back.
    'locks', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'factory', f.name,
                                          'at', coalesce(fp.lock_note_at, fp.lock_requested_at), 'note', fp.lock_note)
                       order by coalesce(fp.lock_note_at, fp.lock_requested_at))
      from public.factory_pos fp join public.orders o on o.id = fp.order_id join public.factories f on f.id = fp.factory_id
      where fp.company_id = v_company and o.status = 'open' and fp.released_at is null
        and case when v_role = 'owner' then fp.lock_requested_at is not null else fp.lock_note is not null end), '[]'::jsonb),
    -- Follow-ups due today or late: the owner sees all, the team its own and the unassigned ones.
    'inquiries_due', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'inquiry_no', i.inquiry_no, 'product', left(i.product, 80), 'on', i.next_follow_up,
                                          'who', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = i.buyer_id), b.code, i.prospect))
                       order by i.next_follow_up, i.inquiry_no)
      from public.inquiries i left join public.buyers b on b.id = i.buyer_id
      where i.company_id = v_company and i.status in ('new', 'quoted') and i.next_follow_up <= v_today
        and (v_role = 'owner' or i.merchandiser_id is null or i.merchandiser_id = p_user)), '[]'::jsonb),
    -- Open orders with some pieces shipped and some still to send.
    'part_shipped', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', x.id, 'order_no', x.order_no, 'ordered', x.ordered, 'shipped', x.shipped) order by x.order_no)
      from (select o.id, o.order_no, sum(l.qty)::integer as ordered,
                   coalesce((select sum(dl.qty) from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                             join public.order_lines ll on ll.id = dl.line_id
                             where d.order_id = o.id and d.cancelled_at is null and d.shipped_at is not null and ll.removed_at is null), 0)::integer as shipped
            from public.orders o join public.order_lines l on l.order_id = o.id and l.removed_at is null
            where o.company_id = v_company and o.status = 'open'
            group by o.id, o.order_no) x
      where x.shipped > 0 and x.shipped < x.ordered), '[]'::jsonb));
  if v_role = 'owner' then
    v_extra := v_extra || jsonb_build_object('team_notes', coalesce((
      select jsonb_agg(jsonb_build_object('no', n.no, 'kind', n.kind, 'body', left(n.body, 160), 'by', public.help_sender_label(n.company_id, n.created_by),
                                          'at', n.created_at, 'suggestion', left(n.suggestion, 200)) order by n.created_at)
      from public.team_notes n where n.company_id = v_company and n.status = 'new'), '[]'::jsonb),
    'closed_short', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'reason', left(o.short_reason, 160), 'at', o.closed_short_at,
                                          'by', public.help_sender_label(o.company_id, o.closed_short_by),
                                          'ordered', (select sum(l.qty) from public.order_lines l where l.order_id = o.id and l.removed_at is null),
                                          -- Summed here: the emailed brief runs with no one signed in.
                                          'billed', (select coalesce(sum(dl.qty), 0) from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                                                     join public.order_lines l on l.id = dl.line_id
                                                     where d.order_id = o.id and d.cancelled_at is null and d.invoiced_at is not null and l.removed_at is null))
                       order by o.closed_short_at)
      from public.orders o
      where o.company_id = v_company and o.status = 'shipped' and o.closed_short_at >= now() - interval '2 days'), '[]'::jsonb));
  end if;
  return v_base || v_extra;
end $$;
revoke execute on function public.brief_data_for(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_for(uuid) to service_role;
