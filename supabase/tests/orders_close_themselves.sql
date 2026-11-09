-- Orders close by themselves once everything is billed and sent with a passed final QC (0074), and held emails
-- that plainly aren't POs are set aside. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-1'),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"K-2","qty":"50","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as k2 from public.order_lines where style = 'K-2' \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2'),
  '[{"style":"Q-1","qty":"40","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord2 \gset
select id as q1 from public.order_lines where style = 'Q-1' \gset

-- Quality passes K-1 and K-2.
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into public.qc_checks (company_id, order_id, line_id, kind, result, checked_on)
select company_id, order_id, id, 'final', 'pass', current_date - 1 from public.order_lines where style in ('K-1', 'K-2');
set role authenticated;

-- 1. The first part (K-1 only) goes: the order stays open, K-2 is still to send.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/1',
  'bill_date', '2026-10-11', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 100, 'purchase_rate', 450, 'sale_rate', 555)))) as d1 \gset
select public.record_dispatch_invoice(:'d1', '{"invoice_no":"SPL/1","invoice_date":"2026-10-11","taxable":55500}');
select public.record_eway_bill(:'d1', '{"no":"123456789012","date":"2026-10-11","path":"c/o/dispatch/d/ewb.pdf"}');
select public.record_shipping(:'d1', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"2026-10-12","lr_path":"lr.pdf","photos":["p1.jpg"]}');
do $$ begin
  if (select status from public.orders where buyer_po = 'AH-1') <> 'open' then raise exception 'closed after only a part was sent'; end if;
end $$;

-- 2. The last part goes: invoiced is not enough, it closes once the transport is in.
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/2',
  'bill_date', '2026-10-13', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k2', 'qty', 50, 'purchase_rate', 450, 'sale_rate', 555)))) as d2 \gset
select public.record_dispatch_invoice(:'d2', '{"invoice_no":"SPL/2","invoice_date":"2026-10-13","taxable":27750}');
select public.record_eway_bill(:'d2', '{"no":"123456789013","date":"2026-10-13","path":"c/o/dispatch/d/ewb2.pdf"}');
do $$ begin
  if (select status from public.orders where buyer_po = 'AH-1') <> 'open' then raise exception 'closed before the last part was sent'; end if;
end $$;
select public.record_shipping(:'d2', '{"transporter":"VRL","lr_no":"LR-2","lr_date":"2026-10-14","lr_path":"lr2.pdf","photos":["p2.jpg"]}');
do $$ begin
  if (select status || '|' || closed_note from public.orders where buyer_po = 'AH-1') <> 'shipped|Closed by itself: everything billed and sent by 14 Oct 2026.' then
    raise exception 'order did not close itself: %', (select status || '|' || coalesce(closed_note, '') from public.orders where buyer_po = 'AH-1');
  end if;
end $$;

-- 3. The owner sends goods with no final QC on record: the order waits for Quality, then closes when it passes.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.record_purchase(jsonb_build_object('order_id', :'ord2', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/3',
  'bill_date', '2026-10-13', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'q1', 'qty', 40, 'purchase_rate', 450, 'sale_rate', 555)))) as d3 \gset
select public.record_dispatch_invoice(:'d3', '{"invoice_no":"SPL/3","invoice_date":"2026-10-13","taxable":22200}');
select public.record_eway_bill(:'d3', '{"no":"123456789014","date":"2026-10-13","path":"c/o/dispatch/d/ewb3.pdf"}');
select public.record_shipping(:'d3', '{"transporter":"VRL","lr_no":"LR-3","lr_date":"2026-10-14","lr_path":"lr3.pdf","photos":["p3.jpg"]}');
do $$ begin
  if (select status from public.orders where buyer_po = 'AH-2') <> 'open' then raise exception 'closed with no final QC'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into public.qc_checks (company_id, order_id, line_id, kind, result, notes, checked_on)
select company_id, order_id, id, 'final', 'fail', 'Loose threads', current_date - 1 from public.order_lines where style = 'Q-1';
do $$ begin
  if (select status from public.orders where buyer_po = 'AH-2') <> 'open' then raise exception 'closed on a failed QC'; end if;
end $$;
insert into public.qc_checks (company_id, order_id, line_id, kind, result, checked_on)
select company_id, order_id, id, 'recheck', 'pass', current_date from public.order_lines where style = 'Q-1';
do $$ begin
  if (select status from public.orders where buyer_po = 'AH-2') <> 'shipped' then raise exception 'did not close once Quality passed it'; end if;
end $$;

-- 4. Held emails: a phone bill is set aside, a PO from a new sender keeps waiting for the owner.
reset role;
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, status, sender_unknown, files)
select id, 'email', 'm1', 'ebill@airtel.com', 'Your Airtel Mobile Bill for Nov''26', 'held', true, '[{"name":"bill.pdf"}]'::jsonb from public.companies
union all select id, 'email', 'm2', 'new@buyer.com', 'Order for winter', 'held', true, '[{"name":"PO 4471.pdf"}]'::jsonb from public.companies
union all select id, 'email', 'm3', 'new2@buyer.com', 'New order AW27', 'held', true, '[{"name":"styles.xlsx"}]'::jsonb from public.companies;
-- The migration's one-time step, run again on these rows.
update public.incoming_pos i set status = 'not_po', closed_at = now()
where i.status = 'held'
  and concat_ws(' ', i.email_subject, (select string_agg(f ->> 'name', ' ') from jsonb_array_elements(coalesce(i.files, '[]'::jsonb)) f))
      !~* '(^|[^a-z])(p\.?\s?o''?s?|purchase\s*orders?|new\s*orders?)([^a-z]|$)';
do $$ begin
  if (select string_agg(email_id || ':' || status, ',' order by email_id) from public.incoming_pos) <> 'm1:not_po,m2:held,m3:held' then
    raise exception 'held emails not screened right: %', (select string_agg(email_id || ':' || status, ',' order by email_id) from public.incoming_pos);
  end if;
end $$;
