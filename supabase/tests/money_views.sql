-- Money views (0114): buyer currency, invoice rates, cash in hand, margins.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;
create function pg_temp.headers(p jsonb) returns void language sql as $$
  select set_config('request.headers', p::text, false);
$$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'accounts@sourcingo.in'), ('00000000-0000-0000-0000-00000000000d', 'merchandiser@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'accounts' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000d', 'merchandiser' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name, city, tally_ledger) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP', 'Jaipur', 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name, city) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts', 'Sanganer' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-ZL","real_name":"Zolo Label"}') as zl \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'po_date', (current_date - 10)::text, 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"buyer_rate":200,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":120},
    {"style":"AV-129","qty":300,"buyer_rate":100,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":60}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'zl', 'buyer_po', 'ZL-9', 'ship_date', (current_date + 20)::text),
  '[{"style":"ZL-1","qty":200,"buyer_rate":150,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":90}]') as o2 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.factory_link('20000000-0000-0000-0000-000000000002') as s_secret \gset
select public.buyer_link(:'ah') as ah_secret \gset
reset role;
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as shreeji from public.members where factory_id = '20000000-0000-0000-0000-000000000002' \gset
select user_id as areeba from public.members where buyer_id = :'ah' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select id as z_line from public.order_lines where order_id = :'o2' \gset
select company_id as co from public.orders where id = :'o1' \gset
-- Kkora's AV-142 failed then passed; Shreeji's AV-129 not checked yet.
insert into public.qc_checks (company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes) values
  (:'co', :'o1', :'k_line', 'final', current_date - 3, 'fail', 80, 8, 'Open seams'),
  (:'co', :'o1', :'k_line', 'recheck', current_date - 1, 'pass', 80, 2, null);

set role authenticated;

-- Off by default: the owner sees the plan; Accounts records money; the merchandiser can't read money.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

reset role;
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/9', :'ah', current_date - 3, 70000) returning id as inv \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at,
    invoice_id, invoice_no, invoice_taxable, invoiced_at)
  values (:'co', :'o1', '20000000-0000-0000-0000-000000000001', 'KK-1', current_date - 4, 36000, now(), :'inv', 'SPL/9', 58000, now());
set role authenticated;

-- Currency: Accounts sets it; the merchandiser can't.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select public.set_buyer_currency('$$ || :'ah' || $$', 'USD')$$, 'Only Accounts%');
select pg_temp.expect_error($$select public.order_margins()$$, 'Only Accounts%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.set_buyer_currency('$$ || :'ah' || $$', 'XYZ')$$, 'Pick a currency%');
select public.set_buyer_currency(:'ah', 'USD');
select pg_temp.expect_error($$select public.set_invoice_fx('$$ || :'inv' || $$', 'INR', 1)$$, 'Pick the buyer%');
select pg_temp.expect_error($$select public.set_invoice_fx('$$ || :'inv' || $$', 'USD', 88.12345)$$, 'Write the rate%');
select public.set_invoice_fx(:'inv', 'USD', 87.5);
reset role;
select pg_temp.expect((select currency = 'USD' and fx_rate = 87.5 from public.invoices where id = :'inv'), 'rate locked on the invoice');

-- The buyer reads its currency and the locked rate.
select set_config('request.jwt.claim.sub', :'areeba', false);
set role authenticated;
select public.buyer_money() as bm \gset
select pg_temp.expect((:'bm'::jsonb ->> 'currency') = 'USD' and (:'bm'::jsonb -> 'invoices' -> 0 ->> 'fx_rate')::numeric = 87.5, 'buyer sees USD at 87.5');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_invoice_fx(:'inv', null, null);
reset role;
select pg_temp.expect((select currency is null and fx_rate is null from public.invoices where id = :'inv'), 'rate cleared');
set role authenticated;

-- Cash in hand.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_cash_in_hand(1250000.50);
reset role;
select pg_temp.expect((select amount = 1250000.50 and as_of = public.india_today() from public.company_cash), 'cash in hand saved today');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) from public.company_cash) = 0, 'the merchandiser can''t read the bank balance');
select pg_temp.expect_error('select public.set_cash_in_hand(5)', 'Only Accounts%');

-- Margins: SO/172 plans 1.3 L sale against 78,000 cost; Kkora billed 58,000 against 36,000; a refund of 1,000.
reset role;
insert into public.buyer_claims (company_id, claim_no, order_id, line_id, reason, pieces, ask, detail, raised_by, by_buyer, decide_by, decision, amount, decided_at)
  values (:'co', 'BC-0001', :'o1', :'k_line', 'defect', 5, 'refund', 'Holes', '00000000-0000-0000-0000-00000000000a', false, current_date, 'refund', 1000, now());
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.order_margins() as m \gset
select pg_temp.expect((select (e ->> 'refunds')::numeric = 1000 and (e ->> 'missing')::int = 0
   and (select sum((f ->> 'sale')::numeric) = 130000 and sum((f ->> 'cost')::numeric) = 78000
        and sum((f ->> 'billed_sale')::numeric) = 58000 and sum((f ->> 'billed_cost')::numeric) = 36000 from jsonb_array_elements(e -> 'factories') f)
  from jsonb_array_elements(:'m'::jsonb) e where e ->> 'id' = :'o1'), 'plan, billed and refund per order');
\echo money_views: ok
