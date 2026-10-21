-- Goods with us and the delivery challan (0051). Every block either passes quietly or raises.
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
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fb', 'kkora@factory.in'),
  ('00000000-0000-0000-0000-0000000000fc', 'anya@factory.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
select id as co from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-KZ","real_name":"Kaftanize"}') as kz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.add_factory_member('kkora@factory.in', '20000000-0000-0000-0000-000000000001');
select public.add_factory_member('anya@factory.in', '20000000-0000-0000-0000-000000000002');

select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-77', 'ship_date', (current_date + 60)::text),
  '[{"style":"AH-1","qty":100,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":200}]') as ord \gset
reset role;
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at)
values (:'co', :'ord', '20000000-0000-0000-0000-000000000001', 'K-1', current_date, 20000, now() + interval '4 hours') returning id as d1 \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at, cancelled_at, cancel_reason)
values (:'co', :'ord', '20000000-0000-0000-0000-000000000001', 'K-2', current_date, 1, now() + interval '4 hours', now(), 'test') returning id as d2 \gset
set role authenticated;

-- ================================================================ challan numbers
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.issue_challan(:'d1') = 'DC-0001', 'the first challan is not DC-0001');
select pg_temp.expect(public.issue_challan(:'d1') = 'DC-0001', 'printing again gave a new number');
select pg_temp.expect_error(format($$select public.issue_challan('%s')$$, :'d2'), 'This dispatch was cancelled%');
select pg_temp.expect_error(format($$update public.dispatches set challan_no = 'DC-9' where id = '%s'$$, :'d1'), 'permission denied%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.issue_challan('%s')$$, :'d1'), 'Only the orders team can print%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect_error(format($$select public.issue_challan('%s')$$, :'d1'), 'Only the orders team can print%');

-- ================================================================ addresses
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_buyer_delivery(:'ah', '  Areeba Studio, 14 MI Road, Jaipur 302001  ');
select pg_temp.expect((select delivery_address = 'Areeba Studio, 14 MI Road, Jaipur 302001' from public.buyers where id = :'ah'), 'delivery address not saved');
select pg_temp.expect_error($$select public.set_company_details('x', null)$$, 'Only the owner can change%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.set_buyer_delivery('%s', 'x')$$, :'ah'), 'Only the orders team%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.set_company_details('Sitapura, Jaipur', '08abc')$$, 'That GSTIN doesn''t look right%');
select public.set_company_details('Sitapura, Jaipur', ' 08abcde1234f1z5 ');
select pg_temp.expect((select gstin = '08ABCDE1234F1Z5' and address = 'Sitapura, Jaipur' from public.companies), 'company details not saved');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect((select count(*) = 0 from public.dispatches), 'a factory reads dispatches');
