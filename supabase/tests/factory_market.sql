-- Factory market (0091): the team opens a style, factories quote, the team awards one.
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

-- The team opens Kkora's style to factories (no PO released yet). Defaults: ready by ship - 7.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.market_open(%L, null, null, current_date - 1, null)', :'k_line'), 'Quotes must close%');
select pg_temp.expect_error(format('select public.market_open(%L, -5, null, current_date + 3, null)', :'k_line'), 'Fill the target price%');
select public.market_open(:'k_line', 210, null, current_date + 3, 'Stitch as the approved sample') as m1 \gset
select pg_temp.expect((select ready_by = current_date + 33 from public.market_listings where id = :'m1'), 'ready by ship minus 7');
select pg_temp.expect_error(format('select public.market_open(%L, null, null, current_date + 3, null)', :'k_line'), 'AV-142 is already open to factories.');

-- Factories see it, but not the buyer, and cannot open styles themselves.
select pg_temp.as_user(:'shreeji');
select pg_temp.expect_error(format('select public.market_open(%L, null, null, current_date + 3, null)', :'s_line'), 'Only the orders team%');
select pg_temp.expect((select x ->> 'style' = 'AV-142' and x ->> 'quotes' = '0' and x ->> 'state' = 'open' and x -> 'mine' = 'null'::jsonb
                         and not (x ? 'buyer_rate') and not (x ? 'buyer')
                       from jsonb_array_elements(public.market_list()) x), 'factory sees the open style');
select pg_temp.expect((select count(*) from public.market_listings) = 0, 'factory reads no table rows');
select pg_temp.expect(public.market_open_count() = 1, 'one to quote');
select pg_temp.expect_error(format('select public.market_quote(%L, 0, current_date + 20, null)', :'m1'), 'Fill your price.');
select pg_temp.expect_error(format('select public.market_quote(%L, 200, current_date - 1, null)', :'m1'), 'Pick the day%');
select public.market_quote(:'m1', 205, current_date + 30, 'Own stitching unit, 40 machines') as q_s \gset
select public.market_quote(:'m1', 198, current_date + 28, null) = :'q_s' as same \gset
select pg_temp.expect(:'same', 're-quote updates the same quote');
select pg_temp.expect(public.market_open_count() = 0, 'quoted: nothing left to quote');
select pg_temp.expect((select x -> 'mine' ->> 'rate' = '198' and x ->> 'quotes' = '1' from jsonb_array_elements(public.market_list()) x), 'own quote shows');

select pg_temp.as_user(:'kkora');
select public.market_quote(:'m1', 190, current_date + 31, null) as q_k \gset
select pg_temp.expect((select x ->> 'quotes' = '2' and x -> 'mine' ->> 'rate' = '190' from jsonb_array_elements(public.market_list()) x), 'count only, own price only');
select pg_temp.expect(public.market_withdraw(:'m1'), 'withdraw');
select pg_temp.expect_error(format('select public.market_withdraw(%L)', :'m1'), 'There is no open quote%');
select pg_temp.expect((select x ->> 'quotes' = '1' and x -> 'mine' = 'null'::jsonb from jsonb_array_elements(public.market_list()) x), 'withdrawn quote gone');
select pg_temp.expect_error(format('select public.market_award(%L)', :'q_s'), 'Only the orders team%');

-- The team awards Shreeji: the style takes Shreeji and its price; quotes close.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.market_award(%L)', :'q_k'), 'The factory took this quote back.');
select pg_temp.expect(public.market_award(:'q_s'), 'award');
reset role;
select pg_temp.expect((select factory_id = '20000000-0000-0000-0000-000000000002' and factory_rate = 198 from public.order_lines where id = :'k_line'), 'style moved with price');
set role authenticated;
select pg_temp.expect_error(format('select public.market_award(%L)', :'q_s'), 'This style is already closed%');

select pg_temp.as_user(:'shreeji');
select pg_temp.expect((select x ->> 'state' = 'won' from jsonb_array_elements(public.market_list()) x), 'winner sees won');
select pg_temp.expect_error(format('select public.market_quote(%L, 150, current_date + 20, null)', :'m1'), 'Quotes for this style are closed.');
select pg_temp.as_user(:'kkora');
select pg_temp.expect(jsonb_array_length(public.market_list()) = 0, 'withdrawn factory sees nothing after close');

-- A style on a released factory PO can't be opened; closing without award works.
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.market_open(:'s_line', null, current_date + 20, current_date + 2, null) as m2 \gset
select pg_temp.expect(public.market_close(:'m2'), 'close');
select pg_temp.expect_error(format('select public.market_close(%L)', :'m2'), 'This style is already closed%');
reset role;
update public.order_lines set factory_id = '20000000-0000-0000-0000-000000000001' where id = :'s_line';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.market_open(%L, null, null, current_date + 2, null)', :'s_line'), 'AV-129 is already on a released factory PO.');

reset role;
\echo factory_market: ok
