-- QC by style: each style on a PO keeps its own checks, and the PO ships once every style has passed its final.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;
create function pg_temp.qc(p_order uuid, p_line uuid, p_kind text, p_result text, p_on date) returns uuid language sql as $$
  select public.record_qc(p_order, jsonb_build_object('line_id', p_line, 'kind', p_kind, 'result', p_result, 'checked_on', p_on,
    'notes', case when p_result = 'fail' then 'Seam puckering' end),
    jsonb_build_array(jsonb_build_object('path', (select id from public.companies) || '/' || p_order || '/qc/x/' || gen_random_uuid() || '.jpg', 'kind', 'photo'),
                      jsonb_build_object('path', (select id from public.companies) || '/' || p_order || '/qc/x/' || gen_random_uuid() || '.pdf', 'kind', 'report', 'file_name', 'Report 1.pdf'),
                      jsonb_build_object('path', (select id from public.companies) || '/' || p_order || '/qc/x/' || gen_random_uuid() || '.xlsx', 'kind', 'report', 'file_name', 'Report 2.xlsx')))
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'PO-3S'),
  '[{"style":"S-1","qty":"100"},{"style":"S-2","qty":"100"},{"style":"S-3","qty":"100"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'PO-OTHER'), '[{"style":"X-1","qty":"10"}]'::jsonb) as other \gset
select id as s1 from public.order_lines where style = 'S-1' \gset
select id as s2 from public.order_lines where style = 'S-2' \gset
select id as s3 from public.order_lines where style = 'S-3' \gset
select id as x1 from public.order_lines where style = 'X-1' \gset

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
-- The style must be named, and must be on this order.
select pg_temp.expect_error(format($$select public.record_qc('%s', '{"kind":"final","result":"pass"}', '[{"path":"x","kind":"photo"}]')$$, :'ord'),
  'Pick the style this check is for.');
select pg_temp.expect_error(format($$select pg_temp.qc('%s', '%s', 'final', 'pass', '2026-10-10')$$, :'ord', :'x1'), 'That style is not on this order.');

-- Each style keeps its own checks, each with several reports.
select pg_temp.qc(:'ord', :'s1', 'inline', 'pass', '2026-10-08');
select pg_temp.qc(:'ord', :'s1', 'final', 'pass', '2026-10-10');
select pg_temp.qc(:'ord', :'s2', 'final', 'fail', '2026-10-10');
do $$ begin
  if (select count(*) from public.qc_checks q join public.order_lines l on l.id = q.line_id where l.style = 'S-1') <> 2 then raise exception 'S-1 checks not kept apart'; end if;
  if (select count(*) from public.qc_photos where kind = 'report') <> 6 then raise exception 'not every report was kept'; end if;
  if public.final_qc_passed((select order_id from public.order_lines where style = 'S-1')) then raise exception 'shipped with a failed style and an unchecked style'; end if;
end $$;
select pg_temp.qc(:'ord', :'s2', 'recheck', 'pass', '2026-10-11');
do $$ begin
  if public.final_qc_passed((select order_id from public.order_lines where style = 'S-1')) then raise exception 'shipped with S-3 not checked'; end if;
end $$;
select pg_temp.qc(:'ord', :'s3', 'final', 'pass', '2026-10-11') as s3check \gset
do $$ begin
  if not public.final_qc_passed((select order_id from public.order_lines where style = 'S-1')) then raise exception 'every style passed but the PO did not'; end if;
end $$;

-- A later failed final on one style holds the whole PO again.
select pg_temp.qc(:'ord', :'s1', 'final', 'fail', '2026-10-12');
do $$ begin
  if public.final_qc_passed((select order_id from public.order_lines where style = 'S-1')) then raise exception 'a newer failed style final was ignored'; end if;
end $$;

-- The style on a saved check can't be switched; it is cancelled instead.
select pg_temp.expect_error(format($$update public.qc_checks set line_id = '%s' where id = '%s'$$, :'s1', :'s3check'), 'A saved QC check can''t be changed.%');

-- A check from before style-wise QC (no style) still counts for every style on the order.
reset role;
insert into public.qc_checks (company_id, order_id, kind, result, checked_on) select company_id, :'other', 'final', 'pass', '2026-10-01' from public.orders limit 1;
do $$ begin
  if not public.final_qc_passed((select order_id from public.order_lines where style = 'X-1')) then raise exception 'an older whole-order final no longer counted'; end if;
end $$;
