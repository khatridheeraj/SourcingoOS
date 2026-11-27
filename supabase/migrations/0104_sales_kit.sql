-- Sales kit and lead follow-up (0104, Dheeraj's six-month plan, batch 2, 28 Nov 2026).
-- 1. Our record: the few numbers that prove Sourcingo delivers, counted from real orders, shipments, TNA steps,
--    QC checks and factory visits, never typed in. The team always sees it; the public website shows it only once
--    the owner switches it on (companies.record_public), the same way the Guarantee waits for him.
-- 2. First reply: every lead should hear back within a day. The inquiry keeps when the team first replied and how,
--    so Home can flag a website lead still waiting and Reports > Leads can show how fast the team answers.
-- Nothing here is ever deleted.

alter table public.companies
  add column record_public boolean not null default false,
  add column record_public_at timestamptz;

alter table public.inquiries
  add column first_reply_at timestamptz,
  add column first_reply_via text check (first_reply_via in ('email', 'whatsapp', 'phone', 'visit', 'page'));
grant update (first_reply_at, first_reply_via) on public.inquiries to authenticated;

-- A price sent, a sample sent or an order made is a reply too, so nobody has to mark it twice. (Only on a change: an
-- inquiry logged already quoted was answered before anyone typed it in, so it says nothing about reply speed.)
create function public.inquiry_first_reply() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.first_reply_at is null and (new.status in ('quoted', 'converted') or new.sample_sent_on is not null) then
    new.first_reply_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.inquiry_first_reply() from public, anon, authenticated;
create trigger inquiries_first_reply before update on public.inquiries
  for each row execute function public.inquiry_first_reply();

-- Inquiries that were already quoted, sampled or ordered had a reply by then at the latest. (The guard is paused so
-- this fill-in doesn't count as someone touching them.)
alter table public.inquiries disable trigger inquiries_guard;
update public.inquiries set first_reply_at = least(status_at, coalesce(sample_sent_on::timestamptz, status_at))
where first_reply_at is null and (status in ('quoted', 'converted') or sample_sent_on is not null);
alter table public.inquiries enable trigger inquiries_guard;

-- Our record. Counts only; the app decides which are big enough to show (src/lib/record.ts).
create function public.sourcingo_record() returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (
    select id, record_public, email, phone from public.companies where id = public.site_company()
  ), allowed as (
    select c.id from c where c.record_public or public.is_member(c.id)
  ), o as (
    select o.* from public.orders o join allowed on allowed.id = o.company_id
    where o.removed_at is null and o.status <> 'cancelled'
  ), l as (
    select l.*, o.status as order_status from public.order_lines l join o on o.id = l.order_id where l.removed_at is null
  ), st as (
    select count(*) filter (where s.done_on is not null and s.planned_on is not null) as finished,
           count(*) filter (where s.done_on is not null and s.planned_on is not null and s.done_on <= s.planned_on) as on_time,
           count(*) filter (where s.done_on is null and s.planned_on < public.india_today() and l.order_status = 'open') as overdue
    from public.line_stages s join l on l.id = s.line_id
    where not coalesce(s.not_needed, false)
  ), q as (
    select q.* from public.qc_checks q join o on o.id = q.order_id where q.cancelled_at is null
  ), firsts as (
    -- The first Final check of each style (a check for the whole order counts as one), by check date.
    select distinct on (order_id, coalesce(line_id, order_id)) result from q where kind = 'final'
    order by order_id, coalesce(line_id, order_id), checked_on, created_at
  ), sh as (
    select d.id, (d.shipped_at at time zone 'Asia/Kolkata')::date as shipped_on, o.ship_date,
           (select coalesce(sum(dl.qty) filter (where ln.product <> 'fabric'), 0) from public.dispatch_lines dl
              join public.order_lines ln on ln.id = dl.line_id where dl.dispatch_id = d.id) as pcs,
           (select coalesce(sum(dl.qty) filter (where ln.product = 'fabric'), 0) from public.dispatch_lines dl
              join public.order_lines ln on ln.id = dl.line_id where dl.dispatch_id = d.id) as metres
    from public.dispatches d join o on o.id = d.order_id
    where d.cancelled_at is null and d.shipped_at is not null
  ), ver as (
    select distinct on (v.factory_id) v.factory_id, v.visited_on
    from public.factory_verifications v join allowed on allowed.id = v.company_id
    where v.cancelled_at is null order by v.factory_id, v.visited_on desc
  )
  select case when not exists (select 1 from allowed) then null else jsonb_build_object(
    'since', (select min(po_date) from o),
    'orders', (select count(*) from o),
    'orders_shipped', (select count(*) from o where status = 'shipped'),
    'buyers', (select count(distinct buyer_id) from o),
    'styles', (select count(*) from l),
    'pieces_ordered', (select coalesce(sum(qty), 0) from l where product <> 'fabric'),
    'metres_ordered', (select coalesce(sum(qty), 0) from l where product = 'fabric'),
    'factories_used', (select count(distinct factory_id) from l),
    'factories_verified', (select count(*) from ver where visited_on > public.india_today() - 365),
    'shipments', (select count(*) from sh),
    'shipments_dated', (select count(*) from sh where ship_date is not null),
    'shipments_on_time', (select count(*) from sh where ship_date is not null and shipped_on <= ship_date),
    'pieces_shipped', (select coalesce(sum(pcs), 0) from sh),
    'metres_shipped', (select coalesce(sum(metres), 0) from sh),
    'steps_finished', (select finished from st),
    'steps_on_time', (select on_time from st),
    'steps_overdue', (select overdue from st),
    'qc_checks', (select count(*) from q),
    'qc_inline', (select count(*) from q where kind <> 'final'),
    'final_firsts', (select count(*) from firsts),
    'final_first_pass', (select count(*) from firsts where result = 'pass'),
    'pieces_checked', (select coalesce(sum(pieces_checked), 0) from q where kind = 'final'),
    'defects', (select coalesce(sum(defects), 0) from q where kind = 'final'),
    'public', (select record_public from c),
    'email', (select email from c),
    'phone', (select phone from c),
    'as_of', now()
  ) end
$$;
revoke execute on function public.sourcingo_record() from public;
grant execute on function public.sourcingo_record() to anon, authenticated;

-- Only the owner switches the public record on or off.
create function public.set_record_public(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_owner(v_company) then
    raise exception 'Only the owner can show our record on the website.';
  end if;
  update public.companies set record_public = coalesce(p_on, false),
         record_public_at = case when coalesce(p_on, false) then now() else record_public_at end
  where id = v_company;
end $$;
revoke execute on function public.set_record_public(boolean) from public, anon;
grant execute on function public.set_record_public(boolean) to authenticated;

-- The website also needs to know whether to link to our record.
create or replace function public.site_facts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('guarantee', c.guarantee_live, 'deposit_pct', c.guarantee_deposit_pct, 'pay_days', c.guarantee_pay_days,
                            'record', c.record_public)
  from public.companies c where c.id = public.site_company()
$$;
