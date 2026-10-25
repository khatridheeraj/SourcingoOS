-- The owner deletes a PO the team entered by mistake.
-- Nothing is erased: the order is marked deleted with a reason, drops out of every screen, list, count, portal and
-- email, stays in the activity log, and the owner can bring it back. A deleted order frees its buyer PO number,
-- so the right PO can be entered again.
-- Only orders that are open or cancelled, with no goods bought on them, can be deleted: anything with money or
-- goods behind it is cancelled or closed short instead.

alter table public.orders
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id),
  add column removed_reason text,
  add column removed_status text,
  add column removed_po text;
-- Not granted to staff: the owner reads these through deleted_orders() below.

-- Hidden from everyone who reads orders through the app, whatever their role.
create policy orders_not_removed on public.orders as restrictive for select to authenticated using (removed_at is null);

-- A deleted order frees its buyer PO number: the number moves to removed_po and buyer_po gets a marked copy, so
-- orders_buyer_po_key lets the right PO be entered again. Bringing the order back puts the number back.

-- ---------------------------------------------------------------- delete and bring back

create function public.remove_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from public.current_company() or o.removed_at is not null then
    raise exception 'This order is no longer here. Reload the page.';
  end if;
  if not public.is_owner(o.company_id) then
    raise exception 'Only the owner can delete a PO.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why this PO is being deleted, for example: entered twice.';
  end if;
  if o.status = 'shipped' then
    raise exception 'This order is shipped, so it can''t be deleted.';
  end if;
  if exists (select 1 from public.dispatches d where d.order_id = p_order and d.cancelled_at is null) then
    raise exception 'Goods are already bought on this order, so it can''t be deleted. Cancel its dispatches first, or close the order short.';
  end if;
  update public.orders set removed_at = now(), removed_by = auth.uid(), removed_reason = left(btrim(p_reason), 300),
    removed_status = o.status, status = 'cancelled',
    removed_po = o.buyer_po, buyer_po = left(o.buyer_po, 80) || ' (deleted ' || o.order_no || ')'
  where id = p_order;
  -- The buyer's PO it was made from goes back under Set aside on Buyer POs.
  update public.incoming_pos set status = 'not_po', closed_by = auth.uid(), closed_at = now()
  where order_id = p_order and status = 'added';
end $$;

create function public.restore_order(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  v_clash text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.company_id is distinct from public.current_company() or o.removed_at is null then
    raise exception 'This PO is not deleted any more. Reload the page.';
  end if;
  if not public.is_owner(o.company_id) then
    raise exception 'Only the owner can bring back a deleted PO.';
  end if;
  select x.order_no into v_clash from public.orders x
  where x.company_id = o.company_id and x.buyer_id = o.buyer_id and x.removed_at is null
    and lower(btrim(x.buyer_po)) = lower(btrim(coalesce(o.removed_po, o.buyer_po)));
  if v_clash is not null then
    raise exception 'PO % of this buyer is on % now. Delete or change that order first.', coalesce(o.removed_po, o.buyer_po), v_clash;
  end if;
  update public.orders set removed_at = null, removed_by = null, removed_reason = null, removed_status = null,
    status = coalesce(o.removed_status, 'open'), buyer_po = coalesce(o.removed_po, o.buyer_po), removed_po = null
  where id = p_order;
  update public.incoming_pos set status = 'added', closed_by = auth.uid(), closed_at = now()
  where order_id = p_order and status = 'not_po';
end $$;

-- The owner's list of deleted POs, newest first, to bring one back.
create function public.deleted_orders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'buyer_id', o.buyer_id, 'buyer_po', coalesce(o.removed_po, o.buyer_po),
      'removed_at', o.removed_at, 'removed_by', o.removed_by, 'reason', o.removed_reason,
      'styles', (select count(*) from public.order_lines l where l.order_id = o.id and l.removed_at is null),
      'pieces', (select coalesce(sum(l.qty), 0) from public.order_lines l where l.order_id = o.id and l.removed_at is null))
    order by o.removed_at desc), '[]'::jsonb)
  from public.orders o
  where o.company_id = public.current_company() and o.removed_at is not null and public.is_owner(o.company_id);
$$;

revoke execute on function public.remove_order(uuid, text), public.restore_order(uuid), public.deleted_orders() from public, anon;
grant execute on function public.remove_order(uuid, text), public.restore_order(uuid), public.deleted_orders() to authenticated;

-- ---------------------------------------------------------------- deleted orders stay out of the rest

-- A factory PO is emailed and chased only while its order is open (before, a cancelled order's PO kept being chased).
create or replace function public.po_mail_due() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', fp.order_id, 'factory_id', fp.factory_id, 'thread_id', fp.mail_thread_id,
      'kind', case when fp.last_mailed_at is null or fp.mail_requested_at > fp.last_mailed_at then 'po' else 'follow_up' end,
      'follow_ups', fp.follow_ups,
      'to', coalesce(c.po_mail_test_to, fp.mail_to),
      'cc', case when c.po_mail_test_to is null then fp.mail_cc end,
      'test_for', case when c.po_mail_test_to is not null then fp.mail_to end)
    order by fp.mail_requested_at), '[]'::jsonb)
  from public.factory_pos fp join public.companies c on c.id = fp.company_id
  join public.orders o on o.id = fp.order_id and o.status = 'open' and o.removed_at is null
  where fp.mail_requested_at is not null and fp.accepted_at is null and fp.released_at is not null
    and (fp.last_mailed_at is null or fp.mail_requested_at > fp.last_mailed_at
      or (fp.last_mailed_at < now() - interval '115 minutes' and (fp.reply_at is null or fp.reply_at < fp.last_mailed_at)));
$$;

-- A buyer PO read from email or a file is matched only to an order that is not deleted.
create or replace function public.save_po_reading(p_id uuid, p_pos jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
  v_po jsonb;
  v_n integer := 0;
  v_buyer uuid;
  v_match uuid;
begin
  select * into r from public.incoming_pos where id = p_id for update;
  if r.id is null then
    raise exception 'No such incoming PO.';
  end if;
  if r.status not in ('receiving', 'reading', 'failed', 'to_check') then
    return;
  end if;
  if p_error is not null then
    update public.incoming_pos set status = 'failed', read_error = left(p_error, 1000), read_at = now() where id = p_id;
    return;
  end if;
  if jsonb_array_length(coalesce(p_pos, '[]'::jsonb)) < r.part then
    if r.part > 1 then
      update public.incoming_pos set status = 'failed', read_error = 'This PO is no longer in the file when read again.', read_at = now()
      where id = p_id;
    else
      update public.incoming_pos set status = 'not_po', read = '{}'::jsonb, read_error = null, read_at = now() where id = p_id;
    end if;
    return;
  end if;
  for v_po in select value from jsonb_array_elements(p_pos) loop
    v_n := v_n + 1;
    exit when v_n > 50;
    continue when v_n <> r.part and (r.part > 1 or r.status = 'to_check');
    v_buyer := null;
    select b.id into v_buyer from public.buyers b
    where b.company_id = r.company_id and b.code = upper(btrim(v_po ->> 'buyer_code'));
    if v_buyer is null then
      select n.buyer_id into v_buyer from public.buyer_names n
      where n.company_id = r.company_id and lower(btrim(n.real_name)) = lower(btrim(v_po ->> 'buyer_name'));
    end if;
    v_match := null;
    if v_buyer is not null and coalesce(btrim(v_po ->> 'po_number'), '') <> '' then
      select o.id into v_match from public.orders o
      where o.company_id = r.company_id and o.buyer_id = v_buyer and o.removed_at is null
        and lower(btrim(o.buyer_po)) = lower(btrim(v_po ->> 'po_number'));
    end if;
    if v_n = r.part then
      update public.incoming_pos set status = 'to_check', read = v_po - 'buyer_name', read_error = null, read_at = now(),
        buyer_name_read = left(v_po ->> 'buyer_name', 200), buyer_id = v_buyer, buyer_po = left(btrim(v_po ->> 'po_number'), 100),
        matched_order_id = v_match
      where id = p_id;
    else
      insert into public.incoming_pos (company_id, source, email_id, part, email_from, email_subject, email_body, received_at, files,
                                       status, read, read_at, buyer_name_read, buyer_id, buyer_po, matched_order_id, created_by)
      values (r.company_id, r.source, r.email_id, v_n, r.email_from, r.email_subject, r.email_body, r.received_at, r.files,
              'to_check', v_po - 'buyer_name', now(), left(v_po ->> 'buyer_name', 200), v_buyer, left(btrim(v_po ->> 'po_number'), 100),
              v_match, r.created_by)
      on conflict (company_id, email_id, part) where email_id is not null do nothing;
    end if;
  end loop;
end $$;

-- Already-read POs matched to an order that is now deleted lose that match.
update public.incoming_pos i set matched_order_id = null
from public.orders o where o.id = i.matched_order_id and o.removed_at is not null;

-- The order form's duplicate warnings leave deleted orders out.
create or replace function public.order_entry_warnings(p_buyer uuid, p_buyer_po text, p_styles text[], p_order uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_po text := lower(btrim(coalesce(p_buyer_po, '')));
  v_key text := public.po_key(p_buyer_po);
  v_styles text[];
begin
  select company_id into v_company from public.buyers where id = p_buyer;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can check orders.';
  end if;
  select coalesce(array_agg(distinct lower(btrim(s))), '{}') into v_styles
  from unnest(coalesce(p_styles, '{}')) s where btrim(s) <> '';

  return jsonb_build_object(
    'same_po', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'status', o.status) order by o.order_no)
      from public.orders o
      where o.company_id = v_company and o.buyer_id = p_buyer and v_po <> '' and lower(btrim(o.buyer_po)) = v_po
        and o.removed_at is null and o.id is distinct from p_order), '[]'::jsonb),
    'similar_po', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'status', o.status) order by o.order_no)
      from public.orders o
      where o.company_id = v_company and o.buyer_id = p_buyer and v_key is not null and public.po_key(o.buyer_po) = v_key
        and lower(btrim(o.buyer_po)) <> v_po and o.removed_at is null and o.id is distinct from p_order), '[]'::jsonb),
    'same_style', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'order_no', x.order_no, 'buyer_po', x.buyer_po, 'styles', x.styles) order by x.order_no)
      from (
        select o.id, o.order_no, o.buyer_po, jsonb_agg(distinct l.style) as styles
        from public.orders o join public.order_lines l on l.order_id = o.id and l.removed_at is null
        where o.company_id = v_company and o.buyer_id = p_buyer and o.status = 'open' and o.id is distinct from p_order
          and lower(btrim(l.style)) = any (v_styles)
        group by o.id, o.order_no, o.buyer_po
      ) x), '[]'::jsonb));
end $$;
