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
select company_id as co from public.orders where id = :'ord' \gset

-- Quality numbers sheets in order; the orders team can't.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.reserve_comment_sheet_ref() as r1 \gset
select public.reserve_comment_sheet_ref() as r2 \gset
select pg_temp.expect(:'r1' = 'SG-SCS-' || to_char(current_date, 'YYYY') || '-0001' and :'r2' like '%-0002', 'refs not numbered in order: ' || :'r1' || ', ' || :'r2');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.reserve_comment_sheet_ref()$$, '%Only the Quality team%');

-- The sheet sits on a check Quality recorded (record_qc, with the PDF as the report).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.record_qc(:'ord', jsonb_build_object('id', '30000000-0000-0000-0000-000000000001', 'line_id', :'line', 'kind', 'pp_sample', 'result', 'fail', 'notes', 'SG-SCS …'),
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/30000000-0000-0000-0000-000000000001/sheet.pdf', 'kind', 'report', 'file_name', 'sheet.pdf'))) as chk \gset
select public.save_comment_sheet('30000000-0000-0000-0000-000000000001', jsonb_build_object('ref_no', :'r1', 'stage', 'pp', 'size', ' M ', 'verdict', 'not_approved',
  'summary', '1 point to correct.', 'next_step', 'resubmit.', 'rows', '[{"area":" Fusing ","observation":"Requirement: no fusing on collar band.","correction":"Do not apply fusing to the collar band."}]'::jsonb)) as sheet \gset
select pg_temp.expect((select ref_no || '|' || size || '|' || (rows -> 0 ->> 'area') from public.qc_comment_sheets where id = :'sheet') = :'r1' || '|M|Fusing', 'sheet not saved as sent');
select pg_temp.expect((select order_id = :'ord' and line_id = :'line' and verdict = 'not_approved' from public.qc_comment_sheets where id = :'sheet'), 'sheet not tied to the check''s order and style');
-- One sheet per check, a ref used once, and every point complete.
select pg_temp.expect_error($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000001', '{"ref_no":"SG-SCS-2026-0009","stage":"pp","verdict":"approved","summary":"ok","next_step":"go","rows":[{"area":"A","observation":"x","correction":"y"}]}')$$, '%duplicate key%');
select public.record_qc(:'ord', jsonb_build_object('id', '30000000-0000-0000-0000-000000000002', 'line_id', :'line', 'kind', 'fit_sample', 'result', 'pass', 'notes', 'x'),
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/30000000-0000-0000-0000-000000000002/s.pdf', 'kind', 'report', 'file_name', 's.pdf'))) as chk2 \gset
select pg_temp.expect_error(format($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000002', '{"ref_no":"%s","stage":"fit","verdict":"approved","summary":"ok","next_step":"go","rows":[{"area":"A","observation":"x","correction":"y"}]}')$$, :'r1'), '%duplicate key%');
select pg_temp.expect_error($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000002', '{"ref_no":"SG-SCS-2026-0009","stage":"fit","verdict":"approved","summary":"ok","next_step":"go","rows":[{"area":"A","observation":"x","correction":" "}]}')$$, '%write the correction%');
select pg_temp.expect_error($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000002', '{"ref_no":"SG-SCS-2026-0009","stage":"fit","verdict":"approved","summary":"ok","next_step":"go","rows":[]}')$$, '%between 1 and 40%');
select pg_temp.expect_error($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000002', '{"ref_no":"bad","stage":"fit","verdict":"approved","summary":"ok","next_step":"go","rows":[{"area":"A","observation":"x","correction":"y"}]}')$$, '%check constraint%');
-- The orders team reads sheets but can't write them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.qc_comment_sheets) = 1, 'the team cannot read the sheet');
select pg_temp.expect_error($$select public.save_comment_sheet('30000000-0000-0000-0000-000000000002', '{"ref_no":"SG-SCS-2026-0009","stage":"fit","verdict":"approved","summary":"ok","next_step":"go","rows":[{"area":"A","observation":"x","correction":"y"}]}')$$, '%Only the Quality team%');
select pg_temp.expect_error($$insert into public.qc_comment_sheets (company_id, check_id, order_id, line_id, ref_no, stage, verdict, summary, next_step, rows) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'SG-SCS-2026-0009', 'fit', 'approved', 'x', 'y', '[{}]')$$, '%permission denied%');
reset role;
