-- E-way bill only when the law asks for one (0132). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-KF","real_name":"Kaftanize"}') as kf \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_order(jsonb_build_object('buyer_id', :'kf', 'buyer_po', 'KF-1'),
  '[{"style":"K-1","qty":"1000","buyer_rate":"500","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"400"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/' || n,
  'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 10, 'purchase_rate', 400, 'sale_rate', 500))))
from generate_series(1, 4) n;
select id as d1 from public.dispatches where purchase_bill_no = 'KK/1' \gset
select id as d2 from public.dispatches where purchase_bill_no = 'KK/2' \gset
select id as d3 from public.dispatches where purchase_bill_no = 'KK/3' \gset
select id as d4 from public.dispatches where purchase_bill_no = 'KK/4' \gset

-- 1. Rs 22,800 + 5% = Rs 23,940: not above Rs 50,000, so the step clears itself and says why.
select public.record_dispatch_invoice(:'d1', '{"invoice_no":"SPL/206","invoice_date":"2026-11-20","taxable":22800,"gst":1140}');
select pg_temp.expect((select eway_at is not null and eway_bill_no is null and eway_skip_by is null
  and eway_skip like 'Not required: the invoice is Rs 23,940 with GST, not above the Rs 50,000 limit for another state%' from public.dispatches where id = :'d1'),
  'a small invoice still asks for an e-way bill: ' || (select coalesce(eway_skip, '-') from public.dispatches where id = :'d1'));
-- Just under Rs 50,000 with GST (47,619 + 5%).
select public.record_dispatch_invoice(:'d4', '{"invoice_no":"SPL/209","invoice_date":"2026-11-20","taxable":47619,"gst":2381}');
select pg_temp.expect((select eway_at is not null from public.dispatches where id = :'d4'), 'Rs 49,999.95 asked for an e-way bill');

-- 2. Rs 60,000 to another state (or nowhere known) needs one.
select public.record_dispatch_invoice(:'d2', '{"invoice_no":"SPL/207","invoice_date":"2026-11-20","taxable":57143,"gst":2857}');
select pg_temp.expect((select eway_at is null from public.dispatches where id = :'d2'), 'Rs 60,000 to another state skipped its e-way bill');
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{}')$$, :'d2'), 'Add the e-way bill first.');
-- The same lot staying in Rajasthan: the Rs 1 lakh limit, and the buyer remembers the place.
select public.set_dispatch_eway(:'d2', 'zone', 'in_state');
select pg_temp.expect((select eway_at is not null and eway_skip like '%Rs 1,00,000 limit for goods staying in Rajasthan%' from public.dispatches where id = :'d2'),
  'in-state lot under Rs 1 lakh still needs an e-way bill');
select pg_temp.expect((select eway_zone = 'in_state' from public.buyers where id = :'kf'), 'buyer did not keep the place');

-- 3. The merchandiser's overrides.
select public.set_dispatch_eway(:'d2', 'needed');
select pg_temp.expect((select eway_at is null and eway_needed from public.dispatches where id = :'d2'), 'asking for an e-way bill did not take');
select public.set_dispatch_eway(:'d2', 'auto');
select pg_temp.expect((select eway_at is not null and not eway_needed from public.dispatches where id = :'d2'), 'back to the rule did not clear');
select public.record_dispatch_invoice(:'d3', '{"invoice_no":"SPL/208","invoice_date":"2026-11-20","taxable":300000,"gst":15000}');
select pg_temp.expect((select eway_at is null from public.dispatches where id = :'d3'), 'Rs 3,15,000 skipped its e-way bill');
select pg_temp.expect_error(format($$select public.set_dispatch_eway('%s', 'not_needed', 'no')$$, :'d3'), 'Say why this lot needs no e-way bill.');
select public.set_dispatch_eway(:'d3', 'not_needed', 'Hand carried by our own staff on foot');
select pg_temp.expect((select eway_at is not null and eway_skip_by is not null and eway_skip = 'Not required: Hand carried by our own staff on foot'
  from public.dispatches where id = :'d3'), 'not-needed reason not kept');
-- A real e-way bill can still be added to a lot that needed none, and replaces the note.
select public.record_eway_bill(:'d1', '{"no":"123456789012","date":"2026-11-20","path":"c/o/dispatch/d/ewb.pdf"}');
select pg_temp.expect((select eway_bill_no = '123456789012' and eway_skip is null from public.dispatches where id = :'d1'), 'e-way bill not added over the note');
select pg_temp.expect_error(format($$select public.set_dispatch_eway('%s', 'needed')$$, :'d1'), 'This lot already has its e-way bill.');

-- 4. Only the owner changes the limits, and lots waiting follow the new limits.
select pg_temp.expect_error($$select public.set_eway_rules('{"home_state":"Rajasthan","inter_state":50000,"in_state":50000,"same_city":50000,"checked_on":"2026-11-28"}')$$,
  'Only the owner can change the e-way bill limits.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.set_eway_rules('{"home_state":"Rajasthan","inter_state":"fifty","in_state":50000,"same_city":50000,"checked_on":"2026-11-28"}')$$,
  'Enter each limit in rupees, like 50000.');
select pg_temp.expect_error($$select public.set_eway_rules('{"home_state":"Rajasthan","inter_state":100000,"in_state":50000,"same_city":50000,"checked_on":"2026-11-28"}')$$,
  'The limits should rise from another state to elsewhere in the state to the same city.');
select public.set_eway_rules('{"home_state":"Rajasthan","inter_state":50000,"in_state":50000,"same_city":200000,"checked_on":"2026-11-28","source":"https://example.gov.in/x"}');
select pg_temp.expect((select eway_at is null from public.dispatches where id = :'d2'), 'a lower limit did not bring back the e-way bill step');
select pg_temp.expect((select eway_at is not null from public.dispatches where id = :'d3'), 'a hand-marked lot changed with the limits');
select pg_temp.expect((select eway_at is not null from public.dispatches where id = :'d4'), 'the Rs 50,000 lot changed');

-- 5. A cleared lot ships without an e-way bill (the owner, so final QC doesn't stand in the way).
select public.record_shipping(:'d4', '{"transporter":"VRL","lr_no":"LR-9","lr_date":"2026-11-21","lr_path":"lr.pdf","photos":["p1.jpg"]}');
select pg_temp.expect((select shipped_at is not null and eway_bill_no is null from public.dispatches where id = :'d4'), 'cleared lot could not ship');

\echo 'E-way bill limits: all checks passed.'
