-- Inquiries (0047), the owner's lock (0048) and style details (0049). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

-- Every order here has the buyer's PO on file, which a factory PO needs before it is released (0060).
create function public.test_order_has_po() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.order_po_files (company_id, order_id, path, file_name, file_type, size_bytes, created_by)
  values (new.company_id, new.id, new.company_id || '/' || new.id || '/po.pdf', 'PO.pdf', 'application/pdf', 1000, null);
  return new;
end $$;
create trigger test_order_has_po after insert on public.orders for each row execute function public.test_order_has_po();

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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fb', 'kkora@factory.in'),
  ('00000000-0000-0000-0000-0000000000fc', 'anya@factory.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
select id as co from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-KZ","real_name":"Kaftanize"}') as kz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.add_factory_member('kkora@factory.in', '20000000-0000-0000-0000-000000000001');
select public.add_factory_member('anya@factory.in', '20000000-0000-0000-0000-000000000002');

-- ================================================================ inquiries
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.inquiries (buyer_id, contact_name, product, est_qty, target_price, merchandiser_id, next_follow_up)
values (:'ah', 'Sana', 'Satin co-ord set', 1200, 640, auth.uid(), current_date) returning id as i1, inquiry_no as n1 \gset
select pg_temp.expect(:'n1' = 'ENQ-0001', 'inquiry numbering did not start at ENQ-0001');
insert into public.inquiries (prospect, product) values ('  Zolo Label  ', 'Cotton kurta') returning id as i2, inquiry_no as n2 \gset
select pg_temp.expect(:'n2' = 'ENQ-0002', 'inquiry numbers do not run on');
select pg_temp.expect((select prospect = 'Zolo Label' from public.inquiries where id = :'i2'), 'the new buyer''s name was not trimmed');
select pg_temp.expect_error($$insert into public.inquiries (product) values ('No buyer')$$, '%inquiries_who%');
select pg_temp.expect_error(format($$update public.inquiries set status = 'lost' where id = '%s'$$, :'i1'), '%inquiries_lost_reason%');
select pg_temp.expect_error(format($$update public.inquiries set inquiry_no = 'ENQ-9' where id = '%s'$$, :'i1'), 'The inquiry number and who logged it%');
select pg_temp.expect_error(format($$update public.inquiries set photos = array['%s/inquiries/%s/a.jpg'] where id = '%s'$$, :'co', :'i2', :'i1'),
  'Those photos belong to another inquiry.');
update public.inquiries set photos = array[:'co' || '/inquiries/' || :'i1' || '/a.jpg'], status = 'quoted', quoted_price = 610 where id = :'i1';
select pg_temp.expect((select status = 'quoted' and status_at > created_at - interval '1 second' from public.inquiries where id = :'i1'), 'quote not saved');
insert into public.inquiry_notes (inquiry_id, body) values (:'i1', 'Sent quote at Rs 610, buyer replies Friday');
select pg_temp.expect_error(format($$insert into public.inquiry_notes (inquiry_id, body, created_by) values ('%s', 'x', '00000000-0000-0000-0000-00000000000a')$$, :'i1'),
  '%row-level security%');
select pg_temp.expect_error($$delete from public.inquiries$$, 'permission denied%');
-- Converting: only into an order of the same buyer, and then it stays converted.
select public.save_order(jsonb_build_object('buyer_id', :'kz', 'buyer_po', 'KZ-1'), '[{"style":"KZ-1","qty":10}]') as kzord \gset
select pg_temp.expect_error(format($$update public.inquiries set status = 'converted', order_id = '%s' where id = '%s'$$, :'kzord', :'i1'),
  'Order SO-0001 is for another buyer than this inquiry.');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-77', 'ship_date', (current_date + 60)::text),
  '[{"style":"AH-1","qty":100,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":200}]') as ord \gset
update public.inquiries set status = 'converted', order_id = :'ord' where id = :'i1';
select pg_temp.expect((select next_follow_up is null from public.inquiries where id = :'i1'), 'a converted inquiry kept its follow-up date');
select pg_temp.expect_error(format($$update public.inquiries set status = 'new', order_id = null where id = '%s'$$, :'i1'), 'ENQ-0001 is already order SO-0002%');
-- A new buyer's inquiry takes the buyer of its order.
update public.inquiries set status = 'converted', order_id = :'kzord' where id = :'i2';
select pg_temp.expect((select buyer_id = :'kz' from public.inquiries where id = :'i2'), 'a new buyer''s inquiry did not take the order''s buyer');
select pg_temp.expect_error(format($$insert into public.inquiries (buyer_id, product, status, order_id) values ('%s', 'Again', 'converted', '%s')$$, :'ah', :'ord'),
  '%inquiries_order_key%');
-- Quality and factories don't see inquiries or their photos.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 0 from public.inquiries), 'Quality reads inquiries');
select pg_temp.expect(not public.can_read_order_file(:'co' || '/inquiries/' || :'i1' || '/a.jpg'), 'Quality reads inquiry photos');
select pg_temp.expect(public.can_read_order_file(:'co' || '/' || :'ord' || '/styles/x/a.jpg'), 'Quality lost style photos');
select pg_temp.expect_error($$insert into public.inquiries (prospect, product) values ('X', 'Y')$$, '%row-level security%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect((select count(*) = 0 from public.inquiries), 'a factory reads inquiries');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.can_read_order_file(:'co' || '/inquiries/' || :'i1' || '/a.jpg'), 'the team can''t read inquiry photos');

-- ================================================================ the owner's lock
select id as l1 from public.order_lines where order_id = :'ord' \gset
select public.save_line_stages(:'ord', (select jsonb_agg(jsonb_build_object('line_id', :'l1', 'stage', s, 'planned_on', current_date + 10 + n::int))
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                    'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n)));
select pg_temp.expect_error(format($$select public.request_po_lock('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'), 'The plan is not complete yet. Missing: AH-1 (factory dates:%');
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);
select pg_temp.expect_error(format($$select public.request_po_lock('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'), 'The plan is not complete yet. Missing: AH-1 (factory dates:%');
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect(public.release_blocker(:'ord', '20000000-0000-0000-0000-000000000001') is null, 'a complete plan still shows a blocker');
-- The merchandiser can't release any more, only send for the lock.
select pg_temp.expect_error(format($$select public.release_factory_po('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'), 'Only the owner locks and releases%');
select pg_temp.expect_error(format($$update public.factory_pos set lock_requested_at = now() where order_id = '%s'$$, :'ord'), 'permission denied%');
select public.request_po_lock(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select lock_requested_at is not null and lock_requested_by = auth.uid() from public.factory_pos where order_id = :'ord'), 'lock request not saved');
select pg_temp.expect_error(format($$select public.send_back_po_lock('%s', '20000000-0000-0000-0000-000000000001', 'no')$$, :'ord'), 'Only the owner can send a plan back.');
-- The morning brief: the owner sees the PO waiting for the lock, the team its due follow-ups.
insert into public.inquiries (prospect, product, merchandiser_id, next_follow_up) values ('Late Co', 'Denim shirt', auth.uid(), current_date - 1) returning id as i9 \gset
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.brief_data() -> 'inquiries_due') e where e ->> 'id' = :'i9'), 'the brief misses a late follow-up');
select pg_temp.expect(jsonb_array_length(public.brief_data() -> 'locks') = 0, 'the team''s brief shows POs waiting for the owner');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.brief_data() -> 'locks') e where e ->> 'order_id' = :'ord'), 'the owner''s brief misses the PO waiting for the lock');
select pg_temp.expect(public.brief_data() ? 'team_notes', 'the owner''s brief lost the team notes');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
-- The owner sends it back with a reason, the team sends it again, the owner locks.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.send_back_po_lock('%s', '20000000-0000-0000-0000-000000000001', ' ')$$, :'ord'), 'Say what to change%');
select public.send_back_po_lock(:'ord', '20000000-0000-0000-0000-000000000001', 'Rate looks high, check with Kkora');
select pg_temp.expect((select lock_requested_at is null and lock_note = 'Rate looks high, check with Kkora' from public.factory_pos where order_id = :'ord'), 'send back not saved');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select e ->> 'note' = 'Rate looks high, check with Kkora' from jsonb_array_elements(public.brief_data() -> 'locks') e), 'the team''s brief misses the plan sent back');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.request_po_lock(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select lock_note is null from public.factory_pos where order_id = :'ord'), 'the owner''s note stayed after sending again');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.release_factory_po(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select released_by = auth.uid() from public.factory_pos where order_id = :'ord'), 'the owner''s lock did not release the PO');
select pg_temp.expect((select count(*) = 15 from public.line_stages where line_id = :'l1' and baseline_on is not null), 'the lock set no baseline');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.request_po_lock('%s', '20000000-0000-0000-0000-000000000001')$$, :'ord'), 'The PO is already released.');

-- ================================================================ style details
select pg_temp.expect_error(format($$select public.save_style_details('%s', 'Satin', '{"S": 40, "M": 50}')$$, :'l1'),
  'The sizes add up to 90 pcs, but the style is 100 pcs.%');
select pg_temp.expect_error(format($$select public.save_style_details('%s', 'Satin', '{"S": 40.5, "M": 59.5}')$$, :'l1'), 'Every size needs%');
select public.save_style_details(:'l1', ' Satin 90 gsm ', '{"S": 40, "M": 60, "L": 0}');
select pg_temp.expect((select fabric = 'Satin 90 gsm' and sizes = '{"S": 40, "M": 60}'::jsonb from public.order_lines where id = :'l1'), 'style details not saved');
select public.save_style_details(:'l1', '', '{}');
select pg_temp.expect((select fabric is null and sizes is null from public.order_lines where id = :'l1'), 'style details not cleared');
select public.save_style_details(:'l1', 'Satin', '{"S": 100}');
select pg_temp.expect_error(format($$select public.add_line_files('%s', 'tech_pack', '[{"path":"%s/%s/styles/%s/a.pdf"}]')$$, :'l1', :'co', :'ord', :'l1'),
  'Those files didn''t upload properly.%');
select public.add_line_files(:'l1', 'tech_pack', jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/files/' || :'l1' || '/tp.pdf', 'file_name', 'Tech pack.pdf')));
select public.add_line_files(:'l1', 'other', jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/files/' || :'l1' || '/ref.jpg')));
select pg_temp.expect_error($$insert into public.line_files (order_id, line_id, kind, path) select order_id, line_id, kind, path || 'x' from public.line_files limit 1$$, 'permission denied%');
-- Quality can't add files but reads them; the factory reads its own tech pack only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 2 from public.line_files), 'Quality can''t see style files');
select pg_temp.expect_error(format($$select public.save_style_details('%s', 'x', null)$$, :'l1'), 'Only the orders team can change a style.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.factory_line_files())), 'the factory does not get just its tech pack');
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.factory_line_details()) e where e ->> 'line_id' = :'l1'), 'the factory does not get its style''s sizes');
select pg_temp.expect(public.factory_can_read_photo(:'co' || '/' || :'ord' || '/files/' || :'l1' || '/tp.pdf'), 'the factory can''t read its tech pack');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'ord' || '/files/' || :'l1' || '/ref.jpg'), 'the factory reads the team''s references');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fc');
select pg_temp.expect((select count(*) = 0 from jsonb_array_elements(public.factory_line_files())), 'another factory sees the tech pack');
select pg_temp.expect((select count(*) = 0 from jsonb_array_elements(public.factory_line_details())), 'another factory sees the sizes');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'ord' || '/files/' || :'l1' || '/tp.pdf'), 'another factory reads the tech pack');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.remove_line_file((select id from public.line_files where kind = 'tech_pack'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'ord' || '/files/' || :'l1' || '/tp.pdf'), 'a removed tech pack is still readable');
