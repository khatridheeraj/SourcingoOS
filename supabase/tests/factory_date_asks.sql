-- Factory asks for a new date (0087): own released styles, steps not done, one open ask, the team agrees or says no.
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
-- Before release nothing can be asked.
select pg_temp.as_user(:'kkora');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date + 20, ''Fabric late'')', :'k_line'), 'You can ask only on your own styles%');
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1';
select set_config('request.jwt.claim.sub', '', false);
-- The factory had planned cutting for day +10 before release; the team's target is day +8. Stitching is done.
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, factory_on)
select company_id, order_id, id, 'cutting', current_date + 8, current_date + 10 from public.order_lines where id = :'k_line';
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on)
select company_id, order_id, id, 'stitching', current_date + 12, current_date from public.order_lines where id = :'k_line';
set role authenticated;

select pg_temp.as_user(:'kkora');
-- Its own fixed date can't be changed directly once released.
select pg_temp.expect_error(format('update public.line_stages set factory_on = current_date + 15 where line_id = %L and stage = ''cutting''', :'k_line'), '%');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date + 20, ''Fabric late'')', :'s_line'), 'You can ask only on your own styles%');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''stitching'', current_date + 20, ''Fabric late'')', :'k_line'), 'That step is already done.');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''nonsense'', current_date + 20, ''Fabric late'')', :'k_line'), 'Pick a step of this style.');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date - 1, ''Fabric late'')', :'k_line'), 'The new date can''t be in the past.');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date + 10, ''Fabric late'')', :'k_line'), 'That is the date it already has.');
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date + 20, ''  '')', :'k_line'), 'Say why the date moves.');
select public.ask_factory_date(:'k_line', 'cutting', current_date + 14, 'Fabric reached us 4 days late') as a1 \gset
select pg_temp.expect_error(format('select public.ask_factory_date(%L, ''cutting'', current_date + 16, ''Again'')', :'k_line'), 'You already asked%');
-- A step with no row yet (finishing) can be asked too; its old date is empty.
select public.ask_factory_date(:'k_line', 'finishing', current_date + 25, 'Washing unit closed for Diwali') as a2 \gset
select pg_temp.expect(jsonb_array_length(public.factory_date_asks_mine()) = 2, 'factory sees its two asks');
select pg_temp.expect((select (x ->> 'old_on')::date = current_date + 10 and x ->> 'agreed' is null from jsonb_array_elements(public.factory_date_asks_mine()) x where x ->> 'id' = :'a1'), 'old date and waiting');
select pg_temp.expect_error(format('select public.answer_factory_date(%L, true, null)', :'a1'), 'Only the orders team can answer%');
select pg_temp.expect_error('insert into public.factory_date_asks (company_id, order_id, line_id, factory_id, stage, new_on, reason) select company_id, order_id, id, factory_id, ''cutting'', current_date, ''abc'' from public.order_lines limit 1', 'permission denied%');

-- Shreeji sees none of Kkora's.
select pg_temp.as_user(:'shreeji');
select pg_temp.expect(jsonb_array_length(public.factory_date_asks_mine()) = 0, 'other factory sees nothing');

-- The team reads them, agrees to one and says no to the other.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.factory_date_asks where answered_at is null) = 2, 'team reads the open asks');
select pg_temp.expect(public.answer_factory_date(:'a1', true, null), 'agreed');
select pg_temp.expect((select factory_on = current_date + 14 and planned_on = current_date + 8 from public.line_stages where line_id = :'k_line' and stage = 'cutting'), 'factory date moved, target kept');
select pg_temp.expect_error(format('select public.answer_factory_date(%L, false, null)', :'a1'), 'Someone already answered%');
select pg_temp.expect(not public.answer_factory_date(:'a2', false, 'Ship date is fixed. Use the second unit.'), 'said no');
select pg_temp.expect((select factory_on is null from public.style_steps(:'k_line') where stage = 'finishing'), 'no date moved on no');
-- The team still can't move a released factory date by hand.
select pg_temp.expect_error(format('update public.line_stages set factory_on = current_date + 30 where line_id = %L and stage = ''cutting''', :'k_line'), '%');

-- Factory sees both answers; it may ask again on the step it was refused.
select pg_temp.as_user(:'kkora');
select pg_temp.expect((select x ->> 'agreed' = 'false' and x ->> 'answer' like 'Ship date is fixed%' from jsonb_array_elements(public.factory_date_asks_mine()) x where x ->> 'id' = :'a2'), 'factory sees the no and why');
select public.ask_factory_date(:'k_line', 'finishing', current_date + 22, 'Second unit, 3 days sooner') is not null;

reset role;
\echo factory_date_asks: ok
