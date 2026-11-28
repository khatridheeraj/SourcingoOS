-- Shipment tracking (0115): modes, stages, delivered, the buyer view.
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
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/1', :'zl', current_date - 6, 30000) returning id as inv \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at)
  values (:'co', :'o2', '20000000-0000-0000-0000-000000000001', 'KK-0', current_date - 6, 1, now()) returning id as d0 \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at,
    invoice_id, invoiced_at, eway_at, lr_path, shipped_at, lr_date, lr_no)
  values (:'co', :'o2', '20000000-0000-0000-0000-000000000001', 'KK-1', current_date - 6, 18000, now(), :'inv', now(), now(), 'x/lr.pdf',
    now() - interval '5 days', current_date - 5, 'LR1') returning id as d1 \gset
set session_replication_role = replica;
update public.orders set status = 'shipped' where id = :'o2';
set session_replication_role = origin;
set role authenticated;

-- Quality can't keep tracking; the merchandiser can, once the goods have left.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.save_tracking('$$ || :'d1' || $$', 'sea', 'Maersk', 'MSKU1', 'Hamburg', null)$$, 'Only the orders team%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select public.save_tracking('$$ || :'d0' || $$', 'sea', null, null, null, null)$$, 'Add the LR first%');
select pg_temp.expect_error($$select public.save_tracking('$$ || :'d1' || $$', 'boat', null, null, null, null)$$, 'Pick how%');
select pg_temp.expect_error($$select public.save_tracking('$$ || :'d1' || $$', 'sea', null, null, null, current_date - 10)$$, 'The arrival date%');
select public.save_tracking(:'d1', 'sea', ' Maersk ', 'MSKU1234567', 'Hamburg', current_date + 20);
select pg_temp.expect_error($$select public.add_shipment_event('$$ || :'d1' || $$', 'transit', current_date, null, null)$$, 'Pick where%');
select pg_temp.expect_error($$select public.add_shipment_event('$$ || :'d1' || $$', 'departed', current_date + 2, null, null)$$, 'The date is between%');
select public.add_shipment_event(:'d1', 'origin_port', current_date - 4, 'Nhava Sheva', null);
select public.add_shipment_event(:'d1', 'departed', current_date - 3, null, 'Vessel MAERSK ESSEX') as e2 \gset

-- The buyer reads it, without a factory.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.buyer_link(:'zl') as zl_secret \gset
reset role;
select user_id as zolo from public.members where buyer_id = :'zl' \gset
select set_config('request.jwt.claim.sub', :'zolo', false);
set role authenticated;
select public.buyer_shipments() as bs \gset
select pg_temp.expect((:'bs'::jsonb -> 0 ->> 'mode') = 'sea' and (:'bs'::jsonb -> 0 ->> 'carrier') = 'Maersk'
  and jsonb_array_length(:'bs'::jsonb -> 0 -> 'events') = 2 and not (:'bs'::jsonb::text ~ 'Kkora'), 'buyer sees mode, carrier and two updates, no factory');

-- Delivered makes the order delivered for the Guarantee; taking it back undoes that.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.add_shipment_event(:'d1', 'delivered', current_date, 'Hamburg', null) as e3 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (e ->> 'delivered_on')::date = current_date from jsonb_array_elements(public.guarantee_orders() -> 'orders') e
  where e ->> 'order_id' = :'o2'), 'delivered from tracking, before any GRN');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.cancel_shipment_event(:'e3');
reset role;
select pg_temp.expect((select track_delivered_on is null from public.dispatches where id = :'d1'), 'taken back');
select pg_temp.expect((select count(*) = 2 from public.shipment_events where dispatch_id = :'d1' and cancelled_at is null), 'two updates stand');
\echo shipment_tracking: ok
