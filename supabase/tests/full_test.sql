-- Tests for the fixes from the full test of 16 Oct 2026 (0031). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1
-- Only the owner locks and releases a factory PO (0048): the team's release steps below run as the owner.
create function pg_temp.owner_release(p_order uuid, p_factory uuid) returns void language plpgsql as $$
declare
  v_was text := current_setting('request.jwt.claim.sub', true);
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
  perform public.release_factory_po(p_order, p_factory);
  perform set_config('request.jwt.claim.sub', coalesce(v_was, ''), false);
end $$;

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
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fb', 'anya@factory.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'), ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.add_factory_member('anya@factory.in', '20000000-0000-0000-0000-000000000002');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset

-- ---------------------------------------------------------------- the factory's plan, entered by the orders team
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.accept_targets_for_factory('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'),
  'Ask the factory for its plan first%');
select public.save_line_stages(:'ord', (select jsonb_agg(jsonb_build_object('line_id', :'k1', 'stage', s, 'planned_on', current_date + 10 + n::int))
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                    'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n)));
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);
-- Staff still can't type a factory date straight in.
select pg_temp.expect_error(format($$update public.line_stages set factory_on = planned_on where line_id = '%s'$$, :'k1'), 'permission denied%');
select pg_temp.expect_error(format($$select pg_temp.owner_release('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'),
  'The plan is not complete yet. Missing: K-1 (factory dates:%');
-- The factory agreed on the phone: the merchandiser enters the targets as its dates, then releases.
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) = 15 from public.line_stages where factory_on = planned_on), 'factory dates not entered from the targets');
select pg_temp.expect((select plan_entered_by = auth.uid() and factory_sent_at is not null from public.factory_pos where order_id = :'ord'),
  'plan not marked as entered by the orders team');
select pg_temp.owner_release(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect_error(format($$select public.accept_targets_for_factory('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'),
  'The PO is already released.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.accept_targets_for_factory('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'),
  'Only the orders team%');

-- ---------------------------------------------------------------- a factory reads only its own target date
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(public.factory_target(:'ord', '20000000-0000-0000-0000-000000000001') is null, 'another factory read this order''s target date');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.factory_target(:'ord', '20000000-0000-0000-0000-000000000001') = current_date + 53, 'staff lost the target date');

-- ---------------------------------------------------------------- Quality sees no money in dispatch history
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', 'KK/1',
  'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'qty', 100, 'purchase_rate', 450)))) as d1 \gset
select pg_temp.expect((select count(*) > 0 from public.history where table_name = 'dispatches'), 'merchandiser sees no dispatch history');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 0 from public.history where table_name in ('dispatches', 'dispatch_photos')),
  'Quality reads purchase and sale values in dispatch history');

-- ---------------------------------------------------------------- e-way bills only from this invoice's own voucher
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
reset role;
update public.buyers set tally_ledger = 'Areeba' where code = 'BYR-AH';
-- Last year's invoice 57 and another buyer's invoice 57 both carry e-way bills.
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, eway_bill_no)
select id, 'old-57', 'Sales', 'sales', '57', current_date - 365, 'Areeba', 1000, '111111111111' from public.companies union all
select id, 'oth-57', 'Sales', 'sales', '57', current_date, 'Someone Else', 1000, '222222222222' from public.companies;
set role authenticated;
select public.record_dispatch_invoice(:'d1', format('{"invoice_no":"57","invoice_date":"%s","taxable":55500,"gst":2775}', current_date)::jsonb);
select pg_temp.expect((select eway_at is null from public.dispatches where id = :'d1'), 'e-way bill taken from another year''s or buyer''s invoice');
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, eway_bill_no)
select id, 'new-57', 'Sales', 'sales', '57', current_date, 'Areeba', 58275, '333333333333' from public.companies;
set role authenticated;
select pg_temp.expect((select eway_bill_no = '333333333333' from public.dispatches where id = :'d1'), 'e-way bill not taken from the right voucher');

-- ---------------------------------------------------------------- shipping needs a passed final QC
select pg_temp.expect_error(format($$select public.record_shipping('%s', '{"transporter":"VRL","lr_no":"LR-1","lr_date":"%s","lr_path":"lr.pdf","photos":["p1"]}')$$, :'d1', current_date),
  'Final QC has not passed for K-1.%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.record_shipping(:'d1', format('{"transporter":"VRL","lr_no":"LR-1","lr_date":"%s","lr_path":"lr.pdf","photos":["p1"]}', current_date)::jsonb);

-- ---------------------------------------------------------------- cheques
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/900', 'buyer_id', :'ah', 'invoice_date', current_date - 150, 'amount', 1000)) as inv \gset
-- A cheque left in hand past its 90 days can't be banked, so the buyer's replacement may pay the same invoice.
select public.save_cheque(jsonb_build_object('buyer_id', :'ah', 'cheque_no', 'OLD1', 'cheque_date', current_date - 120, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv', 'amount', 1000))));
select public.save_cheque(jsonb_build_object('buyer_id', :'ah', 'cheque_no', 'NEW1', 'cheque_date', current_date - 5, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv', 'amount', 1000)))) as chq \gset
select public.set_cheque_status(array[:'chq'::uuid], 'deposited', current_date - 2);
select pg_temp.expect_error(format($$select public.set_cheque_status(array['%s'::uuid], 'cleared', current_date - 3)$$, :'chq'),
  'Cheque NEW1 was deposited on %, so it can''t clear or bounce before then.');
select public.set_cheque_status(array[:'chq'::uuid], 'cleared', current_date - 1);

-- One credit note Payments can't take doesn't stop the rest coming in from Tally.
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, reference)
select id, 'cn-1', 'Credit Note', 'credit_note', 'CN/1', current_date, 'Areeba', 100, 'SPL/900' from public.companies union all
select id, 'inv-901', 'Sales', 'sales', 'SPL/901', current_date, 'Areeba', 5000, null from public.companies;
set role authenticated;
select set_config('t.imp', public.tally_import(array['cn-1', 'inv-901'])::text, false) \g /dev/null
select pg_temp.expect((current_setting('t.imp')::jsonb ->> 'invoices') = '1' and (current_setting('t.imp')::jsonb -> 'skipped' ->> 0) like 'CN/1: Cheques pay%',
  'one bad credit note stopped the import: ' || current_setting('t.imp'));

-- ---------------------------------------------------------------- the health report
select pg_temp.expect(public.system_health() ? 'tally_read_hours' and public.system_health() ? 'storage_mb', 'health report lacks the new checks');
