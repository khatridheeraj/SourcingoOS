-- Factory Record (0094): facts earned from real orders, a verification visit, and who may read which factory.
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
-- Final checks: Kkora's AV-142 failed first then passed; ZL-1 passed first time; one cancelled check doesn't count.
insert into public.qc_checks (company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes, cancelled_at, cancel_reason) values
  (:'co', :'o1', :'k_line', 'final', current_date - 3, 'fail', 80, 8, 'Open seams', null, null),
  (:'co', :'o1', :'k_line', 'final', current_date - 1, 'pass', 80, 2, null, null, null),
  (:'co', :'o2', :'z_line', 'final', current_date - 2, 'pass', 50, 0, null, null, null),
  (:'co', :'o2', :'z_line', 'final', current_date - 5, 'fail', 50, 9, 'Shade', now(), 'Entered by mistake'),
  (:'co', :'o1', :'k_line', 'inline', current_date - 8, 'fail', 20, 5, 'Loose threads', null, null);
-- One shipment on time, one cancelled; a claim against Kkora's ledger.
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/1', :'zl', current_date, 100000) returning id as i1 \gset
insert into public.dispatches (id, company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at, invoice_id, invoiced_at, eway_at, lr_no, lr_path, shipped_at)
values ('40000000-0000-0000-0000-000000000001', :'co', :'o2', '20000000-0000-0000-0000-000000000001', 'PB-1', current_date, 1000, now(), :'i1', now(), now(), 'LR1', 'x/lr1.pdf', now()),
       ('40000000-0000-0000-0000-000000000002', :'co', :'o2', '20000000-0000-0000-0000-000000000001', 'PB-2', current_date, 1000, now(), :'i1', now(), now(), 'LR2', 'x/lr2.pdf', now());
update public.dispatches set cancelled_at = now(), cancel_reason = 'test' where id = '40000000-0000-0000-0000-000000000002';
insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate) values ('40000000-0000-0000-0000-000000000001', :'z_line', :'co', 200, 5);
insert into public.factory_claims (company_id, claim_no, ledger, claim_date, reason, pieces, amount, note, created_by)
values (:'co', 'CL-0001', 'Kkora Fashions LLP', current_date, 'short', 4, 1200, 'Four short', '00000000-0000-0000-0000-00000000000a');
insert into public.factory_date_asks (company_id, order_id, line_id, factory_id, stage, old_on, new_on, reason, created_by)
values (:'co', :'o1', :'k_line', '20000000-0000-0000-0000-000000000001', 'finishing', current_date - 2, current_date + 2, 'Power cut', :'kkora');

set role authenticated;
-- ================================================================ the team reads every factory's facts
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.factory_records() as all_f \gset
select pg_temp.expect(jsonb_array_length(:'all_f'::jsonb) = 2, 'team should see both factories');
select public.factory_records('20000000-0000-0000-0000-000000000001') -> 0 as k \gset
select pg_temp.expect((:'k'::jsonb ->> 'orders')::int = 2 and (:'k'::jsonb ->> 'pieces_ordered')::int = 700, 'orders or pieces wrong: ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'steps_finished')::int = 3 and (:'k'::jsonb ->> 'steps_on_time')::int = 2 and (:'k'::jsonb ->> 'steps_overdue')::int = 1,
  'steps wrong (a step without a target must not count): ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'final_firsts')::int = 2 and (:'k'::jsonb ->> 'final_first_pass')::int = 1,
  'first Final QC wrong (the first of AV-142 failed; a cancelled check does not count): ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'pieces_checked')::int = 210 and (:'k'::jsonb ->> 'defects')::int = 10, 'final defects wrong (inline checks do not count): ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'shipments')::int = 1 and (:'k'::jsonb ->> 'shipments_on_time')::int = 1 and (:'k'::jsonb ->> 'pieces_shipped')::int = 200,
  'shipments wrong (a cancelled shipment does not count): ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'claims')::int = 1 and (:'k'::jsonb ->> 'claim_amount')::numeric = 1200, 'claims wrong: ' || :'k');
select pg_temp.expect((:'k'::jsonb ->> 'date_asks')::int = 1, 'date asks wrong');
select pg_temp.expect(:'k'::jsonb -> 'verified' = 'null'::jsonb, 'not visited yet, so not verified');

-- ================================================================ verifying a factory
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date, true, null, '[]', null)$$, 'Only the owner, a manager, a merchandiser or Quality%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date + 2, true, null, '[]', null)$$, 'Pick the day of the visit%');
select pg_temp.expect_error($$select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date, true, 'UDYAM-12', '[]', null)$$, 'Udyam number looks like%');
select pg_temp.expect_error($$select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date, true, null, '[{"name":"B"}]', null)$$, 'B: give the certificate%');
select pg_temp.expect_error($$select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date, true, null, '[{"name":"GOTS","until":"soon"}]', null)$$, 'GOTS: give the certificate%');
select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date - 30, false, null, '[]', 'First visit') as v_old \gset
select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date - 2, true, 'udyam-rj-17-0012345',
  jsonb_build_array(jsonb_build_object('name', ' GOTS ', 'until', (current_date + 200)::text), jsonb_build_object('name', 'BSCI')), 'Clean floor') as v_new \gset
select public.factory_records('20000000-0000-0000-0000-000000000001') -> 0 -> 'verified' as v \gset
select pg_temp.expect((:'v'::jsonb ->> 'id') = :'v_new' and (:'v'::jsonb ->> 'gst_ok')::boolean and (:'v'::jsonb ->> 'udyam_no') = 'UDYAM-RJ-17-0012345',
  'latest visit not shown, or Udyam not tidied: ' || :'v');
select pg_temp.expect((:'v'::jsonb -> 'certs' -> 0 ->> 'name') = 'GOTS' and (:'v'::jsonb -> 'certs' -> 1 -> 'until') = 'null'::jsonb, 'certificates not tidied: ' || :'v');
-- Taking back the latest visit falls back to the one before; taking it back twice is refused.
select public.cancel_factory_verification(:'v_new');
select pg_temp.expect((public.factory_records('20000000-0000-0000-0000-000000000001') -> 0 -> 'verified' ->> 'id') = :'v_old', 'cancelled visit still counts');
select pg_temp.expect_error(format('select public.cancel_factory_verification(%L)', :'v_new'), 'That visit is already taken back%');
select public.verify_factory('20000000-0000-0000-0000-000000000001', current_date - 1, true, null, '[]', null) as v_new2 \gset
-- Nobody writes the table directly.
select pg_temp.expect_error($$insert into public.factory_verifications (company_id, factory_id, visited_on) select company_id, id, current_date from public.factories limit 1$$, '%permission denied%');

-- ================================================================ the factory reads only its own
select pg_temp.as_user(:'kkora');
select pg_temp.expect(public.factory_records() = '[]'::jsonb, 'a factory login reads every factory');
select pg_temp.expect((public.factory_record_mine() ->> 'factory_id') = '20000000-0000-0000-0000-000000000001', 'the factory does not see its own record');
select pg_temp.expect((select count(*) from public.factory_verifications) = 0, 'a factory reads the visits table');
-- A team member without a preview has no "mine"; with a preview, that factory's.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.factory_record_mine() is null, 'team member sees a factory record without a preview');
select pg_temp.headers('{"x-preview-factory": "20000000-0000-0000-0000-000000000002"}');
select pg_temp.expect((public.factory_record_mine() ->> 'name') = 'Shreeji Arts', 'preview does not show that factory');
select pg_temp.headers('{}');

-- ================================================================ the buyer reads its makers by city, never by name
select pg_temp.as_user(:'areeba');
select public.buyer_factory_records() as b \gset
select pg_temp.expect(jsonb_array_length(:'b'::jsonb) = 2, 'buyer should see two makers on its one open order: ' || :'b');
select pg_temp.expect(:'b'::text not like '%Kkora%' and :'b'::text not like '%Shreeji%' and :'b'::text not like '%2000000%', 'buyer sees a factory name or id');
select pg_temp.expect(:'b'::text not like '%claim%' and :'b'::text not like '%date_asks%' and :'b'::text not like '%Udyam%' and :'b'::text not like '%UDYAM%', 'buyer sees claims, asks or Udyam');
select pg_temp.expect((select count(*) from jsonb_array_elements(:'b'::jsonb) x where x ->> 'city' = 'Jaipur' and x -> 'verified' ->> 'visited_on' = (current_date - 1)::text
  and x -> 'line_ids' = jsonb_build_array(:'k_line')) = 1, 'Kkora''s line missing for the buyer: ' || :'b');
select pg_temp.expect(:'b'::text not like '%' || :'z_line' || '%', 'buyer sees another buyer''s style');
select pg_temp.expect(public.factory_records() = '[]'::jsonb and public.factory_record_mine() is null, 'a buyer reads factory records');

reset role;
select pg_temp.expect(not has_function_privilege('authenticated', 'public.factory_facts(uuid, uuid[])', 'execute'), 'factory_facts is callable from the app');
select pg_temp.expect(not has_function_privilege('anon', 'public.factory_records(uuid)', 'execute'), 'signed-out visitors can read factory records');
select pg_temp.expect(not has_function_privilege('anon', 'public.buyer_factory_records()', 'execute'), 'signed-out visitors can read buyer factory records');

-- ================================================================ approved photos reach the buyer
insert into public.factory_pos (company_id, order_id, factory_id, released_at)
select :'co', :'o1', f, now() from unnest(array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[]) f;
insert into public.step_updates (id, company_id, order_id, line_id, factory_id, stage, done_on, photos) values
  ('50000000-0000-0000-0000-000000000001', :'co', :'o1', :'k_line', '20000000-0000-0000-0000-000000000001', 'packed', current_date, array[:'co' || '/' || :'o1' || '/factory/' || :'k_line' || '/p1.jpg']),
  ('50000000-0000-0000-0000-000000000002', :'co', :'o1', :'k_line', '20000000-0000-0000-0000-000000000001', 'ex_factory', current_date, array[:'co' || '/' || :'o1' || '/factory/' || :'k_line' || '/board.jpg']),
  ('50000000-0000-0000-0000-000000000003', :'co', :'o1', :'s_line', '20000000-0000-0000-0000-000000000002', 'packed', current_date, array[:'co' || '/' || :'o1' || '/factory/' || :'s_line' || '/p3.jpg']);
set role authenticated;
select pg_temp.as_user(:'areeba');
select pg_temp.expect(public.buyer_step_photos() = '[]'::jsonb, 'buyer sees photos nobody has checked');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'o1' || '/factory/' || :'k_line' || '/p1.jpg'), 'buyer opens an unchecked photo');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.review_step_update('50000000-0000-0000-0000-000000000001', true, '', true);
select public.review_step_update('50000000-0000-0000-0000-000000000002', true, '', false);
select public.review_step_update('50000000-0000-0000-0000-000000000003', false, 'Blurry', true);
select pg_temp.as_user(:'areeba');
select public.buyer_step_photos() as ph \gset
select pg_temp.expect(jsonb_array_length(:'ph'::jsonb) = 1 and (:'ph'::jsonb -> 0 ->> 'stage') = 'packed' and (:'ph'::jsonb -> 0 ->> 'line_id') = :'k_line',
  'buyer should see only the confirmed, shared photo: ' || :'ph');
select pg_temp.expect(public.buyer_can_read_photo(:'co' || '/' || :'o1' || '/factory/' || :'k_line' || '/p1.jpg'), 'buyer cannot open an approved photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'o1' || '/factory/' || :'k_line' || '/board.jpg'), 'buyer opens a photo kept inside');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'o1' || '/factory/' || :'s_line' || '/p3.jpg'), 'buyer opens a sent-back photo');
-- The team previewing the buyer's page sees the same.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.headers(format('{"x-preview-buyer": "%s"}', :'ah')::jsonb);
select pg_temp.expect(jsonb_array_length(public.buyer_step_photos()) = 1, 'preview differs from the buyer''s page');
select pg_temp.headers('{}');
reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.buyer_step_photos()', 'execute'), 'signed-out visitors can read step photos');
\echo factory_record: ok
