-- QC results in the factory's panel (0079): its own styles only, no cancelled checks, and its own QC photos to open.
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
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as shreeji from public.members where factory_id = '20000000-0000-0000-0000-000000000002' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select company_id as co from public.orders where id = :'o1' \gset
insert into public.qc_checks (id, company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes, cancelled_at, cancel_reason)
values ('30000000-0000-0000-0000-000000000001', :'co', :'o1', :'k_line', 'inline', current_date - 5, 'fail', 40, 6, 'Loose threads at side seam', null, null),
       ('30000000-0000-0000-0000-000000000002', :'co', :'o1', :'k_line', 'final', current_date - 1, 'pass', 80, 0, null, null, null),
       ('30000000-0000-0000-0000-000000000003', :'co', :'o1', :'k_line', 'midline', current_date - 3, 'pass', 50, 0, null, now(), 'Entered twice'),
       ('30000000-0000-0000-0000-000000000004', :'co', :'o1', :'s_line', 'final', current_date - 1, 'fail', 80, 9, 'Shade variation', null, null);
insert into public.qc_photos (company_id, qc_id, path, kind) values
  (:'co', '30000000-0000-0000-0000-000000000001', :'co' || '/' || :'o1' || '/qc/30000000-0000-0000-0000-000000000001/a.jpg', 'photo'),
  (:'co', '30000000-0000-0000-0000-000000000004', :'co' || '/' || :'o1' || '/qc/30000000-0000-0000-0000-000000000004/b.jpg', 'photo');
insert into public.qc_comments (company_id, qc_id, body) values (:'co', '30000000-0000-0000-0000-000000000001', 'Team only: push them hard');
set role authenticated;

-- Kkora sees its own two live checks, newest first, with the note and photo; not the cancelled one, not Shreeji's.
select pg_temp.as_user(:'kkora');
select public.factory_qc() as q \gset
select pg_temp.expect(jsonb_array_length(:'q'::jsonb) = 2, 'wrong number of checks for Kkora');
select pg_temp.expect((:'q'::jsonb -> 0 ->> 'kind') = 'final' and (:'q'::jsonb -> 1 ->> 'kind') = 'inline', 'checks not newest first');
select pg_temp.expect((:'q'::jsonb -> 1 ->> 'notes') = 'Loose threads at side seam' and (:'q'::jsonb -> 1 ->> 'defects')::int = 6, 'note or defects missing');
select pg_temp.expect(jsonb_array_length(:'q'::jsonb -> 1 -> 'files') = 1, 'photo missing');
select pg_temp.expect(:'q'::text not like '%Shade%' and :'q'::text not like '%Entered twice%' and :'q'::text not like '%Team only%', 'another factory''s check, a cancelled check or a team comment shows');
-- Kkora may open its own QC photo but not Shreeji's.
select pg_temp.expect(public.factory_can_read_photo(:'co' || '/' || :'o1' || '/qc/30000000-0000-0000-0000-000000000001/a.jpg'), 'Kkora cannot open its QC photo');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'o1' || '/qc/30000000-0000-0000-0000-000000000004/b.jpg'), 'Kkora can open Shreeji''s QC photo');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'o1' || '/qc/30000000-0000-0000-0000-000000000001/other.jpg'), 'a path not on a QC photo opens');

-- Shreeji sees only its failed Final QC.
select pg_temp.as_user(:'shreeji');
select pg_temp.expect(jsonb_array_length(public.factory_qc()) = 1 and (public.factory_qc() -> 0 ->> 'result') = 'fail', 'Shreeji''s checks wrong');

-- A team member sees nothing without a preview, and Kkora's checks when previewing Kkora.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.factory_qc() = '[]'::jsonb, 'team member sees factory QC without a preview');
select pg_temp.headers('{"x-preview-factory": "20000000-0000-0000-0000-000000000001"}');
select pg_temp.expect(jsonb_array_length(public.factory_qc()) = 2, 'preview does not show the factory''s checks');
select pg_temp.headers('{}');

reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.factory_qc()', 'execute'), 'signed-out visitors can read factory QC');
