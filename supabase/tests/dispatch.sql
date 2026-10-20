-- Dispatch rule tests. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;

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
select public.set_buyer_credit_days(:'ah', 30);
select public.set_buyer_grn_days(:'ah', 5);
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07'),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"A-1","qty":"50","buyer_rate":"400","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"332"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as a1 from public.order_lines where style = 'A-1' \gset

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.set_buyer_grn_days('$$ || :'ah' || $$', 3)$$, 'Only the owner can set GRN days.');

-- ---------------------------------------------------------------- 1. purchase
select pg_temp.expect_error(format($$select public.record_purchase('{"order_id":"%s","factory_id":"20000000-0000-0000-0000-000000000001","bill_no":"KK/9","bill_date":"2026-10-11","lines":[{"line_id":"%s","qty":10,"purchase_rate":332}]}')$$, :'ord', :'a1'),
  'Every style must be on this order and made by this factory.');
select pg_temp.expect_error(format($$select public.record_purchase('{"order_id":"%s","factory_id":"20000000-0000-0000-0000-000000000001","bill_no":" ","bill_date":"2026-10-11","lines":[]}')$$, :'ord'),
  'Enter the factory''s bill number.');
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/9',
  'bill_date', '2026-10-11', 'gst', 2250, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 100, 'purchase_rate', 450, 'sale_rate', 555)))) as d1 \gset
do $$ begin
  if (select purchase_taxable from public.dispatches) <> 45000 then raise exception 'purchase value not worked out'; end if;
  -- GST is worked out at 5% (₹555 a piece is under ₹2,500), whatever GST is sent in.
  if (select purchase_gst from public.dispatches) <> 2250 then raise exception 'purchase GST not worked out'; end if;
  if (select invoice_due_at - purchased_at from public.dispatches) <> interval '4 hours' then raise exception 'invoice not due in 4 hours'; end if;
end $$;
select pg_temp.expect_error(format($$select public.record_purchase('{"order_id":"%s","factory_id":"20000000-0000-0000-0000-000000000001","bill_no":"kk/9 ","bill_date":"2026-10-11","lines":[{"line_id":"%s","qty":1,"purchase_rate":1}]}')$$, :'ord', :'k1'),
  'Bill kk/9 of this factory is already on a dispatch.');

-- Steps must go in order.
select pg_temp.expect_error(format($$select public.record_eway_bill('%s', '{"no":"123456789012","date":"2026-10-11","path":"x"}')$$, :'d1'), 'Make the invoice first.');
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{}')$$, :'d1'), 'Add the e-way bill first.');
select pg_temp.expect_error(format($$select public.record_grn('%s', '{}')$$, :'d1'), 'Record the shipping first.');

-- Quality can't do any of it, or see it.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"X","invoice_date":"2026-10-11","taxable":1}')$$, :'d1'),
  'Only the orders team can record dispatches.');
do $$ begin
  if exists (select 1 from public.dispatches) then raise exception 'Quality sees dispatches'; end if;
end $$;

-- ---------------------------------------------------------------- 2. invoice, made by the merchandiser, lands in Payments
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_dispatch_invoice(:'d1', '{"invoice_no":"SPL/101","invoice_date":"2026-10-11","taxable":55500,"gst":2775}');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/102","invoice_date":"2026-10-11","taxable":1}')$$, :'d1'),
  'This dispatch already has its invoice.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  -- No due date of its own: the books work it out from the buyer's credit days.
  if not exists (select 1 from public.invoices where invoice_no = 'SPL/101' and amount = 58275.00 and due_date is null) then
    raise exception 'invoice not in Payments with its amount and no due date';
  end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.cancel_dispatch('%s', 'wrong')$$, :'d1'), 'This dispatch has an invoice. Cancel the invoice in Payments first.');

-- ---------------------------------------------------------------- 3. e-way bill
select pg_temp.expect_error(format($$select public.record_eway_bill('%s', '{"no":"12345","date":"2026-10-11","path":"x"}')$$, :'d1'), 'An e-way bill number has 12 digits.');
select pg_temp.expect_error(format($$select public.record_eway_bill('%s', '{"no":"123456789012","date":"2026-10-11"}')$$, :'d1'), 'Attach the e-way bill.');
select public.record_eway_bill(:'d1', '{"no":"123456789012","date":"2026-10-11","valid_until":"2026-10-14","path":"c/o/dispatch/d/ewb.pdf"}');

-- ---------------------------------------------------------------- 4. shipping needs photos and the LR
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"2026-10-12","lr_path":"x","photos":[]}')$$, :'d1'),
  'Add photos of the goods.');
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"2026-10-12","photos":["p1"]}')$$, :'d1'),
  'Attach the LR copy.');
-- Goods don't ship before Quality passes the final QC of every style in the dispatch.
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"2026-10-12","lr_path":"lr.pdf","photos":["p1"]}')$$, :'d1'),
  'Final QC has not passed for K-1.%');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
-- Dated a day before the recheck: the default date is today in India, a day ahead of the server late at night.
insert into public.qc_checks (company_id, order_id, line_id, kind, result, notes, checked_on) select company_id, order_id, id, 'final', 'fail', 'Loose threads', current_date - 1 from public.order_lines where style = 'K-1';
insert into public.qc_checks (company_id, order_id, line_id, kind, result, checked_on)
select company_id, order_id, id, 'recheck', 'pass', current_date from public.order_lines where style = 'K-1';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_shipping(:'d1', '{"transporter":"VRL","vehicle_no":"rj14 ab 1234","lr_no":"LR-1","lr_date":"2026-10-12","lr_path":"lr.pdf","cartons":10,"photos":["p1.jpg","p2.jpg"]}');
do $$ begin
  if (select grn_due_on::text || '|' || vehicle_no from public.dispatches) <> '2026-10-17|RJ14 AB 1234' then
    raise exception 'GRN not due within the buyer''s GRN days';
  end if;
  if (select count(*) from public.dispatch_photos) <> 2 then raise exception 'photos not saved'; end if;
end $$;
select pg_temp.expect_error(format($$select public.record_eway_bill('%s', '{"no":"123456789013","date":"2026-10-11","path":"x"}')$$, :'d1'),
  'The goods have shipped, so the e-way bill is fixed.');

-- ---------------------------------------------------------------- 5. GRN
select pg_temp.expect_error(format($$select public.record_grn('%s', '{"received_qty":100}')$$, :'d1'), 'Attach the GRN report.');
select public.record_grn(:'d1', '{"path":"grn.pdf","received_qty":98,"notes":"2 short"}');
do $$ begin
  if (select grn_received_qty from public.dispatches) <> 98 then raise exception 'GRN not saved'; end if;
end $$;

-- ---------------------------------------------------------------- a mistaken purchase is cancelled, never deleted
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000002', 'bill_no', 'AN/1',
  'bill_date', '2026-10-11', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'a1', 'qty', 50, 'purchase_rate', 332)))) as d2 \gset
select pg_temp.expect_error(format($$select public.cancel_dispatch('%s', ' ')$$, :'d2'), 'Say why this dispatch is being cancelled.');
select public.cancel_dispatch(:'d2', 'Entered twice');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/103","invoice_date":"2026-10-11","taxable":1}')$$, :'d2'),
  'This dispatch is cancelled.');
do $$ begin
  update public.dispatches set notes = 'x';
  raise exception 'dispatches could be changed directly';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- Tally bills, worked-out GST, and shipping only once bought and billed
reset role;
update public.factories set tally_ledger = 'ANYA (PURCHASE)' where name = 'Anya';
update public.buyers set tally_ledger = 'AREEBA' where id = :'ah';
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, reference, vdate, party, amount)
select id, 'p-an2', 'PURCHASE', 'purchase', '501', 'AN/2', current_date, 'ANYA (PURCHASE)', 17430 from public.companies union all
select id, 'p-an2-old', 'PURCHASE', 'purchase', '77', 'AN/2', current_date - 365, 'ANYA (PURCHASE)', 999 from public.companies union all
select id, 's-104', 'TAX INVOICE', 'sales', 'SPL/104', null, current_date, 'AREEBA', 21000 from public.companies union all
select id, 's-105', 'TAX INVOICE', 'sales', 'SPL/105', null, current_date, 'AREEBA', 20000 from public.companies union all
select id, 's-106', 'TAX INVOICE', 'sales', 'SPL/106', null, current_date, 'SOMEONE ELSE', 5000 from public.companies;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
-- The order's factory bill and the buyer's invoices from Tally, to pick from; not another buyer's, not last year's.
create temp table bills as select public.dispatch_tally_bills(:'ord') as b;
do $$ begin
  if (select string_agg(x ->> 'no' || '=' || (x ->> 'amount')::numeric::int, ',') from bills, jsonb_array_elements(b -> 'purchases') x) <> 'AN/2=17430' then
    raise exception 'purchase bills to pick: %', (select b from bills);
  end if;
  if (select string_agg(x ->> 'no', ',' order by x ->> 'no') from bills, jsonb_array_elements(b -> 'sales') x) <> 'SPL/104,SPL/105' then
    raise exception 'invoices to pick: %', (select b from bills);
  end if;
end $$;
-- Shipping with a style not bought and billed is refused, for the owner too.
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'ord'), 'A-1 has no factory bill and invoice in Dispatch yet.%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'ord'), 'A-1 has no factory bill and invoice in Dispatch yet.%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000002', 'bill_no', 'an/2',
  'bill_date', current_date, 'gst', 1, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'a1', 'qty', 50, 'purchase_rate', 332, 'sale_rate', 400)))) as d3 \gset
reset role;
do $$ begin
  -- 50 x 332 = 16,600 + 5% = 17,430: linked to this year's Tally bill, not last year's.
  if (select (purchase_gst, purchase_tally, purchase_tally_amount) from public.dispatches where purchase_bill_no = 'an/2')
     is distinct from (830.00::numeric(14,2), 'p-an2'::text, 17430.00::numeric(14,2)) then
    raise exception 'purchase not worked out and linked to Tally';
  end if;
end $$;
set role authenticated;
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'ord'), 'Factory bill an/2 has no invoice to the buyer yet.%');
-- The invoice must come to its Tally total; GST is worked out at the styles' rates.
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/105","invoice_date":"%s","taxable":20000}')$$, :'d3', current_date),
  'Invoice SPL/105 is ₹20000% in Tally, but the value here with GST comes to ₹21000.00.%');
select public.record_dispatch_invoice(:'d3', format('{"invoice_no":"spl/104","invoice_date":"%s","taxable":20000,"gst":5}', current_date)::jsonb);
reset role;
do $$ begin
  if (select (invoice_gst, i.amount) from public.dispatches d join public.invoices i on i.id = d.invoice_id where d.purchase_bill_no = 'an/2')
     is distinct from (1000.00::numeric(14,2), 21000.00::numeric(14,2)) then
    raise exception 'invoice GST not worked out or amount not the Tally total';
  end if;
end $$;
set role authenticated;
-- Bought and billed: staff still need A-1's final QC; the owner can close it.
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'ord'), '%passed final QC%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.ship_blocker((select id from public.orders limit 1)) is not null then raise exception 'still blocked when bought and billed'; end if;
end $$;
update public.orders set status = 'shipped' where id = :'ord';
do $$ begin
  if (select status from public.orders limit 1) <> 'shipped' then raise exception 'owner could not ship a bought and billed order'; end if;
end $$;
