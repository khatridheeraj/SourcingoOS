-- Sample approvals (0055). Every block either passes quietly or raises.
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
create function pg_temp.owner_release(p_order uuid, p_factory uuid) returns void language plpgsql as $$
declare
  v_was text := current_setting('request.jwt.claim.sub', true);
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
  perform public.release_factory_po(p_order, p_factory);
  perform set_config('request.jwt.claim.sub', coalesce(v_was, ''), false);
end $$;
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
select public.add_buyer_member('buy@areeba.in', :'ah');
select public.add_buyer_member('buy@ozia.in', :'oz');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"A-1","qty":"50","buyer_rate":"300","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"250"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ1', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"Z-1","qty":"10","buyer_rate":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"80"}]'::jsonb) as ord2 \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as a1 from public.order_lines where style = 'A-1' \gset
select id as z1 from public.order_lines where style = 'Z-1' \gset
select company_id as co from public.orders where id = :'ord' \gset
\set kp '\'' :co '/' :ord '/factory/' :k1 '/p.jpg\''
\set ks '\'' :co '/' :ord '/samples/' :k1 '/c.jpg\''

-- Plan K-1 (Kkora) with targets and release it; A-1 (Anya) stays unreleased.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_line_stages(:'ord', (select jsonb_agg(jsonb_build_object('line_id', l, 'stage', s, 'planned_on', current_date + 10 + n::int))
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                    'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n), unnest(array[:'k1'::uuid, :'a1'::uuid]) l));
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);

-- ---------------------------------------------------------------- before release nothing can be sent
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'k1', :kp),
  'Only the factory making this style, or the orders team, can send its sample.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'k1', :ks), 'Samples are sent once the factory PO is released.');
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.owner_release(:'ord', '20000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- the factory sends round 1
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'cutting', '', array[%L])$$, :'k1', :kp), 'Samples are for the fit, strike off, PP and size-set steps.');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', '{}')$$, :'k1'), 'Add at least one photo of the sample.');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'k1', :ks), 'Those photos are not from this style.');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'a1', :kp),
  'Only the factory making this style, or the orders team, can send its sample.');
-- A sample step can't be marked done as an ordinary step: the buyer approves it.
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'fit_sample', current_date, '', array[%L])$$, :'k1', :kp),
  'Samples go to the buyer for approval. Use Send sample for this step.');
-- The factory can't upload answer photos, and reads none of the samples table directly.
select pg_temp.expect(not public.can_upload_photo(:ks), 'factory uploads into the samples folder');
select public.send_sample(:'k1', 'fit_sample', 'Fit sample in size M', array[:kp]) as r1 \gset
select pg_temp.expect((select count(*) = 0 from public.sample_rounds), 'a factory reads the rounds table');
select pg_temp.expect((select (x ->> 'round')::int = 1 and x ->> 'status' = 'with_team' from jsonb_array_elements(public.factory_samples()) x), 'factory doesn''t see round 1');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'k1', :kp), 'This sample is already with Sourcingo.%');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(jsonb_array_length(public.factory_samples()) = 0, 'another factory sees the samples');

-- ---------------------------------------------------------------- the buyer sees nothing until the team sends it on
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect(jsonb_array_length(public.buyer_samples()) = 0, 'buyer sees a sample the team hasn''t checked');
select pg_temp.expect(not public.buyer_can_read_photo(:kp), 'buyer opens the factory''s photo before the team sends it');
select pg_temp.expect_error(format($$select public.answer_sample('%s', true, '', '{}')$$, :'r1'), 'This sample was already answered.%');

-- ---------------------------------------------------------------- the team sends it back, the factory sends round 2
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 1 from public.sample_rounds), 'Quality can''t see the samples');
select pg_temp.expect_error(format($$select public.return_sample('%s', 'no')$$, :'r1'), 'Only the orders team sends samples back.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$update public.sample_rounds set status = 'approved' where id = '%s'$$, :'r1'), 'permission denied%');
select pg_temp.expect_error(format($$select public.return_sample('%s', ' ')$$, :'r1'), 'Say what to fix%');
select public.return_sample(:'r1', 'Wrong thread colour');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect((select x ->> 'status' = 'returned' and x ->> 'answer_note' = 'Wrong thread colour' from jsonb_array_elements(public.factory_samples()) x),
  'factory doesn''t see why it was sent back');
select public.send_sample(:'k1', 'fit_sample', 'Thread fixed', array[:kp]) as r2 \gset
select pg_temp.expect((select round = 2 from public.sample_rounds where id = :'r2') is null, 'factory reads round 2 directly');

-- ---------------------------------------------------------------- the team sends round 2 to the buyer with the AWB
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select round = 2 and status = 'with_team' from public.sample_rounds where id = :'r2'), 'round 2 not made');
select pg_temp.expect_error(format($$select public.forward_sample('%s', '', '', current_date, '')$$, :'r2'), 'Say how the sample goes%');
select pg_temp.expect_error(format($$select public.forward_sample('%s', 'DTDC', '', current_date, '')$$, :'r2'), 'Enter the AWB%');
select pg_temp.expect_error(format($$select public.forward_sample('%s', 'DTDC', 'D123', public.india_today() + 1, '')$$, :'r2'), 'Give the day the sample went%');
select public.forward_sample(:'r2', 'DTDC', 'D1234567', public.india_today(), 'Fit sample, round 2. Thread colour fixed.');
select pg_temp.expect_error(format($$select public.forward_sample('%s', 'DTDC', 'D1', current_date, '')$$, :'r2'), 'This sample was already answered or sent.%');

-- ---------------------------------------------------------------- only its own buyer sees and answers it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect(jsonb_array_length(public.buyer_samples()) = 0, 'another buyer sees the sample');
select pg_temp.expect(not public.buyer_can_read_photo(:kp), 'another buyer opens the sample photo');
select pg_temp.expect_error(format($$select public.answer_sample('%s', true, '', '{}')$$, :'r2'), 'Only the buyer, or the orders team for the buyer, answers a sample.');
select pg_temp.expect(not public.can_upload_photo(:ks), 'another buyer uploads answer photos');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.buyer_samples() as bs \gset
select pg_temp.expect(jsonb_array_length(:'bs'::jsonb) = 1, 'buyer doesn''t see the sample sent to it');
select pg_temp.expect((:'bs'::jsonb -> 0 ->> 'awb') = 'D1234567' and (:'bs'::jsonb -> 0 ->> 'note') = 'Fit sample, round 2. Thread colour fixed.', 'buyer misses the AWB or note');
select pg_temp.expect(position('Kkora' in :'bs') = 0 and position('Thread fixed' in :'bs') = 0 and position('rate' in :'bs') = 0 and position(': 450' in :'bs') = 0 and position('"450"' in :'bs') = 0,
  'buyer sees the factory, its note or a price');
select pg_temp.expect(public.buyer_can_read_photo(:kp), 'buyer can''t open the sample photo');
select pg_temp.expect(public.can_upload_photo(:ks), 'buyer can''t upload an answer photo');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/' || :'ord2' || '/samples/' || :'z1' || '/c.jpg'), 'buyer uploads to another buyer''s order');
select pg_temp.expect_error(format($$select public.answer_sample('%s', false, '', '{}')$$, :'r2'), 'Say what to change%');
select pg_temp.expect_error(format($$select public.answer_sample('%s', false, 'x', array['%s/%s/qc/x/c.jpg'])$$, :'r2', :'co', :'ord'), 'Those photos are not from this style.');
select public.answer_sample(:'r2', false, 'Chest too loose, take in 1 cm', array[:ks]);
select pg_temp.expect(public.buyer_can_read_photo(:ks), 'buyer can''t open its own answer photo');
select pg_temp.expect_error(format($$select public.answer_sample('%s', true, '', '{}')$$, :'r2'), 'This sample was already answered.%');

-- ---------------------------------------------------------------- the factory sees the changes and sends round 3
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect((select x ->> 'answer_note' = 'Chest too loose, take in 1 cm' from jsonb_array_elements(public.factory_samples()) x where (x ->> 'round')::int = 2),
  'factory doesn''t see the buyer''s changes');
select pg_temp.expect(public.factory_can_read_photo(:ks), 'factory can''t open the buyer''s answer photo');
select pg_temp.expect(position('Areeba' in public.factory_samples()::text) = 0, 'factory sees the buyer');
select public.send_sample(:'k1', 'fit_sample', 'Chest taken in', array[:kp]) as r3 \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(not public.factory_can_read_photo(:ks), 'another factory opens the answer photo');

-- ---------------------------------------------------------------- the buyer approves round 3, the TNA step closes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.forward_sample(:'r3', 'By hand', '', public.india_today(), '');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
-- A buyer can't move its approval to another day, and can't enter a done date itself.
update public.line_stages set done_on = current_date where line_id = :'k1' and stage = 'fit_sample';
select pg_temp.expect((select count(*) = 0 from public.line_stages), 'a buyer reads the TNA table');
select public.answer_sample(:'r3', true, 'Approved, go ahead', '{}', public.india_today() - 5);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select status = 'approved' and approved_on = public.india_today() and not answered_for_buyer from public.sample_rounds where id = :'r3'),
  'buyer''s approval not recorded for today');
select pg_temp.expect((select done_on = public.india_today() and updated_by = '00000000-0000-0000-0000-0000000000b1' from public.line_stages
  where line_id = :'k1' and stage = 'fit_sample'), 'approval didn''t close the TNA step');
select pg_temp.expect(current_setting('sourcingo.sample_approval', true) is distinct from 'on', 'the approval flag stayed on');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'fit_sample', '', array[%L])$$, :'k1', :kp), 'This step is already done%');
-- The buyer sees every round it was sent, with its answers.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) = 2 from jsonb_array_elements(public.buyer_samples())), 'buyer doesn''t see rounds 2 and 3');
select pg_temp.expect((select (s ->> 'done_on')::date = public.india_today() from jsonb_array_elements(public.buyer_orders() -> 'orders' -> 0 -> 'lines') l,
  jsonb_array_elements(l -> 'steps') s where l ->> 'style' = 'K-1' and s ->> 'stage' = 'fit_sample'), 'buyer doesn''t see the step done');

-- ---------------------------------------------------------------- the team adds a sample and records the buyer's answer
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.send_sample('%s', 'pp_sample', '', array['%s/%s/samples/%s/c.jpg'])$$, :'k1', :'co', :'ord', :'a1'),
  'Those photos are not from this style.');
select public.send_sample(:'k1', 'pp_sample', 'Factory sent it on WhatsApp', array[:ks]) as r4 \gset
select pg_temp.expect((select sent_by_team and round = 1 from public.sample_rounds where id = :'r4'), 'team''s sample not marked as the team''s');
select pg_temp.expect_error(format($$select public.answer_sample('%s', true, '', '{}', public.india_today() + 1)$$, :'r4'), 'Give the day the buyer answered%');
select pg_temp.expect_error(format($$select public.answer_sample('%s', true, '', '{}', public.india_today() - 3)$$, :'r4'), 'Give the day the buyer answered%');
select public.answer_sample(:'r4', true, 'Approved on email', '{}', public.india_today());
select pg_temp.expect((select answered_for_buyer and approved_on = public.india_today() from public.sample_rounds where id = :'r4'), 'team''s record of the answer is wrong');
select pg_temp.expect((select done_on = public.india_today() from public.line_stages where line_id = :'k1' and stage = 'pp_sample'), 'team''s approval didn''t close the step');

-- ---------------------------------------------------------------- the brief lists open samples, not answered ones
select public.send_sample(:'k1', 'size_set', '', array[:ks]) as r5 \gset
reset role;
select pg_temp.expect((select count(*) = 1 and bool_and(x ->> 'stage' = 'size_set' and x ->> 'status' = 'with_team' and x ->> 'factory' = 'Kkora')
  from jsonb_array_elements(public.brief_data_for('00000000-0000-0000-0000-00000000000b') -> 'samples') x), 'brief samples wrong');
select pg_temp.expect(public.brief_data_for('00000000-0000-0000-0000-0000000000a9') -> 'samples' is null, 'Quality''s brief lists samples');
-- A changes answer stays in the brief until the factory sends again.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.answer_sample(:'r5', false, 'Size L is short', '{}');
reset role;
select pg_temp.expect((select x ->> 'status' = 'changes' and x ->> 'note' = 'Size L is short'
  from jsonb_array_elements(public.brief_data_for('00000000-0000-0000-0000-00000000000b') -> 'samples') x), 'changes not in the brief');
-- The brief still carries the 0052 lists.
select pg_temp.expect(public.brief_data_for('00000000-0000-0000-0000-00000000000a') ? 'part_shipped'
  and public.brief_data_for('00000000-0000-0000-0000-00000000000a') ? 'team_notes', 'brief lost its earlier lists');
