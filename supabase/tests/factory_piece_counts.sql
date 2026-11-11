-- Factory piece counts (0086): its own released garment styles, sane numbers, one count a day, the team reads them.
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
set role authenticated;

-- Nothing can be counted before the PO is released.
select pg_temp.as_user(:'kkora');
select pg_temp.expect_error(format('select public.post_factory_count(%L, 10, 0, 0, null)', :'k_line'), 'You can count only your own styles%');
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1';
set role authenticated;

-- Kkora counts its own style; Shreeji's style is refused; bad numbers are refused.
select pg_temp.as_user(:'kkora');
select public.post_factory_count(:'k_line', 300, 120, 0, 'Second line starts Monday') as c1 \gset
select pg_temp.expect_error(format('select public.post_factory_count(%L, 10, 0, 0, null)', :'s_line'), 'You can count only your own styles%');
select pg_temp.expect_error(format('select public.post_factory_count(%L, 100, 120, 0, null)', :'k_line'), 'Stitched can''t be more than cut.');
select pg_temp.expect_error(format('select public.post_factory_count(%L, 100, 80, 90, null)', :'k_line'), 'Packed can''t be more than stitched.');
select pg_temp.expect_error(format('select public.post_factory_count(%L, 1500, 0, 0, null)', :'k_line'), 'That is more than double%');
select pg_temp.expect_error(format('select public.post_factory_count(%L, null, 0, 0, null)', :'k_line'), 'Fill cut, stitched and packed%');
select pg_temp.expect_error('insert into public.factory_counts (company_id, order_id, line_id, factory_id, cut, stitched, packed) select company_id, order_id, id, factory_id, 1, 0, 0 from public.order_lines limit 1', 'permission denied%');
-- A second count the same day replaces the first.
select public.post_factory_count(:'k_line', 320, 150, 20, null) as c2 \gset
select public.factory_counts_mine() as mine \gset
select pg_temp.expect(jsonb_array_length(:'mine'::jsonb) = 1 and (:'mine'::jsonb -> 0 ->> 'stitched')::int = 150
  and (:'mine'::jsonb -> 0 ->> 'note') is null, 'same-day count not replaced');

-- The team reads it; another factory's panel preview does not show it; the team preview of Kkora does.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.factory_counts) = 1, 'team does not read counts');
select pg_temp.expect_error(format('select public.post_factory_count(%L, 10, 0, 0, null)', :'k_line'), 'You can count only your own styles%');
select pg_temp.headers(jsonb_build_object('x-preview-factory', '20000000-0000-0000-0000-000000000002'));
select pg_temp.expect(jsonb_array_length(public.factory_counts_mine()) = 0, 'other factory sees the count');
select pg_temp.headers(jsonb_build_object('x-preview-factory', '20000000-0000-0000-0000-000000000001'));
select pg_temp.expect(jsonb_array_length(public.factory_counts_mine()) = 1, 'preview does not show the count');
select pg_temp.headers('{}');
-- A factory login can't read the table directly.
select pg_temp.as_user(:'kkora');
select pg_temp.expect((select count(*) from public.factory_counts) = 0, 'factory reads the table');
reset role;
\echo 'factory_piece_counts: ok'
