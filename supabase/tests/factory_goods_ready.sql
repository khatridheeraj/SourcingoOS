-- Factory goods ready (0088): own released PO, pieces per style, cartons, photos as proof; the team marks it seen.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":500,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.factory_link('20000000-0000-0000-0000-000000000002') as s_secret \gset
reset role;
insert into public.factory_pos (company_id, order_id, factory_id)
select company_id, :'o1', f from public.orders, unnest(array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[]) f where id = :'o1';
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select user_id as shreeji from public.members where factory_id = '20000000-0000-0000-0000-000000000002' \gset
set role authenticated;
select (select company_id from public.orders where id = :'o1') as co \gset
\set kp :co/:o1/factory/:k_line/a.jpg
\set sp :co/:o1/factory/:s_line/b.jpg
-- Before release nothing can be sent.
select pg_temp.as_user(:'kkora');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500)), :'kp'), 'You can send this only for your own released PO.');
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1';
set role authenticated;

select pg_temp.as_user(:'kkora');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'s_line', 'pieces', 500)), :'kp'), 'A style: fill whole pieces%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 1200)), :'kp'), 'AV-142: fill whole pieces%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 'lots')), :'kp'), 'AV-142: fill whole pieces%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 10.5)), :'kp'), 'AV-142: fill whole pieces%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, ''[]'', 10, null, array[%L])', :'o1', :'kp'), 'Fill the pieces ready%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date + 40, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500)), :'kp'), 'Pick the day the goods are ready%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 0, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500)), :'kp'), 'Fill the number of cartons.');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[]::text[])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500))), 'Add at least one photo%');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500)), :'sp'), 'Those photos are not from this PO.');
select pg_temp.expect_error(format('select public.factory_goods_ready(%L, current_date, %L, 10, null, array[%L])', :'o1', jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500), jsonb_build_object('line_id', :'k_line', 'pieces', 1)), :'kp'), 'Each style only once.');
select public.factory_goods_ready(:'o1', current_date + 1, jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 480)), 20, 'Packed in 5-ply cartons', array[:'kp']) as r1 \gset
-- Sending again before Sourcingo sees it replaces the notice.
select public.factory_goods_ready(:'o1', current_date + 1, jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 500)), 21, null, array[:'kp', :'kp']) = :'r1' as same \gset
select pg_temp.expect(:'same', 'resend replaces the waiting notice');
select pg_temp.expect((select x ->> 'cartons' = '21' and x ->> 'photos' = '2' and x ->> 'seen_at' is null and x -> 'lines' -> 0 ->> 'pieces' = '500' from jsonb_array_elements(public.factory_ready_mine()) x), 'factory sees its notice');
select pg_temp.expect_error(format('select public.factory_ready_seen(%L, null)', :'r1'), 'Only the orders team can do that.');
select pg_temp.expect_error('insert into public.factory_ready (company_id, order_id, factory_id, ready_on, lines, cartons, photos) select company_id, order_id, factory_id, current_date, ''[]'', 1, array[''x''] from public.order_lines limit 1', 'permission denied%');

-- Shreeji sees none of it.
select pg_temp.as_user(:'shreeji');
select pg_temp.expect(jsonb_array_length(public.factory_ready_mine()) = 0, 'other factory sees nothing');

-- The team reads it and marks it seen with a word back.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.factory_ready where seen_at is null) = 1, 'team reads the notice');
select pg_temp.expect(public.factory_ready_seen(:'r1', 'Final QC on Friday'), 'seen');
select pg_temp.expect_error(format('select public.factory_ready_seen(%L, null)', :'r1'), 'Someone already marked this seen%');

-- The factory sees Sourcingo's word, and a new notice starts a new row.
select pg_temp.as_user(:'kkora');
select pg_temp.expect((select x ->> 'seen_note' = 'Final QC on Friday' from jsonb_array_elements(public.factory_ready_mine()) x where x ->> 'id' = :'r1'), 'factory sees the word back');
select public.factory_goods_ready(:'o1', current_date, jsonb_build_array(jsonb_build_object('line_id', :'k_line', 'pieces', 20)), 1, 'Balance pieces', array[:'kp']) <> :'r1' as fresh \gset
select pg_temp.expect(:'fresh', 'a second lot is a new notice');

reset role;
\echo factory_goods_ready: ok
