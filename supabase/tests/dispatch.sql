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
  if (select invoice_due_at - purchased_at from public.dispatches) <> interval '4 hours' then raise exception 'invoice not due in 4 hours'; end if;
end $$;
select pg_temp.expect_error(format($$select public.record_purchase('{"order_id":"%s","factory_id":"20000000-0000-0000-0000-000000000001","bill_no":"kk/9 ","bill_date":"2026-10-11","lines":[{"line_id":"%s","qty":1,"purchase_rate":1}]}')$$, :'ord', :'k1'),
  '%dispatches_bill_key%');

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
  if (select amount::text || '|' || due_date::text from public.invoices where invoice_no = 'SPL/101') <> '58275.00|2026-11-10' then
    raise exception 'invoice not in Payments with its amount and due date';
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
