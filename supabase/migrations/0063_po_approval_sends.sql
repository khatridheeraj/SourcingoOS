-- Merchandisers prepare and submit each factory PO; the owner approves it, and approving sends it (Dheeraj, 23 Oct 2026).
-- Sending a plan for the owner's lock is now "Send PO for approval": besides a complete plan it needs every style's
-- photo and the factory's email, so the PO can go out the moment it is approved. The owner's approval (the release)
-- queues the PO email to the factory, with the merchandiser who submitted it in CC; the scheduled email task sends it
-- and follows up until the factory accepts.

-- What stops a released PO from being emailed straight away, or null when it can go.
create function public.po_send_blocker(p_order uuid, p_factory uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text;
begin
  select string_agg(style, ', ' order by position) into v_missing from public.order_lines
  where order_id = p_order and factory_id = p_factory and removed_at is null and photo_path is null;
  if v_missing is not null then
    return 'Add the style photo first: ' || v_missing || '. The factory works from the picture.';
  end if;
  if not exists (select 1 from public.factories where id = p_factory and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    return 'Add the factory''s email in PO details first, so the PO can be emailed once it is approved.';
  end if;
  return null;
end $$;
revoke execute on function public.po_send_blocker(uuid, uuid) from public, anon;
grant execute on function public.po_send_blocker(uuid, uuid) to authenticated;

create or replace function public.request_po_lock(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send a PO for approval on an open order.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    raise exception 'The PO is already released.';
  end if;
  v_block := coalesce(public.release_blocker(p_order, p_factory), public.po_send_blocker(p_order, p_factory));
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  update public.factory_pos
  set lock_requested_at = now(), lock_requested_by = auth.uid(), lock_note = null, lock_note_at = null
  where order_id = p_order and factory_id = p_factory;
end $$;

-- The owner's approval releases the PO and, when it can go, queues its email to the factory.
create or replace function public.release_factory_po(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
  f public.factory_pos;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can release a factory PO on an open order.';
  end if;
  if not public.is_owner(v_company) then
    raise exception 'Only the owner approves and releases a factory PO. Send the PO for approval.';
  end if;
  select * into f from public.factory_pos where order_id = p_order and factory_id = p_factory for update;
  if f.released_at is not null then
    return;
  end if;
  v_block := public.release_blocker(p_order, p_factory);
  if v_block is not null then
    raise exception '%', v_block;
  end if;
  update public.factory_pos set released_at = now(), released_by = auth.uid(), lock_note = null, lock_note_at = null
  where id = f.id and released_at is null;
  -- The plan as released is the baseline that later lateness is measured from.
  update public.line_stages s set baseline_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and s.baseline_on is null and s.planned_on is not null and not s.not_needed;
  -- Approved means sent: the PO email goes out with the next run of the email task.
  if public.po_send_blocker(p_order, p_factory) is null then
    update public.factory_pos fp set mail_to = lower(btrim(fa.email)),
      mail_cc = (select lower(p.email) from public.profiles p where p.id = f.lock_requested_by and p.id is distinct from auth.uid()),
      mail_requested_at = now(), mail_requested_by = auth.uid(), reply_at = null, reply_text = null, updated_at = now()
    from public.factories fa
    where fp.id = f.id and fa.id = p_factory;
  end if;
end $$;
