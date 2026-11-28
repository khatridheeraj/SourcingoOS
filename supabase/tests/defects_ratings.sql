-- Defect analytics and buyer ratings (0109).
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
  ('00000000-0000-0000-0000-00000000000b', 'accounts@sourcingo.in'), ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'accounts' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name, city, tally_ledger) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP', 'Jaipur', 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name, city) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts', 'Sanganer' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-ZL","real_name":"Zolo Label"}') as zl \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":300,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'zl', 'buyer_po', 'ZL-9', 'ship_date', (current_date + 20)::text),
  '[{"style":"ZL-1","qty":200,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o2 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.buyer_link(:'ah') as ah_secret \gset
reset role;
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as areeba from public.members where buyer_id = :'ah' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select id as z_line from public.order_lines where order_id = :'o2' \gset
select company_id as co from public.orders where id = :'o1' \gset
select set_config('request.jwt.claim.sub', '', false);

-- Kkora on SO/172: cutting on time, stitching 3 days late, finishing still open 2 days past target; one step has no target.
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on, not_needed) values
  (:'co', :'o1', :'k_line', 'cutting', current_date - 10, current_date - 11, false),
  (:'co', :'o1', :'k_line', 'stitching', current_date - 6, current_date - 3, false),
  (:'co', :'o1', :'k_line', 'finishing', current_date - 2, null, false),
  (:'co', :'o1', :'k_line', 'printing', null, current_date - 5, false),
  (:'co', :'o2', :'z_line', 'cutting', current_date - 4, current_date - 4, false),
  (:'co', :'o1', :'s_line', 'cutting', current_date - 4, current_date - 1, false);
-- Final checks: Kkora's AV-142 failed first then passed; ZL-1 passed first time; Shreeji's AV-129 inline failed.
insert into public.qc_checks (id, company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes) values
  ('60000000-0000-0000-0000-000000000001', :'co', :'o1', :'k_line', 'final', current_date - 3, 'fail', 80, 14, 'Threads, shade'),
  ('60000000-0000-0000-0000-000000000002', :'co', :'o1', :'k_line', 'final', current_date - 1, 'pass', 80, 2, null),
  ('60000000-0000-0000-0000-000000000003', :'co', :'o2', :'z_line', 'final', current_date - 2, 'pass', 50, 0, null),
  ('60000000-0000-0000-0000-000000000004', :'co', :'o1', :'s_line', 'inline', current_date - 8, 'fail', 20, 5, 'Open seams');
insert into public.qc_checks (id, company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes, cancelled_at, cancel_reason) values
  ('60000000-0000-0000-0000-000000000005', :'co', :'o2', :'z_line', 'final', current_date - 2, 'fail', 50, 40, 'Holes', now(), 'mistake');
insert into public.qc_defects (company_id, check_id, position, defect, pieces, severity, created_by) values
  (:'co', '60000000-0000-0000-0000-000000000001', 1, 'Loose threads', 8, 'minor', '00000000-0000-0000-0000-00000000000c'),
  (:'co', '60000000-0000-0000-0000-000000000001', 2, 'Shade variation', 6, 'major', '00000000-0000-0000-0000-00000000000c'),
  (:'co', '60000000-0000-0000-0000-000000000002', 1, 'loose  threads', 2, 'minor', '00000000-0000-0000-0000-00000000000c'),
  (:'co', '60000000-0000-0000-0000-000000000004', 1, 'Open seam', 5, 'critical', '00000000-0000-0000-0000-00000000000c'),
  (:'co', '60000000-0000-0000-0000-000000000005', 1, 'Hole', 40, 'critical', '00000000-0000-0000-0000-00000000000c');

set role authenticated;
-- ================================================================ defect analytics
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.defect_stats() as s \gset
select pg_temp.expect((:'s'::jsonb -> 'top' -> 0 ->> 'pieces')::int = 10 and (:'s'::jsonb -> 'top' -> 0 ->> 'checks')::int = 2,
  'loose threads should be grouped across spelling and lead: ' || :'s');
select pg_temp.expect(:'s'::text not like '%Hole%', 'a cancelled check counts: ' || :'s');
select pg_temp.expect((select count(*) from jsonb_array_elements(:'s'::jsonb -> 'factories') f where f ->> 'name' = 'Kkora Fashions LLP'
  and (f ->> 'checks')::int = 3 and (f ->> 'failed')::int = 1 and (f ->> 'defects')::int = 16 and f -> 'top' -> 0 ->> 'pieces' = '10') = 1, 'Kkora row wrong: ' || :'s');
select pg_temp.expect((select (k ->> 'checks')::int from jsonb_array_elements(:'s'::jsonb -> 'kinds') k where k ->> 'kind' = 'inline') = 1, 'inline count wrong');
select pg_temp.expect((select sum((m ->> 'firsts')::int) from jsonb_array_elements(:'s'::jsonb -> 'months') m) = 2
  and (select sum((m ->> 'passed')::int) from jsonb_array_elements(:'s'::jsonb -> 'months') m) = 1, 'first-time pass by month wrong: ' || :'s');
select pg_temp.expect(public.defect_stats('20000000-0000-0000-0000-000000000002') -> 'top' -> 0 ->> 'defect' = 'Open seam', 'one factory filter wrong');
select pg_temp.as_user(:'kkora');
select pg_temp.expect(public.defect_stats() is null, 'a factory reads every factory''s defects');
select public.factory_defects_mine() as m \gset
select pg_temp.expect(jsonb_array_length(:'m'::jsonb) = 2 and (:'m'::jsonb -> 0 ->> 'pieces')::int = 10 and :'m'::text not like '%Open seam%', 'factory defects wrong: ' || :'m');
select pg_temp.as_user(:'areeba');
select pg_temp.expect(public.defect_stats() is null and public.factory_defects_mine() = '[]'::jsonb, 'a buyer reads defects');

-- ================================================================ ratings
select pg_temp.expect_error(format('select public.rate_order(%L, 5, null)', :'o1'), 'You can rate this order once its goods have left%');
reset role;
set session_replication_role = replica;
update public.orders set status = 'shipped' where id = :'o1';
set session_replication_role = origin;
set role authenticated;
select pg_temp.as_user(:'areeba');
select pg_temp.expect_error(format('select public.rate_order(%L, 5, null)', :'o2'), 'Only the buyer of this order%');
select pg_temp.expect_error(format('select public.rate_order(%L, 6, null)', :'o1'), 'Pick 1 to 5 stars%');
select public.rate_order(:'o1', 2, 'Shade was off on 40 pieces');
select public.rate_order(:'o1', 3, ' Shade was off, fixed fast ');
select pg_temp.expect((public.buyer_ratings_mine() -> 0 ->> 'score')::int = 3 and public.buyer_ratings_mine() -> 0 ->> 'comment' = 'Shade was off, fixed fast', 'rating not changed');
select pg_temp.expect((select count(*) from public.order_ratings) = 0, 'a buyer reads the ratings table');
select pg_temp.as_user(:'kkora');
select pg_temp.expect_error(format('select public.rate_order(%L, 5, null)', :'o1'), 'Only the buyer of this order%');
select pg_temp.expect(public.factory_rating_mine() is null, 'a factory sees a single buyer''s rating');
select pg_temp.expect(public.factory_ratings() = '[]'::jsonb, 'a factory reads ratings');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.factory_ratings('20000000-0000-0000-0000-000000000002') as fr \gset
select pg_temp.expect(jsonb_array_length(:'fr'::jsonb) = 1 and (:'fr'::jsonb -> 0 ->> 'score')::int = 3, 'Shreeji should carry the SO/172 rating: ' || :'fr');
select pg_temp.expect(jsonb_array_length(public.factory_ratings()) = 2, 'both factories on SO/172 carry its rating');
select id as r1 from public.order_ratings \gset
select public.see_order_rating(:'r1');
select pg_temp.expect((select seen_at is not null from public.order_ratings), 'rating not marked read');
-- Too old to change.
reset role;
update public.order_ratings set created_at = now() - interval '31 days';
set role authenticated;
select pg_temp.as_user(:'areeba');
select pg_temp.expect_error(format('select public.rate_order(%L, 5, null)', :'o1'), 'A rating can be changed for 30 days%');
reset role;
select pg_temp.expect(not has_function_privilege('authenticated', 'public.qc_by_factory(uuid, date)', 'execute'), 'qc_by_factory callable from the app');
select pg_temp.expect(not has_function_privilege('anon', 'public.rate_order(uuid, integer, text)', 'execute'), 'signed-out visitors rate orders');
\echo defects_ratings: ok
