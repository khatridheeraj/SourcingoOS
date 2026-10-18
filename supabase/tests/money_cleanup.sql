-- Tests for the money clean-up (0040). Every block either passes quietly or raises.
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
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'), ('00000000-0000-0000-0000-00000000000c'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
select public.set_buyer_credit_days(:'oz', 30);
reset role;
update public.buyers set tally_ledger = 'OZIA RETAIL PVT. LTD.' where id = :'oz';
-- Tally paid invoice T1 by RTGS, and T2 in part; cheque 349911 shows as cleared in Tally under its own number.
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, narration, bills)
select c.id, g, 'Receipt', 'receipt', n, d, 'OZIA RETAIL PVT. LTD.', a, nar, b::jsonb from public.companies c, (values
  ('r1', 'RTGS', current_date - 20, 600, 'RTGS CR-KARB', '[{"name":"T1","amount":600}]'),
  ('r2', 'NEFT', current_date - 10, 400, 'NEFT CR-KARB', '[{"name":"T1","amount":400}]'),
  ('r3', 'NEFT', current_date - 5, 300, 'NEFT CR-KARB', '[{"name":"T2","amount":300}]'),
  ('r4', 'CH.NO.349911', current_date - 3, 500, 'CHQ DEP-MICR CLG 349911', '[{"name":"T3","amount":500}]'),
  ('r5', 'NEFT', current_date - 3, 999, 'NEFT', '[{"name":"T1","amount":999}]')) v (g, n, d, a, nar, b);
-- The last one is on another party's ledger, so it must not count for Ozia.
update public.tally_vouchers set party = 'SOMEONE ELSE' where guid = 'r5';
set role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.save_invoice(jsonb_build_object('invoice_no', 'T1', 'buyer_id', :'oz', 'invoice_date', current_date - 100, 'amount', 1000)) as t1 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'T2', 'buyer_id', :'oz', 'invoice_date', current_date - 100, 'amount', 1000)) as t2 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'T3', 'buyer_id', :'oz', 'invoice_date', current_date - 10, 'amount', 500)) as t3 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '349892', 'cheque_date', current_date - 60, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'t1', 'amount', 1000)))) as c1 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '349893', 'cheque_date', current_date - 60, 'amount', 1000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'t2', 'amount', 1000)))) as c2 \gset
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '349911', 'cheque_date', current_date - 8, 'amount', 500,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'t3', 'amount', 500)))) as c3 \gset
select public.set_cheque_status(array[:'c1'::uuid, :'c2'::uuid, :'c3'::uuid], 'deposited', current_date - 8, null);

-- ---------------------------------------------------------------- what is overdue counts Tally's receipts
select pg_temp.expect((public.buyer_overdue(:'oz') ->> 'overdue_invoices')::int = 1, 'T1 is paid in Tally and T3 is not due, so only T2 is overdue');
select pg_temp.expect((public.buyer_overdue(:'oz') ->> 'amount')::numeric = 700, 'T2 has 700 left after Tally''s 300');
select pg_temp.expect((public.buyer_overdue(:'oz') ->> 'oldest_days')::int = 70 + (public.india_today() - current_date), 'T2 fell due 70 days ago');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.buyer_overdue(:'oz') ->> 'amount' is null and (public.buyer_overdue(:'oz') ->> 'overdue_invoices')::int = 1,
  'the orders team sees the warning but not the amount');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error(format($$select public.buyer_overdue('%s')$$, :'oz'), 'Only the orders team, Accounts and the owner can see this.');
select pg_temp.expect_error(format($$select * from public.invoice_dues((select id from public.companies))$$), 'permission denied%');

-- ---------------------------------------------------------------- settling cheques as Tally shows
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.settle_cheques('[{"id":"%s","status":"paid_other","on":"%s"}]')$$, :'c1', current_date),
  'Only Accounts and the owner can change cheques.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect_error(format($$select public.settle_cheques('[{"id":"%s","status":"bounced"}]')$$, :'c1'),
  'A cheque can only be settled as cleared or paid another way.');
select pg_temp.expect(public.settle_cheques(jsonb_build_array(
  jsonb_build_object('id', :'c1', 'status', 'paid_other', 'on', current_date - 10, 'note', 'Paid another way: RTGS and NEFT (from Tally)'),
  jsonb_build_object('id', :'c3', 'status', 'cleared', 'on', current_date - 3, 'note', 'Cleared: receipt CH.NO.349911 (from Tally)'))) = 2, 'two cheques settled');
select pg_temp.expect((select status = 'paid_other' and paid_other_on = current_date - 10 and cleared_on is null and notes like '%RTGS and NEFT%'
  from public.cheques where id = :'c1'), 'paid another way not recorded with its date and note');
select pg_temp.expect((select status = 'cleared' and cleared_on = current_date - 3 from public.cheques where id = :'c3'), 'cleared not recorded with its date');
-- A cheque paid another way no longer pays its invoice, and can't be set against invoices again.
select pg_temp.expect(public.invoice_covered(:'t1') = 0, 'a cheque paid another way still counts as paying its invoice');
select pg_temp.expect_error(format($$select public.save_cheque(jsonb_build_object('id', '%s', 'buyer_id', '%s', 'cheque_no', '349892',
  'cheque_date', current_date - 60, 'amount', 1000, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', '%s', 'amount', 1000))))$$, :'c1', :'oz', :'t2'),
  'Cheque 349892 is paid another way. Record a new cheque instead.');
-- All or nothing: one bad entry keeps the others unchanged.
select pg_temp.expect_error(format($$select public.settle_cheques('[{"id":"%s","status":"paid_other"},{"id":"%s","status":"paid_other","on":"%s"}]')$$,
  :'c2', :'c2', public.india_today() + 1), 'That date is in the future.');
select pg_temp.expect((select status = 'deposited' from public.cheques where id = :'c2'), 'a refused settle changed a cheque');
-- Accounts can't undo it; the owner can.
select pg_temp.expect_error(format($$select public.set_cheque_status(array['%s'::uuid], 'deposited', null, null)$$, :'c1'),
  'Cheque 349892 was paid another way. Ask the owner to correct it.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_cheque_status(array[:'c1'::uuid], 'deposited', current_date - 8, null);
select pg_temp.expect((select status = 'deposited' and paid_other_on is null from public.cheques where id = :'c1'), 'owner correction kept the paid-another-way date');

-- ---------------------------------------------------------------- the bounced-cheque notice
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect_error(format($$select public.set_cheque_notice('%s', current_date)$$, :'c2'), 'Only a bounced cheque has a legal notice.');
select public.set_cheque_status(array[:'c2'::uuid], 'bounced', current_date - 4, 'Bounced: insufficient funds');
select pg_temp.expect_error(format($$select public.set_cheque_notice('%s', current_date - 5)$$, :'c2'), 'Cheque 349893 bounced on %, so the notice can''t be sent before then.');
select pg_temp.expect_error(format($$select public.set_cheque_notice('%s', public.india_today() + 1)$$, :'c2'), 'That date is in the future.');
select public.set_cheque_notice(:'c2', current_date - 1);
select pg_temp.expect((select notice_sent_on = current_date - 1 from public.cheques where id = :'c2'), 'notice date not kept');
select public.set_cheque_notice(:'c2', null);
select pg_temp.expect((select notice_sent_on is null from public.cheques where id = :'c2'), 'notice date not taken off');
select public.set_cheque_notice(:'c2', current_date);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_cheque_status(array[:'c2'::uuid], 'deposited', current_date - 8, null);
select pg_temp.expect((select notice_sent_on is null from public.cheques where id = :'c2'), 'a cheque no longer bounced kept its notice date');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.set_cheque_notice('%s', current_date)$$, :'c2'), 'Only Accounts and the owner can change cheques.');
