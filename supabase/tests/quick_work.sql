-- Quick work (0057): factory and rate from the start sheet, closing an order shipped before the app, chases.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Shree');
-- A new order with no factory or rate, and an old order that shipped in July with nothing in Dispatch.
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-1', 'ship_date', (current_date + 40)::text),
  '[{"style":"DRESS","qty":600},{"style":"KURTA","qty":400}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-OLD', 'ship_date', (current_date - 80)::text),
  '[{"style":"OLD","qty":100,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":200}]') as old \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-RECENT', 'ship_date', (current_date - 3)::text),
  '[{"style":"NEW","qty":100,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":200}]') as recent \gset
select id as dress from public.order_lines where order_id = :'o1' and style = 'DRESS' \gset
select id as kurta from public.order_lines where order_id = :'o1' and style = 'KURTA' \gset

-- ================================================================ factory and rate
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_style_factory(:'o1', jsonb_build_array(
  jsonb_build_object('line_id', :'dress', 'factory_id', '20000000-0000-0000-0000-000000000001', 'factory_rate', '₹ 1,250'),
  jsonb_build_object('line_id', :'kurta', 'factory_id', '20000000-0000-0000-0000-000000000001')));
select pg_temp.expect((select p.factory_rate = 1250 and l.factory_id = '20000000-0000-0000-0000-000000000001' from public.line_prices(array[:'o1'::uuid]) p
  join public.order_lines l on l.id = p.id where p.id = :'dress'), 'the factory and rate were not set');
select pg_temp.expect_error(format($$select public.set_style_factory('%s', '[{"line_id":"%s","factory_rate":"-5"}]')$$, :'o1', :'kurta'), 'A factory rate can''t be below zero%');
select pg_temp.expect_error(format($$select public.set_style_factory('%s', '[{"line_id":"%s","factory_id":"20000000-0000-0000-0000-0000000000ff"}]')$$, :'o1', :'kurta'), 'Pick one of your factories%');
-- Quality can't.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.set_style_factory('%s', '[{"line_id":"%s","factory_rate":"5"}]')$$, :'o1', :'kurta'), 'Only the orders team%');
-- Once the PO is released, the factory and rate are fixed.
reset role;
insert into public.factory_pos (company_id, order_id, factory_id, released_at) select company_id, :'o1', '20000000-0000-0000-0000-000000000001', now() from public.orders where id = :'o1';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.set_style_factory('%s', '[{"line_id":"%s","factory_rate":"99"}]')$$, :'o1', :'kurta'), '%already released%');
select pg_temp.expect_error(format($$select public.set_style_factory('%s', '[{"line_id":"%s","factory_id":"20000000-0000-0000-0000-000000000002"}]')$$, :'o1', :'kurta'), '%already released%');

-- ================================================================ an order shipped before the app
-- Mark shipped still refuses it: nothing in Dispatch.
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'old'), 'Nothing is in Dispatch%');
select pg_temp.expect_error(format($$select public.close_old_order('%s', ' ')$$, :'old'), 'Say how it shipped%');
select pg_temp.expect_error(format($$select public.close_old_order('%s', 'Shipped by road')$$, :'recent'), 'Only an order whose ship date is more than two weeks past%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.close_old_order('%s', 'Shipped by road')$$, :'old'), 'Only the orders team%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.close_old_order(:'old', 'Shipped end of July by road');
select pg_temp.expect((select status = 'shipped' and closed_note = 'Shipped end of July by road' from public.orders where id = :'old'), 'the old order did not close');
select pg_temp.expect_error(format($$select public.close_old_order('%s', 'again')$$, :'old'), 'This order isn''t open any more%');
-- The way round the guard lasts only for that call: the flag can't be set by hand to skip the checks.
select set_config('sourcingo.old_order', 'on', false);
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'recent'), 'Nothing is in Dispatch%');
select set_config('sourcingo.old_order', 'off', false);
-- closed_note can't be written directly.
select pg_temp.expect_error(format($$update public.orders set closed_note = 'x' where id = '%s'$$, :'recent'), 'permission denied%');

-- ================================================================ chases
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.factory_chases (factory_id, order_id) values ('20000000-0000-0000-0000-000000000001', :'o1');
select pg_temp.expect((select count(*) = 1 from public.factory_chases), 'the merchandiser does not see the chase');
select pg_temp.expect_error($$insert into public.factory_chases (factory_id, chased_by) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')$$, '%row-level security%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 0 from public.factory_chases), 'Quality sees chases');
select pg_temp.expect_error($$insert into public.factory_chases (factory_id) values ('20000000-0000-0000-0000-000000000001')$$, '%row-level security%');
