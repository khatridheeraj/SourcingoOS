-- Orders close themselves, and non-PO emails stop waiting for the owner (9 Nov 2026).
--
-- 1. An order whose goods have all gone out (every part billed and sent with transport, every style billed in full
--    or the order closed short) and whose final QC passed now closes by itself. Before, someone had to come back and
--    press "Mark shipped", nobody did, and the order sat on Home as "N days late" for goods the buyer already had
--    (SO-0011 went out and was received on 2 Nov and still showed late a week later).
--    It closes the moment the last thing falls into place: the last part is sent, or Quality records the passed
--    final QC after the goods left. The final QC rule is unchanged: without a pass the order stays open, and the
--    order page asks Quality for the record instead of offering a "Mark shipped" the database then refuses.
-- 2. An email from an unknown sender that plainly isn't a PO (bills, tax mail, job applications) no longer waits
--    in the owner's approvals. The PO inbox now screens held emails the same way it screens known ones, and the
--    ones already held are set aside here by the same test on subject and file names. They stay under
--    Buyer POs > Not a PO, and the owner can still bring one back.

-- Everything about the order says it has shipped: something went, nothing is waiting for an invoice or transport,
-- every style is billed and sent in full (or the order was closed short), and the final QC passed.
-- Not gated on membership: the triggers below call it for whoever saved the last piece.
create or replace function public.order_fully_sent(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dispatches d where d.order_id = p_order and d.cancelled_at is null)
     and not exists (select 1 from public.dispatches d where d.order_id = p_order and d.cancelled_at is null
                     and (d.invoiced_at is null or d.shipped_at is null))
     and (
       (select o.closed_short_at is not null from public.orders o where o.id = p_order)
       or not exists (
         select 1 from public.order_lines l
         where l.order_id = p_order and l.removed_at is null
           and l.qty > coalesce((select sum(dl.qty) from public.dispatch_lines dl join public.dispatches d on d.id = dl.dispatch_id
                                 where dl.line_id = l.id and d.cancelled_at is null and d.invoiced_at is not null
                                   and d.shipped_at is not null), 0))
     )
$$;
revoke execute on function public.order_fully_sent(uuid) from public, anon, authenticated;

-- Closes an open order once it is fully sent and its final QC passed. Returns true when it closed it.
create or replace function public.close_if_shipped(p_order uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_when date;
begin
  if not exists (select 1 from public.orders where id = p_order and status = 'open' and removed_at is null) then
    return false;
  end if;
  if not public.order_fully_sent(p_order) or not public.final_qc_passed_shipping(p_order) then
    return false;
  end if;
  select max(coalesce(d.lr_date, (d.shipped_at at time zone 'Asia/Kolkata')::date)) into v_when
  from public.dispatches d where d.order_id = p_order and d.cancelled_at is null;
  -- The ship guard checks the same things (bills, invoices, final QC); this note says it was the app that closed it.
  update public.orders set status = 'shipped',
    closed_note = coalesce(closed_note, format('Closed by itself: everything billed and sent%s.',
                                              case when v_when is null then '' else ' by ' || to_char(v_when, 'FMDD Mon YYYY') end))
  where id = p_order and status = 'open';
  return found;
end $$;
revoke execute on function public.close_if_shipped(uuid) from public, anon, authenticated;

create or replace function public.close_if_shipped_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.close_if_shipped(new.order_id);
  return null;
end $$;

create or replace function public.close_if_shipped_qc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid;
begin
  if new.result is distinct from 'pass' or new.cancelled_at is not null or new.kind not in ('final', 'recheck') then
    return null;
  end if;
  select order_id into v_order from public.order_lines where id = new.line_id;
  if v_order is not null then
    perform public.close_if_shipped(v_order);
  end if;
  return null;
end $$;

create or replace trigger dispatches_close_order after update of shipped_at, invoiced_at, cancelled_at on public.dispatches
  for each row when (new.shipped_at is not null or new.cancelled_at is not null)
  execute function public.close_if_shipped_dispatch();

create or replace trigger qc_checks_close_order after insert or update of result, cancelled_at on public.qc_checks
  for each row execute function public.close_if_shipped_qc();

-- Orders already fully sent with a passed final QC close now.
select public.close_if_shipped(o.id) from public.orders o where o.status = 'open' and o.removed_at is null;

-- 2. Held emails that plainly aren't POs: nothing in the subject or a file name mentions a PO (the same words the
-- PO inbox looks for). Set aside like the owner's "Not a PO", with no one named as closing them.
update public.incoming_pos i set status = 'not_po', closed_at = now()
where i.status = 'held'
  and concat_ws(' ', i.email_subject, (select string_agg(f ->> 'name', ' ') from jsonb_array_elements(coalesce(i.files, '[]'::jsonb)) f))
      !~* '(^|[^a-z])(p\.?\s?o''?s?|purchase\s*orders?|new\s*orders?)([^a-z]|$)';
