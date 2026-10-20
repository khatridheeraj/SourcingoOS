-- Tests for the money fixes (0034). Every block either passes quietly or raises.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Clothing"}') as oz \gset
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"NOVA","real_name":"Nova Kids"}') as nv1 \gset
select public.save_buyer('{"code":"BYR-NV","real_name":"Nova"}') as nv2 \gset
select public.set_buyer_credit_days(:'oz', 30);
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'PO1', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'PO2', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-2","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord2 \gset
select id as k1 from public.order_lines where style = 'K-1' \gset

-- ---------------------------------------------------------------- 1. the invoice check reads what other saves just wrote
reset role;
select pg_temp.expect((select provolatile = 'v' from pg_proc where oid = 'public.check_invoice_cover(uuid)'::regprocedure),
  'check_invoice_cover still reads an old snapshot');
set role authenticated;

-- ---------------------------------------------------------------- 6. everyday cheque edits go through in one save
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.save_invoice(jsonb_build_object('invoice_no', 'A1', 'buyer_id', :'oz', 'invoice_date', current_date - 30, 'amount', 700)) as a1 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'A2', 'buyer_id', :'oz', 'invoice_date', current_date - 30, 'amount', 400)) as a2 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'A3', 'buyer_id', :'oz', 'invoice_date', current_date - 30, 'amount', 1000)) as a3 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'B1', 'buyer_id', :'ah', 'invoice_date', current_date - 30, 'amount', 1000)) as b1 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '111', 'cheque_date', current_date + 10, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'a3', 'amount', 1000)))) as c1 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '222', 'cheque_date', current_date + 10, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'a1', 'amount', 600), jsonb_build_object('invoice_id', :'a2', 'amount', 400)))) as c2 \gset

-- Lower the cheque and its split together.
select public.save_cheque(jsonb_build_object('id', :'c1', 'buyer_id', :'oz', 'cheque_no', '111', 'cheque_date', current_date + 10, 'amount', 800,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'a3', 'amount', 800))));
select pg_temp.expect((select amount = 800 from public.cheques where id = :'c1')
  and (select amount = 800 from public.cheque_allocations where cheque_id = :'c1' and removed_at is null), 'lowering a cheque with its split was refused');
-- Move money between the invoices it pays, the raised one listed first.
select public.save_cheque(jsonb_build_object('id', :'c2', 'buyer_id', :'oz', 'cheque_no', '222', 'cheque_date', current_date + 10, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'a1', 'amount', 700), jsonb_build_object('invoice_id', :'a2', 'amount', 300))));
select pg_temp.expect((select string_agg(amount::text, ',' order by amount) from public.cheque_allocations where cheque_id = :'c2' and removed_at is null) = '300.00,700.00',
  're-balancing a split was refused');
-- A split that doesn't fit is still refused, with its reason, and nothing of the save is kept.
select pg_temp.expect_error(format($$select public.save_cheque(jsonb_build_object('id', '%s', 'buyer_id', '%s', 'cheque_no', '111',
  'cheque_date', current_date + 10, 'amount', 500, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', '%s', 'amount', 800))))$$, :'c1', :'oz', :'a3'),
  'Cheque 111 %');
select pg_temp.expect((select amount = 800 from public.cheques where id = :'c1'), 'a refused save changed the cheque');
select pg_temp.expect_error(format($$select public.save_cheque(jsonb_build_object('id', '%s', 'buyer_id', '%s', 'cheque_no', '222',
  'cheque_date', current_date + 10, 'amount', 1000, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', '%s', 'amount', 900))))$$, :'c2', :'oz', :'a2'),
  'Cheques pay ₹900.00 of A2%');
-- Two cheques on one invoice can't pay more than it, however the save is ordered.
select pg_temp.expect_error(format($$select public.save_cheque(jsonb_build_object('buyer_id', '%s', 'cheque_no', '333',
  'cheque_date', current_date, 'amount', 300, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', '%s', 'amount', 300))))$$, :'oz', :'a3'),
  'Cheques pay ₹1100.00 of A3%');
-- Keeping an invoice of the old buyer while moving the cheque is refused.
select pg_temp.expect_error(format($$select public.save_cheque(jsonb_build_object('id', '%s', 'buyer_id', '%s', 'cheque_no', '222',
  'cheque_date', current_date + 10, 'amount', 1000, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', '%s', 'amount', 700))))$$, :'c2', :'ah', :'a1'),
  'Cheque 222 is set against invoices, so its buyer can''t change.');
-- Move an in-hand cheque to the other buyer: the form clears its split.
select public.save_cheque(jsonb_build_object('id', :'c2', 'buyer_id', :'ah', 'cheque_no', '222', 'cheque_date', current_date + 10, 'amount', 1000, 'allocations', '[]'::jsonb));
select pg_temp.expect((select buyer_id = :'ah' from public.cheques where id = :'c2')
  and not exists (select 1 from public.cheque_allocations where cheque_id = :'c2' and removed_at is null), 'moving a cheque to another buyer was refused');
-- And set it against the new buyer's invoice in the same kind of save.
select public.save_cheque(jsonb_build_object('id', :'c2', 'buyer_id', :'ah', 'cheque_no', '222', 'cheque_date', current_date + 10, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'b1', 'amount', 1000))));
select pg_temp.expect(public.invoice_covered(:'b1') = 1000, 'cheque not set against the new buyer''s invoice');

-- ---------------------------------------------------------------- 2. an expired cheque can't be banked
select public.save_invoice(jsonb_build_object('invoice_no', 'E1', 'buyer_id', :'oz', 'invoice_date', current_date - 150, 'amount', 5000)) as e1 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', 'OLD', 'cheque_date', current_date - 120, 'amount', 5000,
  'received_on', current_date - 125, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'e1', 'amount', 5000)))) as old \gset
select pg_temp.expect(public.invoice_covered(:'e1') = 0, 'an expired cheque still pays its invoice');
select pg_temp.expect_error(format($$select public.set_cheque_status(array['%s'::uuid], 'deposited', null, null)$$, :'old'),
  'Cheque OLD expired on % (cheques are valid for 90 days). Ask the buyer for a new cheque.');
select pg_temp.expect_error(format($$select public.set_cheque_status(array['%s'::uuid], 'cleared', null, null)$$, :'old'),
  'Cheque OLD expired on %');
-- The buyer's replacement cheque pays the invoice.
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', 'NEW', 'cheque_date', current_date - 5, 'amount', 5000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'e1', 'amount', 5000)))) as new \gset
select public.set_cheque_status(array[:'new'::uuid], 'deposited', null, null);
select pg_temp.expect(public.invoice_covered(:'e1') = 5000, 'replacement cheque not counted');
-- A cheque really deposited in time can still be recorded with its real date.
select public.save_invoice(jsonb_build_object('invoice_no', 'E2', 'buyer_id', :'oz', 'invoice_date', current_date - 150, 'amount', 2000)) as e2 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', 'LATE', 'cheque_date', current_date - 120, 'amount', 2000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'e2', 'amount', 2000)))) as late \gset
select public.set_cheque_status(array[:'late'::uuid], 'deposited', current_date - 40, null);
select pg_temp.expect((select status = 'deposited' and deposited_on = current_date - 40 from public.cheques where id = :'late'), 'back-dated deposit refused');
-- The owner can still correct anything.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_invoice(jsonb_build_object('invoice_no', 'E3', 'buyer_id', :'oz', 'invoice_date', current_date - 150, 'amount', 1000)) as e3 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', 'OWN', 'cheque_date', current_date - 120, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'e3', 'amount', 1000)))) as own \gset
select public.set_cheque_status(array[:'own'::uuid], 'deposited', null, null);
select pg_temp.expect((select status = 'deposited' from public.cheques where id = :'own'), 'owner could not correct an expired cheque');

-- ---------------------------------------------------------------- 3. saving an invoice keeps its order
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.save_invoice(jsonb_build_object('invoice_no', 'O1', 'buyer_id', :'oz', 'invoice_date', current_date, 'amount', 900, 'order_id', :'ord')) as o1 \gset
select public.save_invoice(jsonb_build_object('id', :'o1', 'invoice_no', 'O1', 'buyer_id', :'oz', 'invoice_date', current_date, 'amount', 900, 'notes', 'checked'));
select pg_temp.expect((select order_id = :'ord' from public.invoices where id = :'o1'), 'saving an invoice cleared its order');
select public.save_invoice(jsonb_build_object('id', :'o1', 'invoice_no', 'O1', 'buyer_id', :'oz', 'invoice_date', current_date, 'amount', 900, 'cancelled', true));
select pg_temp.expect((select order_id = :'ord' and cancelled_at is not null from public.invoices where id = :'o1'), 'cancelling an invoice cleared its order');
select public.save_invoice(jsonb_build_object('invoice_no', 'O2', 'buyer_id', :'oz', 'invoice_date', current_date, 'amount', 900, 'order_id', :'ord')) as o2 \gset
select public.save_invoice(jsonb_build_object('id', :'o2', 'invoice_no', 'O2', 'buyer_id', :'oz', 'invoice_date', current_date, 'amount', 900, 'order_id', ''));
select pg_temp.expect((select order_id is null from public.invoices where id = :'o2'), 'an empty order_id should still unlink the order');

-- ---------------------------------------------------------------- 4. one Tally ledger per buyer and per factory
select public.tally_set_ledger('buyer', :'oz', 'Ozia Clothing');
select pg_temp.expect_error(format($$select public.tally_set_ledger('buyer', '%s', ' Ozia Clothing ')$$, :'ah'),
  'That Tally ledger is already linked to another buyer.');
select public.tally_set_ledger('buyer', :'oz', 'Ozia Clothing');
select public.tally_set_ledger('factory', '20000000-0000-0000-0000-000000000001', 'Kkora Exports');
select pg_temp.expect_error($$select public.tally_set_ledger('factory', '20000000-0000-0000-0000-000000000002', 'Kkora Exports')$$,
  'That Tally ledger is already linked to another factory.');
-- A buyer and a factory may share a ledger name (Tally keeps them apart by group).
select public.tally_set_ledger('buyer', :'ah', 'Kkora Exports');
select public.tally_set_ledger('buyer', :'ah', '');
-- Writing the table directly is refused too.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$update public.buyers set tally_ledger = 'Ozia Clothing' where id = '%s'$$, :'ah'), '%buyers_tally_ledger_key%');

-- Reading Tally links by name only when it can't clash: "Nova" matches both NOVA and Nova, and "Areeba" is
-- already Ozia's ledger (linked by hand), so neither is linked; "Kkora" goes to the factory Kkora... which already
-- has a ledger, so it stays; Anya links.
select public.tally_set_ledger('buyer', :'oz', 'Areeba');
select public.tally_new_key() as key \gset
set role anon;
select set_config('request.jwt.claim.sub', '', false) \g /dev/null
select set_config('t.snap', public.tally_bridge_snapshot(:'key', jsonb_build_object(
  'ledgers', jsonb_build_array(jsonb_build_object('name', 'Areeba', 'parent', 'Sundry Debtors'), jsonb_build_object('name', 'Nova', 'parent', 'Sundry Debtors'),
                               jsonb_build_object('name', 'Anya', 'parent', 'Sundry Creditors'), jsonb_build_object('name', 'Kkora', 'parent', 'Sundry Creditors'))))::text, false) \g /dev/null
reset role;
select pg_temp.expect((current_setting('t.snap')::jsonb ->> 'linked')::int = 1, 'expected only Anya linked, got ' || current_setting('t.snap'));
select pg_temp.expect((select tally_ledger is null from public.buyers where id = :'ah'), 'buyer linked to a ledger another buyer has');
select pg_temp.expect((select count(*) = 0 from public.buyers where tally_ledger = 'Nova'), 'a ledger two buyers match was linked');
select pg_temp.expect((select tally_ledger = 'Anya' from public.factories where name = 'Anya'), 'factory not linked by name');
select pg_temp.expect((select tally_ledger = 'Kkora Exports' from public.factories where name = 'Kkora'), 'a linked factory was relinked');
set role authenticated;

-- ---------------------------------------------------------------- 10. purchase value from the rates as kept
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/10',
  'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 10, 'purchase_rate', '450.125')))) as d0 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select d.purchase_taxable = sum(l.qty * l.purchase_rate) from public.dispatches d join public.dispatch_lines l on l.dispatch_id = d.id
  where d.id = :'d0' group by d.purchase_taxable), 'purchase value differs from pieces times the rates kept');

-- ---------------------------------------------------------------- 5, 11. the dispatch invoice
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select count(*) from (select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001',
  'bill_no', 'KK/' || n, 'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 5, 'purchase_rate', 450))))
  from generate_series(1, 6) n) x;
select id as d1 from public.dispatches where purchase_bill_no = 'KK/1' \gset
select id as d2 from public.dispatches where purchase_bill_no = 'KK/2' \gset
select id as d3 from public.dispatches where purchase_bill_no = 'KK/3' \gset
select id as d4 from public.dispatches where purchase_bill_no = 'KK/4' \gset
select id as d5 from public.dispatches where purchase_bill_no = 'KK/5' \gset
select id as d6 from public.dispatches where purchase_bill_no = 'KK/6' \gset
-- A new number is added to Payments with no due date of its own, so it follows the buyer's credit days.
select public.record_dispatch_invoice(:'d6', '{"invoice_no":"SPL/200","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}');
-- Accounts brought these in from Tally (or typed them) before the dispatch was invoiced.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect((select due_date is null and order_id = :'ord' from public.invoices where invoice_no = 'SPL/200'), 'dispatch invoice froze its due date');
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/114', 'buyer_id', :'oz', 'invoice_date', '2026-10-16', 'amount', 2362.50, 'notes', 'Brought in from Tally')) as t114 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/115', 'buyer_id', :'ah', 'invoice_date', '2026-10-16', 'amount', 2362.50)) as t115 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/116', 'buyer_id', :'oz', 'invoice_date', '2026-10-16', 'amount', 2362.50)) as t116 \gset
select public.save_invoice(jsonb_build_object('id', :'t116', 'invoice_no', 'SPL/116', 'buyer_id', :'oz', 'invoice_date', '2026-10-16', 'amount', 2362.50, 'cancelled', true));
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/117', 'buyer_id', :'oz', 'invoice_date', '2026-10-16', 'amount', 2362.50, 'order_id', :'ord2')) as t117 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
-- Same buyer and amount (within a rupee, any case): the invoice in Payments is used.
select public.record_dispatch_invoice(:'d1', '{"invoice_no":"spl/114","invoice_date":"2026-10-16","taxable":"2250","gst":"112"}');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/114","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}')$$, :'d2'),
  'Invoice SPL/114 is already on another dispatch.%');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/115","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}')$$, :'d2'),
  'Invoice SPL/115 is already in Payments for another buyer.%');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/116","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}')$$, :'d2'),
  'Invoice SPL/116 is in Payments but cancelled.%');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/117","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}')$$, :'d2'),
  'Invoice SPL/117 is already in Payments for another order.%');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/114 ","invoice_date":"2026-10-16","taxable":"2250","gst":"200"}')$$, :'d3'),
  'Invoice SPL/114 is already%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/118', 'buyer_id', :'oz', 'invoice_date', '2026-10-16', 'amount', 3000)) as t118 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.record_dispatch_invoice('%s', '{"invoice_no":"SPL/118","invoice_date":"2026-10-16","taxable":"2250","gst":"112.5"}')$$, :'d3'),
  'Invoice SPL/118 is already in Payments for ₹3000.00, but the value here with GST comes to ₹2363. Check the value before GST.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select d.invoice_id = :'t114' and d.invoice_no = 'SPL/114' and d.invoiced_at is not null from public.dispatches d where d.id = :'d1'),
  'dispatch not linked to the invoice already in Payments');
select pg_temp.expect((select order_id = :'ord' and notes = 'Brought in from Tally' from public.invoices where id = :'t114'), 'linked invoice did not get its order');
select pg_temp.expect((select count(*) = 1 from public.invoices where lower(invoice_no) = 'spl/114'), 'invoice added twice');
select pg_temp.expect((select invoice_id is null from public.dispatches where id in (:'d2', :'d3') group by invoice_id is null), 'a refused dispatch got an invoice');
