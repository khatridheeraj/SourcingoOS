-- Tests for the glitch fixes of 18 Oct 2026 (0039). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
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
-- Plans every standard step of every style on the order, then releases one factory's PO (as whoever is signed in).
create function pg_temp.release(p_order uuid, p_factory uuid) returns void language sql as $$
  select public.save_line_stages(p_order, (select jsonb_agg(jsonb_build_object('line_id', l.id, 'stage', s, 'planned_on', current_date + 10 + n::int))
    from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching',
                      'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n),
         public.order_lines l where l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null));
  select public.request_factory_plan(p_order, p_factory, 7);
  select public.accept_targets_for_factory(p_order, p_factory);
  select public.release_factory_po(p_order, p_factory);
$$;
create function pg_temp.lines(p_order uuid) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', id, 'style', style, 'colour', colour, 'qty', qty, 'factory_id', factory_id, 'factory_rate', 100)
                   order by position)
  from public.order_lines where order_id = p_order and removed_at is null;
$$;
create function pg_temp.head(p_order uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'buyer_id', buyer_id, 'buyer_po', buyer_po, 'po_date', po_date, 'ship_date', ship_date, 'status', status)
  from public.orders where id = p_order;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000b1', 'buy@areeba.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.add_buyer_member('buy@areeba.in', :'ah');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'GL-1', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"},
    {"style":"K-2","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"},
    {"style":"K-3","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'GL-2', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"C-1","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"}]'::jsonb) as ord2 \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as k2 from public.order_lines where style = 'K-2' \gset
select id as k3 from public.order_lines where style = 'K-3' \gset
select id as c1 from public.order_lines where style = 'C-1' \gset
select company_id as co from public.orders where id = :'ord' \gset
select pg_temp.release(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.release(:'ord2', '20000000-0000-0000-0000-000000000001');
select public.factory_link('20000000-0000-0000-0000-000000000001') as secret \gset
select user_id as link_user from public.factory_links \gset

-- ---------------------------------------------------------------- 1. buyers get no factory dates
select pg_temp.expect((select count(*) = 15 from public.style_steps(:'k1') where factory_on is not null), 'staff lost the factory''s dates');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select count(*) = 15 and count(factory_on) = 0 and count(planned_on) = 15 from public.style_steps(:'k1')),
  'a buyer sees the factory''s dates');
select pg_temp.as_user(:'link_user');
select pg_temp.expect((select count(factory_on) = 15 from public.style_steps(:'k1')), 'the factory lost its own dates');

-- ---------------------------------------------------------------- 2. buyers open only the final QC photos they are shown
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select gen_random_uuid() as qi, gen_random_uuid() as qf, gen_random_uuid() as qr \gset
select public.record_qc(:'ord', jsonb_build_object('id', :'qi', 'line_id', :'k1', 'kind', 'inline', 'result', 'pass'),
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/' || :'qi' || '/i.jpg', 'kind', 'photo')));
select public.record_qc(:'ord', jsonb_build_object('id', :'qf', 'line_id', :'k1', 'kind', 'final', 'result', 'fail', 'notes', 'stains'),
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/' || :'qf' || '/f.jpg', 'kind', 'photo')));
-- The latest final check failed: the buyer page shows it as being reworked, with its photos.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect(public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qf' || '/f.jpg'), 'buyer can''t open the failed final QC photo it is shown');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.record_qc(:'ord', jsonb_build_object('id', :'qr', 'line_id', :'k1', 'kind', 'recheck', 'result', 'pass'),
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/' || :'qr' || '/p.jpg', 'kind', 'photo'),
                    jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/' || :'qr' || '/p2.jpg', 'kind', 'photo'),
                    jsonb_build_object('path', :'co' || '/' || :'ord' || '/qc/' || :'qr' || '/r.pdf', 'kind', 'report')));
update public.qc_photos set removed_at = now() where path like '%/p2.jpg';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect((select bool_and(public.buyer_can_read_photo(p #>> '{}')) and count(*) = 1
  from jsonb_array_elements(public.buyer_orders() -> 'orders') o, jsonb_array_elements(o -> 'lines') l, jsonb_array_elements(l -> 'final_qc' -> 'photos') p),
  'buyer can''t open the QC photos its page shows');
select pg_temp.expect(public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qr' || '/p.jpg'), 'buyer can''t open the passed recheck photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qf' || '/f.jpg'), 'buyer opens an older final QC photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qi' || '/i.jpg'), 'buyer opens an inline QC photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qr' || '/p2.jpg'), 'buyer opens a removed photo');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/' || :'qr' || '/r.pdf'), 'buyer opens a QC report');
select pg_temp.expect(not public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/qc/x/made-up.jpg'), 'buyer opens any file under qc/');
select pg_temp.expect(public.buyer_can_read_photo(:'co' || '/' || :'ord' || '/styles/k1.jpg'), 'buyer can''t open its style photos');

-- ---------------------------------------------------------------- 6. factories can't mark Final QC or ex-factory done
select pg_temp.as_user(:'link_user');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'final_qc', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k2', :'co', :'ord', :'k2'),
  'Final QC and ex-factory are entered by Sourcingo, not the factory.');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'ex_factory', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k2', :'co', :'ord', :'k2'),
  'Final QC and ex-factory are entered by Sourcingo, not the factory.');

-- ---------------------------------------------------------------- 5. updates on closed orders, removed or moved styles
select public.post_step_update(:'k1', 'cutting', current_date, '', array[:'co' || '/' || :'ord' || '/factory/' || :'k1' || '/a.jpg']) as u_moved \gset
select public.post_step_update(:'k2', 'cutting', current_date, '', array[:'co' || '/' || :'ord' || '/factory/' || :'k2' || '/a.jpg']) as u_removed \gset
select public.post_step_update(:'k3', 'cutting', current_date, '', array[:'co' || '/' || :'ord' || '/factory/' || :'k3' || '/a.jpg']) as u_ok \gset
select public.post_step_update(:'c1', 'cutting', current_date, '', array[:'co' || '/' || :'ord2' || '/factory/' || :'c1' || '/a.jpg']) as u_cancel \gset
-- K-1 moves to Anya (the owner may), K-2 is removed, and the second order is cancelled.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.order_lines set factory_id = '20000000-0000-0000-0000-000000000002' where id = :'k1';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'K-2'));
select public.save_order(pg_temp.head(:'ord2') || '{"status":"cancelled"}', pg_temp.lines(:'ord2'));
select pg_temp.expect((select (public.brief_data() ->> 'updates_waiting') = '2'), 'the brief counts updates on closed orders or removed styles');
select pg_temp.expect_error(format($$select public.review_step_update('%s', true, '')$$, :'u_cancel'),
  'This order is no longer open, so the update can''t be confirmed. Send it back instead.');
select pg_temp.expect_error(format($$select public.review_step_update('%s', true, '')$$, :'u_removed'),
  'This style was removed from the order, so the update can''t be confirmed. Send it back instead.');
select pg_temp.expect_error(format($$select public.review_step_update('%s', true, '')$$, :'u_moved'),
  'This style has moved to another factory since the update was sent, so it can''t be confirmed. Send it back instead.');
select pg_temp.expect((select count(*) = 0 from public.line_stages where line_id in (:'k1', :'k2', :'c1') and stage = 'cutting' and done_on is not null),
  'a refused update entered a done date');
select public.review_step_update(:'u_moved', false, 'Moved to Anya');
select public.review_step_update(:'u_ok', true, '');
select pg_temp.expect((select done_on = current_date from public.line_stages where line_id = :'k3' and stage = 'cutting'), 'a good update was not confirmed');
-- Updates already waiting on closed orders or removed styles are sent back with the reason (the migration did this once).
reset role;
select pg_temp.expect(public.close_stale_step_updates() = 2, 'stale updates were not all sent back');
select pg_temp.expect((select bool_and(status = 'declined' and review_note like 'The order was shipped or cancelled%') from public.step_updates
  where id in (:'u_removed', :'u_cancel')), 'stale updates not sent back with a reason');
set role authenticated;
select pg_temp.expect_error('select public.close_stale_step_updates()', 'permission denied%');

-- ---------------------------------------------------------------- 4. a link switched off in Team
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.members set active = false where user_id = :'link_user';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-000000000001')$$,
  'This link was switched off in Team. Make a new link to switch it back on.');
select public.factory_link('20000000-0000-0000-0000-000000000001', true) as secret \gset
select pg_temp.expect((select active from public.members where user_id = :'link_user'), 'a new link left its login switched off');
select pg_temp.expect(public.factory_link_login(:'secret') is not null and public.factory_link('20000000-0000-0000-0000-000000000001') = :'secret',
  'the new link doesn''t work');

-- ---------------------------------------------------------------- 3. a switched-off factory loses its link
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.factories set active = false where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect(public.factory_link_login(:'secret') is null, 'a switched-off factory signs in with its link');
select pg_temp.as_user(:'link_user');
select pg_temp.expect(public.my_factory() is null, 'a switched-off factory''s login still counts as the factory');
select pg_temp.expect_error(format($$select public.post_step_update('%s', 'stitching', current_date, '', array['%s/%s/factory/%s/p.jpg'])$$, :'k3', :'co', :'ord', :'k3'),
  'You can update only your own styles on a released PO.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-000000000001')$$, 'Pick one of your active factories.');
-- Its link can still be changed, so the old one stops for good.
select public.factory_link('20000000-0000-0000-0000-000000000001', true) as secret2 \gset
select pg_temp.expect(:'secret2' <> :'secret' and public.factory_link_login(:'secret2') is null, 'a switched-off factory''s link could not be changed');
-- A switched-off factory that never had a link doesn't get one.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.factories set active = false where id = '20000000-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-000000000002', true)$$, 'Pick one of your active factories.');
-- Switched back on, it signs in with the newest link only.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.factories set active = true;
select pg_temp.expect(public.factory_link_login(:'secret2') is not null and public.factory_link_login(:'secret') is null, 'the factory did not come back on its newest link');
select pg_temp.as_user(:'link_user');
select pg_temp.expect(public.my_factory() = '20000000-0000-0000-0000-000000000001', 'the factory login did not come back');

-- ---------------------------------------------------------------- 7. the health report is for the team
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.expect_error('select public.system_health()', 'The health report is for the Sourcingo team.');
select pg_temp.as_user(:'link_user');
select pg_temp.expect_error('select public.system_health()', 'The health report is for the Sourcingo team.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.system_health() ? 'db_mb', 'staff lost the health report');
-- The hourly check calls it with the public key and no login.
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect(public.system_health() ? 'db_mb', 'the hourly health check lost the report');
set role authenticated;

-- ---------------------------------------------------------------- 8. marker photos have a size limit
select pg_temp.expect((select convalidated from pg_constraint where conname = 'marker_job_parts_size'), 'the marker photo limit is not checked');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  v_job uuid;
begin
  insert into public.marker_jobs (prompt) values ('read') returning id into v_job;
  insert into public.marker_job_parts (job_id, part, files) values (v_job, 0, jsonb_build_array(jsonb_build_object('type', 'image/jpeg', 'data', repeat('A', 4600000))));
  raise exception 'a part over 4.5 MB went in';
exception when check_violation then null;
end $$;

-- ---------------------------------------------------------------- 9. a locked target can't be moved by moving the style away and back
-- K-3 is on Kkora's released PO. The merchandiser can't move it to Anya by any route, so its targets stay locked.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select planned_on as k3_fabric from public.line_stages where line_id = :'k3' and stage = 'fabric' \gset
select pg_temp.expect_error(format($$update public.order_lines set factory_id = '20000000-0000-0000-0000-000000000002' where id = '%s'$$, :'k3'),
  'K-3 is on Kkora''s released PO, so only the owner can move it to another factory.');
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'), (select jsonb_agg(case when x ->> 'style' = 'K-3'
  then x || '{"factory_id":"20000000-0000-0000-0000-000000000002"}' else x end) from jsonb_array_elements(pg_temp.lines('%s')) x))$$, :'ord', :'ord'),
  'K-3 is on Kkora''s released PO, so only the owner can move it to another factory.');
-- Typed in again as a new style with the other factory, it is still the same style and the move is refused.
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'), (select jsonb_agg(case when x ->> 'style' = 'K-3'
  then (x - 'id') || '{"factory_id":"20000000-0000-0000-0000-000000000002"}' else x end) from jsonb_array_elements(pg_temp.lines('%s')) x))$$, :'ord', :'ord'),
  'K-3 is on Kkora''s released PO, so only the owner can move it to another factory.');
-- Removed and typed back in over two saves, it comes back to Kkora with its locked targets.
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'K-3'));
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'), pg_temp.lines('%s')
  || '[{"style":"K-3","qty":100,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":100}]')$$, :'ord', :'ord'),
  'K-3 is on Kkora''s released PO, so only the owner can move it to another factory.');
select public.save_order(pg_temp.head(:'ord'), pg_temp.lines(:'ord') || '[{"style":"K-3","qty":100,"factory_rate":100}]');
select pg_temp.expect((select factory_id = '20000000-0000-0000-0000-000000000001' and removed_at is null from public.order_lines where id = :'k3'),
  'K-3 left Kkora');
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric', 'planned_on', current_date + 50)))$$, :'ord', :'k3'),
  'Targets are locked once the factory PO is released.%');
select pg_temp.expect((select planned_on = :'k3_fabric' from public.line_stages where line_id = :'k3' and stage = 'fabric'), 'a locked target moved');
