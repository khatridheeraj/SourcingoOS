-- E-way bills taken from Tally. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07'),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/1',
  'bill_date', '2026-10-11', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 50, 'purchase_rate', 450)))) as d1 \gset
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/2',
  'bill_date', '2026-10-11', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 50, 'purchase_rate', 450)))) as d2 \gset

-- 1. Tally already has invoice SPL/101 with its e-way bill when the merchandiser enters the invoice number.
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, eway_bill_no, eway_bill_date, eway_valid_until)
select id, 'g-101', 'Sales', 'sales', 'SPL/101', '2026-10-11', 'Areeba', 29137.5, '331234567890', '2026-10-11', '2026-10-13' from public.companies;
set role authenticated;
select public.record_dispatch_invoice(:'d1', '{"invoice_no":"spl/101 ","invoice_date":"2026-10-11","taxable":27750,"gst":1387.5}');
do $$ begin
  if (select eway_bill_no || '|' || eway_valid_until || '|' || eway_from_tally from public.dispatches where invoice_no = 'spl/101')
     <> '331234567890|2026-10-13|g-101' then raise exception 'e-way bill not taken from Tally at invoicing'; end if;
end $$;

-- 2. The invoice is entered first; the e-way bill arrives with the next Tally read.
select public.record_dispatch_invoice(:'d2', '{"invoice_no":"SPL/102","invoice_date":"2026-10-11","taxable":27750,"gst":1387.5}');
do $$ begin
  if (select eway_at from public.dispatches where invoice_no = 'SPL/102') is not null then raise exception 'e-way bill appeared from nowhere'; end if;
end $$;
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, eway_bill_no)
select id, 'g-102', 'Sales', 'sales', 'SPL/102', '2026-10-12', 'Areeba', 29137.5, null from public.companies;
do $$ begin
  if (select eway_at from public.dispatches where invoice_no = 'SPL/102') is not null then raise exception 'taken without an e-way bill number'; end if;
end $$;
update public.tally_vouchers set eway_bill_no = '331234567891' where guid = 'g-102';
do $$ begin
  if (select eway_bill_no || '|' || eway_bill_date from public.dispatches where invoice_no = 'SPL/102') <> '331234567891|2026-10-12' then
    raise exception 'e-way bill not taken when Tally brought it';
  end if;
end $$;

-- 3. Once taken it isn't changed by a later Tally read, and the goods can ship.
update public.tally_vouchers set eway_bill_no = '999999999999' where guid = 'g-102';
do $$ begin
  if (select eway_bill_no from public.dispatches where invoice_no = 'SPL/102') <> '331234567891' then raise exception 'e-way bill changed after it was taken'; end if;
end $$;
set role authenticated;
select public.record_shipping(:'d2', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"2026-10-12","lr_path":"lr.pdf","photos":["p1.jpg"]}');
