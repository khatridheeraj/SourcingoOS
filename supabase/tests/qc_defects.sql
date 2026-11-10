-- QC defect lists (0090): Quality writes which defects a check found, how many pieces and how serious; saving replaces it.
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
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
reset role;
select id as line from public.order_lines where order_id = :'ord' \gset
insert into public.qc_checks (id, company_id, order_id, line_id, kind, result, pieces_checked, defects, notes, checked_by)
select '30000000-0000-0000-0000-000000000001', company_id, :'ord', :'line', 'final', 'fail', 50, 18, 'Shade and seams', '00000000-0000-0000-0000-0000000000a9' from public.orders where id = :'ord';

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.save_qc_defects('30000000-0000-0000-0000-000000000001',
  '[{"defect":" Loose  threads ","pieces":8,"severity":"minor"},{"defect":"Shade variation","pieces":6,"severity":"major"},{"defect":"Open seam","pieces":4}]') = 3, 'three lines saved');
select pg_temp.expect((select string_agg(defect || ':' || pieces || ':' || severity, ', ' order by position) from public.qc_defects where removed_at is null)
  = 'Loose threads:8:minor, Shade variation:6:major, Open seam:4:major', 'saved in order, spaces tidied, major by default');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"Stain","pieces":51}]')$$, '%more pieces than the 50 checked%');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"Stain","pieces":2},{"defect":"stain","pieces":1}]')$$, '%already on the list%');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"Stain","pieces":"two"}]')$$, '%whole number%');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"  ","pieces":2}]')$$, '%write the defect%');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"Stain","pieces":2,"severity":"huge"}]')$$, '%critical, major or minor%');
select pg_temp.expect_error($$insert into public.qc_defects (company_id, check_id, position, defect, pieces, severity) select company_id, id, 1, 'x', 1, 'minor' from public.qc_checks$$, '%permission denied%');
-- Saving again replaces the list and keeps the old rows.
select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[{"defect":"Shade variation","pieces":10,"severity":"critical"}]');
select pg_temp.expect((select count(*) from public.qc_defects where removed_at is null) = 1, 'one live line');
select pg_temp.expect((select count(*) from public.qc_defects) = 4, 'old lines kept');

-- The merchandiser reads the list but can't write it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.qc_defects where removed_at is null) = 1, 'merchandiser reads defects');
select pg_temp.expect_error($$select public.save_qc_defects('30000000-0000-0000-0000-000000000001', '[]')$$, '%Only Quality%');
reset role;
