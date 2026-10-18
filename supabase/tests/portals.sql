-- Buyer logins and factory step updates (0032). Every block either passes quietly or raises.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fa', 'kkora@factory.in'),
  ('00000000-0000-0000-0000-0000000000fb', 'anya@factory.in'),
  ('00000000-0000-0000-0000-0000000000b1', 'buy@areeba.in'),
  ('00000000-0000-0000-0000-0000000000b2', 'buy@ozia.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.add_factory_member('kkora@factory.in', '20000000-0000-0000-0000-000000000001');
select public.add_factory_member('anya@factory.in', '20000000-0000-0000-0000-000000000002');
select pg_temp.expect(public.add_buyer_member('buy@areeba.in', :'ah') = 'added', 'buyer login not added');
select pg_temp.expect(public.add_buyer_member('new@ozia.in', :'oz') = 'invited', 'buyer invite not made');
select pg_temp.expect_error(format($$select public.add_buyer_member('merch@sourcingo.in', '%s')$$, :'ah'), 'That person already has another login here%');
select pg_temp.expect_error(format($$select public.add_buyer_member('kkora@factory.in', '%s')$$, :'ah'), 'That person already has another login here%');
select pg_temp.expect_error($$update public.members set role = 'merchandiser' where role = 'buyer'$$, 'A buyer login stays a buyer login%');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"A-1","qty":"50","buyer_rate":"300","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"250"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ1', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"Z-1","qty":"10","buyer_rate":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"80"}]'::jsonb) as ord2 \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as a1 from public.order_lines where style = 'A-1' \gset
select id as z1 from public.order_lines where style = 'Z-1' \gset
select company_id as co from public.orders where id = :'ord' \gset

-- ---------------------------------------------------------------- a buyer login sees only its own orders, through its page
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect(not public.is_member(:'co'), 'a buyer login counts as staff');
select pg_temp.expect((select count(*) = 0 from public.orders), 'a buyer login reads the orders table');
select pg_temp.expect((select count(*) = 0 from public.buyers), 'a buyer login reads the buyers');
select pg_temp.expect((select count(*) = 0 from public.factories), 'a buyer login reads the factories');
select public.buyer_orders() as bo \gset
select pg_temp.expect((:'bo'::jsonb ->> 'buyer') = 'Areeba Fashion House', 'buyer name missing');
select pg_temp.expect(jsonb_array_length(:'bo'::jsonb -> 'orders') = 1, 'buyer sees another buyer''s orders');
select pg_temp.expect(jsonb_array_length(:'bo'::jsonb -> 'orders' -> 0 -> 'lines') = 2, 'buyer misses a style');
select pg_temp.expect(jsonb_array_length(:'bo'::jsonb -> 'orders' -> 0 -> 'lines' -> 0 -> 'steps') = 15, 'buyer misses the steps');
select pg_temp.expect(position('450' in :'bo') = 0 and position('555' in :'bo') = 0 and position('Kkora' in :'bo') = 0,
  'buyer page shows a price or a factory');
-- Only photos on the latest final QC open for a buyer (0039); a path with no QC photo behind it does not.
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/x/p.jpg'), 'buyer opens a QC file that isn''t a final QC photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord2' || '/qc/x/p.jpg'), 'buyer opens another buyer''s photos');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/dispatch/x/p.jpg'), 'buyer opens dispatch papers');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect_error('select public.buyer_orders()', 'This login is not set up for a buyer.');

-- ---------------------------------------------------------------- a factory marks a step done with photos
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_line_stages(:'ord', (select jsonb_agg(jsonb_build_object('line_id', l, 'stage', s, 'planned_on', current_date + 10 + n::int))
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                    'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n), unnest(array[:'k1'::uuid, :'a1'::uuid]) l));
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
-- Not released yet: no updates, no photos.
select pg_temp.expect(not public.can_upload_photo(:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/p.jpg'), 'factory uploads before release');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k1', :'co', :'ord', :'k1'),
  'You can update only your own styles on a released PO.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select public.release_factory_po(:'ord', '20000000-0000-0000-0000-000000000001');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect(public.can_upload_photo(:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/p.jpg'), 'factory can''t upload its photo');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/' || :'ord' || '/factory/' || :'a1' || '/p.jpg'), 'factory uploads to another factory''s style');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/' || :'ord' || '/qc/' || :'k1' || '/p.jpg'), 'factory uploads QC photos');
select pg_temp.expect(public.factory_can_read_photo(:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/p.jpg'), 'factory can''t open its own photo');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'ord' || '/factory/' || :'a1' || '/p.jpg'), 'factory opens another factory''s photo');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'k1' || '/p.jpg'), 'factory opens QC photos');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'a1', :'co', :'ord', :'a1'),
  'You can update only your own styles on a released PO.');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date, '', '{}')$$, :'k1'), 'Add at least one photo of the work.');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date + 1, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k1', :'co', :'ord', :'k1'),
  'Give the date the step was done%');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k1', :'co', :'ord', :'a1'),
  'Those photos are not from this style.');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'embroidery', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k1', :'co', :'ord', :'k1'),
  'That step is not on this style.');
select public.post_step_update(:'k1', 'greige', current_date, 'first try', array[:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/p.jpg']) as u1 \gset
-- Sending again replaces the waiting update.
select public.post_step_update(:'k1', 'greige', current_date - 1, 'all greige in', array[:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/p.jpg',
  :'co' || '/' || :'ord' || '/factory/' || :'k1' || '/q.jpg']) as u2 \gset
select pg_temp.expect(:'u1' = :'u2', 'a second update made a second waiting row');
select pg_temp.expect((select count(*) = 0 from public.step_updates), 'a factory reads the updates table directly');
select pg_temp.expect(jsonb_array_length(public.factory_step_updates()) = 1, 'factory doesn''t see its update');
select pg_temp.expect_error(format($$select public.review_step_update('%s', true, '')$$, :'u1'), 'Only the orders team and Quality%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(jsonb_array_length(public.factory_step_updates()) = 0, 'another factory sees the update');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) = 0 from public.step_updates), 'a buyer reads factory updates');

-- ---------------------------------------------------------------- the team confirms or sends back
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 1 and bool_and(cardinality(photos) = 2 and note = 'all greige in') from public.step_updates where status = 'pending'),
  'team doesn''t see the waiting update');
select pg_temp.expect_error(format($$update public.step_updates set status = 'confirmed' where id = '%s'$$, :'u1'), 'permission denied%');
select pg_temp.expect_error(format($$select public.review_step_update('%s', false, '')$$, :'u1'), 'Say why%');
select public.review_step_update(:'u1', false, 'Photo is blurry');
select pg_temp.expect((select status = 'declined' and review_note = 'Photo is blurry' from public.step_updates where id = :'u1'), 'not sent back');
select pg_temp.expect((select done_on is null from public.line_stages where line_id = :'k1' and stage = 'greige'), 'a sent-back update entered a done date');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select public.post_step_update(:'k1', 'greige', current_date, '', array[:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/r.jpg']) as u3 \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.review_step_update(:'u3', true, '');
select pg_temp.expect((select done_on = current_date and updated_by = '00000000-0000-0000-0000-0000000000a9' from public.line_stages
  where line_id = :'k1' and stage = 'greige'), 'confirming didn''t enter the done date');
select pg_temp.expect_error(format($$select public.review_step_update('%s', true, '')$$, :'u3'), 'This update was already answered%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'greige', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k1', :'co', :'ord', :'k1'),
  'That step is already marked done.');
-- The buyer sees the step done.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select (s ->> 'done_on')::date = current_date from jsonb_array_elements(public.buyer_orders() -> 'orders' -> 0 -> 'lines') l,
  jsonb_array_elements(l -> 'steps') s where l ->> 'style' = 'K-1' and s ->> 'stage' = 'greige'), 'buyer doesn''t see the confirmed step');
