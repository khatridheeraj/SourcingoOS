-- Tests for the app fixes (0035). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ee', 'stranger@elsewhere.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'), ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
select id as co from public.companies \gset

-- ---------------------------------------------------------------- dispatch papers are closed to Quality
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.can_read_order_file(:'co' || '/o1/qc/q1/a.jpg'), 'Quality lost its QC photos');
select pg_temp.expect(public.can_read_order_file(:'co' || '/o1/style/a.jpg'), 'Quality lost the style photos');
select pg_temp.expect(not public.can_read_order_file(:'co' || '/o1/dispatch/d1/eway.pdf'), 'Quality can read dispatch papers');
select pg_temp.expect(not public.can_read_order_file('not-a-company/o1/qc/a.jpg'), 'a folder that is not a company was readable');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.can_read_order_file(:'co' || '/o1/dispatch/d1/eway.pdf'), 'the orders team lost the dispatch papers');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect(public.can_read_order_file(:'co' || '/o1/dispatch/d1/lr.pdf'), 'Accounts lost the dispatch papers');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.can_read_order_file(:'co' || '/o1/dispatch/d1/grn.pdf'), 'the owner lost the dispatch papers');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ee');
select pg_temp.expect(not public.can_read_order_file(:'co' || '/o1/qc/q1/a.jpg'), 'someone outside the company can read its files');

-- ---------------------------------------------------------------- an order's history is found by its own column
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select pg_temp.expect((select count(*) > 0 from public.history where order_id = :'ord' and table_name = 'order_lines'),
  'the style''s history has no order');
select pg_temp.expect((select count(*) = 0 from public.history where order_id is not null and order_id is distinct from coalesce(after ->> 'order_id', before ->> 'order_id')),
  'the history order column does not match the entry');
-- Staff reads use the index, not a scan of the whole history.
reset role;
insert into public.history (company_id, table_name, row_id, action, after)
select :'co', 'line_stages', gen_random_uuid()::text, 'update', jsonb_build_object('order_id', gen_random_uuid())
from generate_series(1, 20000);
analyze public.history;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
create function pg_temp.plan(p_sql text) returns text language plpgsql as $$
declare v text := ''; r record;
begin
  for r in execute 'explain ' || p_sql loop v := v || r."QUERY PLAN" || E'\n'; end loop;
  return v;
end $$;
select pg_temp.expect(pg_temp.plan(format($q$select id from public.history
  where (table_name = 'orders' and row_id = %1$L) or order_id = %1$L order by at desc, id desc limit 100$q$, :'ord')) like '%history_order_idx%',
  'the order page''s history read does not use the index');
