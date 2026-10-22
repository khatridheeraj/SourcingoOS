-- Tests for the order lifecycle fixes (0033). Every block either passes quietly or raises.
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
-- Only the owner locks and releases a factory PO (0048): the team's release steps below run as the owner.
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
-- Every standard step of a style planned for the given day.
create function pg_temp.plan(p_order uuid, p_line uuid, p_on date) returns void language sql as $$
  select public.save_line_stages(p_order, (select jsonb_agg(jsonb_build_object('line_id', p_line, 'stage', s, 'planned_on', p_on))
    from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching',
                      'inline', 'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) s));
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
  ('00000000-0000-0000-0000-0000000000fb', 'anya@factory.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya'),
  ('20000000-0000-0000-0000-000000000003', 'Third');
select public.add_factory_member('anya@factory.in', '20000000-0000-0000-0000-000000000002');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'LC-1', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"},
    {"style":"K-2","qty":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"100"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as k2 from public.order_lines where style = 'K-2' \gset

-- ---------------------------------------------------------------- two people saving the same order
select pg_temp.expect((select edit_no = 0 from public.orders where id = :'ord'), 'a new order should start at edit 0');
-- The first person adds a style from edit 0.
select public.save_order(pg_temp.head(:'ord') || '{"edit_no":0}', pg_temp.lines(:'ord') || '[{"style":"K-3","qty":5}]');
select pg_temp.expect((select edit_no = 1 from public.orders where id = :'ord'), 'a save did not count up the edit number');
-- The second person still has edit 0 open: their save would remove K-3, and is refused.
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s') || '{"edit_no":0,"notes":"stale"}',
  (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines('%s')) x where x ->> 'style' <> 'K-3'))$$, :'ord', :'ord'),
  'Someone else changed this order while you had it open. Reload the page and make your change again.');
select pg_temp.expect((select count(*) = 3 from public.order_lines where order_id = :'ord' and removed_at is null), 'a stale save removed a style');
-- A save from a page that doesn't send the edit number still works.
select public.save_order(pg_temp.head(:'ord'), pg_temp.lines(:'ord'));
-- The edit number only goes up by one, whatever is written to it, and a save with no change leaves no history.
update public.orders set edit_no = 100 where id = :'ord';
select pg_temp.expect((select edit_no = 3 from public.orders where id = :'ord'), 'the edit number was set by hand');
select count(*) as hist from public.history where table_name = 'orders' and row_id = :'ord' \gset
select public.save_order(pg_temp.head(:'ord') || '{"edit_no":3}', pg_temp.lines(:'ord'));
select pg_temp.expect((select count(*) = :hist from public.history where table_name = 'orders' and row_id = :'ord'),
  'a save that changed nothing was written to the history');

-- ---------------------------------------------------------------- a style typed back in is the same style
select id as k3 from public.order_lines where style = 'K-3' \gset
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'K-3'));
select pg_temp.expect((select removed_at is not null from public.order_lines where id = :'k3'), 'K-3 not removed');
select public.save_order(pg_temp.head(:'ord'), pg_temp.lines(:'ord') || '[{"style":" k-3 ","qty":7}]');
select pg_temp.expect((select removed_at is null and qty = 7 from public.order_lines where id = :'k3'), 'K-3 typed back in was not brought back');
select pg_temp.expect((select count(*) = 3 from public.order_lines where order_id = :'ord'), 'typing K-3 back in added a new style');
-- Deleting the row and typing it back in within one save keeps it too.
select public.save_order(pg_temp.head(:'ord'),
  (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'k-3') || '[{"style":"K-3","qty":8}]');
select pg_temp.expect((select removed_at is null and qty = 8 from public.order_lines where id = :'k3'), 'K-3 retyped in one save was not kept');
select pg_temp.expect((select count(*) = 3 from public.order_lines where order_id = :'ord'), 'retyping K-3 in one save added a new style');
-- Two new lines for the same style are still refused.
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'), pg_temp.lines('%s') || '[{"style":"N-1","qty":1},{"style":"n-1","qty":2}]')$$,
  :'ord', :'ord'), '%order_lines_style_key%');
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'K-3'));

-- ---------------------------------------------------------------- moving a style to another factory
select pg_temp.plan(:'ord', :'k1', current_date + 20);
select pg_temp.plan(:'ord', :'k2', current_date + 20);
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) = 15 from public.line_stages where line_id = :'k2' and factory_on is not null), 'K-2 has no factory dates');
-- K-2 moves to Anya before release: Kkora's dates go, the targets stay.
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(case when x ->> 'style' = 'K-2'
  then x || '{"factory_id":"20000000-0000-0000-0000-000000000002"}' else x end) from jsonb_array_elements(pg_temp.lines(:'ord')) x));
select pg_temp.expect((select count(*) = 0 from public.line_stages where line_id = :'k2' and factory_on is not null), 'the old factory''s dates moved with K-2');
select pg_temp.expect((select count(*) = 15 from public.line_stages where line_id = :'k2' and planned_on is not null), 'K-2 lost its targets on the move');
-- Anya was never asked, so its PO can't be released.
select pg_temp.expect_error(format($$select pg_temp.owner_release('%s', '20000000-0000-0000-0000-000000000002')$$, :'ord'),
  'The plan is not complete yet. Missing: K-2 (factory dates:%');
-- (A data load by the database itself, with no one signed in, gives K-2 factory dates without asking Anya.)
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.line_stages set factory_on = planned_on where line_id = :'k2';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select pg_temp.owner_release('%s', '20000000-0000-0000-0000-000000000002')$$, :'ord'),
  'Ask the factory for its plan first.');
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000002', 7);
select pg_temp.expect_error(format($$select pg_temp.owner_release('%s', '20000000-0000-0000-0000-000000000002')$$, :'ord'),
  'The factory hasn''t sent its plan for your latest request yet.%');
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000002');
select pg_temp.owner_release(:'ord', '20000000-0000-0000-0000-000000000002');
select pg_temp.owner_release(:'ord', '20000000-0000-0000-0000-000000000001');
-- Once Kkora's PO is released, only the owner can move K-1 away from it.
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'), (select jsonb_agg(case when x ->> 'style' = 'K-1'
  then x || '{"factory_id":"20000000-0000-0000-0000-000000000003"}' else x end) from jsonb_array_elements(pg_temp.lines('%s')) x))$$, :'ord', :'ord'),
  'K-1 is on Kkora''s released PO, so only the owner can move it to another factory.');
select pg_temp.expect_error(format($$update public.order_lines set factory_id = '20000000-0000-0000-0000-000000000003' where id = '%s'$$, :'k1'),
  'K-1 is on Kkora''s released PO%');
-- The owner moves it into Anya's PO, which is already released: Kkora's dates are cleared all the same.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(case when x ->> 'style' = 'K-1'
  then x || '{"factory_id":"20000000-0000-0000-0000-000000000002"}' else x end) from jsonb_array_elements(pg_temp.lines(:'ord')) x));
select pg_temp.expect((select count(*) = 0 from public.line_stages where line_id = :'k1' and factory_on is not null), 'K-1 kept Kkora''s dates');
-- Staff still can't clear or set a factory's date themselves.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$update public.line_stages set factory_on = null where line_id = '%s'$$, :'k2'), 'permission denied%');

-- ---------------------------------------------------------------- the TNA keeps someone else's dates
-- The merchandiser loads K-2's fabric step: target set, nothing done.
select planned_on as k2_fabric from public.line_stages where line_id = :'k2' and stage = 'fabric' \gset
-- Meanwhile Quality enters the done date.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k2', 'stage', 'fabric', 'planned_on', :'k2_fabric',
  'done_on', current_date - 1, 'not_needed', false, 'was', jsonb_build_object('planned_on', :'k2_fabric', 'done_on', '', 'not_needed', false))));
-- The owner moves the target (locked since release) from the old screen: the target changes, Quality's done date stays.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k2', 'stage', 'fabric', 'planned_on', current_date + 15,
  'done_on', '', 'not_needed', false, 'target_note', 'Fabric mill late', 'was', jsonb_build_object('planned_on', :'k2_fabric', 'done_on', '', 'not_needed', false))));
select pg_temp.expect((select target_note = 'Fabric mill late' and baseline_on = :'k2_fabric'::date from public.line_stages where line_id = :'k2' and stage = 'fabric'),
  'the moved target lost its reason or its baseline');
select pg_temp.expect((select planned_on = current_date + 15 and done_on = current_date - 1 from public.line_stages where line_id = :'k2' and stage = 'fabric'),
  'the target save wiped the done date Quality entered');
-- Changing the target again from the same old screen is refused: it was changed since.
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric',
  'planned_on', current_date + 16, 'done_on', '', 'not_needed', false, 'was', jsonb_build_object('planned_on', '%s', 'done_on', '', 'not_needed', false))))$$,
  :'ord', :'k2', :'k2_fabric'), 'Fabric on K-2 was changed by someone else while you had the page open.%');
-- Quality entering a done date over one entered meanwhile is refused too.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric',
  'done_on', current_date, 'was', jsonb_build_object('planned_on', '', 'done_on', '', 'not_needed', false))))$$, :'ord', :'k2'),
  'Fabric on K-2 was changed by someone else%');
-- A page without "was" saves as before.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k2', 'stage', 'fabric', 'planned_on', current_date + 17, 'done_on', '',
  'target_note', 'Fabric mill late')));
select pg_temp.expect((select planned_on = current_date + 17 and done_on is null from public.line_stages where line_id = :'k2' and stage = 'fabric'),
  'a save without "was" no longer saves as sent');

-- ---------------------------------------------------------------- a removed style keeps its dispatches
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000002', 'bill_no', 'AN/1',
  'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('line_id', :'k2', 'qty', 10, 'purchase_rate', 100)))) as d1 \gset
select pg_temp.expect_error(format($$select public.save_order(pg_temp.head('%s'),
  (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines('%s')) x where x ->> 'style' <> 'K-2'))$$, :'ord', :'ord'),
  'K-2 has goods bought on a dispatch, so it can''t be removed. Cancel that dispatch first.');
select public.cancel_dispatch(:'d1', 'Entered twice');
select public.save_order(pg_temp.head(:'ord'), (select jsonb_agg(x) from jsonb_array_elements(pg_temp.lines(:'ord')) x where x ->> 'style' <> 'K-2'));
select pg_temp.expect((select removed_at is not null from public.order_lines where id = :'k2'), 'K-2 not removed once its dispatch was cancelled');
-- Typed back in with no factory picked, K-2 comes back to Anya (its released PO) with its plan.
select public.save_order(pg_temp.head(:'ord'), pg_temp.lines(:'ord') || '[{"style":"K-2","qty":100,"factory_id":"","factory_rate":"100"}]');
select pg_temp.expect((select removed_at is null and factory_id = '20000000-0000-0000-0000-000000000002'
  from public.order_lines where id = :'k2'), 'K-2 typed back in lost its factory');
select pg_temp.expect((select count(*) = 15 from public.line_stages where line_id = :'k2' and factory_on is not null), 'K-2 typed back in lost its plan');

-- ---------------------------------------------------------------- no ship date, no release
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'LC-2', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"A-1","qty":"10","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"50"}]'::jsonb) as ord2 \gset
select id as a1 from public.order_lines where style = 'A-1' \gset
select pg_temp.plan(:'ord2', :'a1', current_date + 20);
select public.request_factory_plan(:'ord2', '20000000-0000-0000-0000-000000000002', 7);
-- The factory reads its target date only on orders it has a style on.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(public.factory_target(:'ord2', '20000000-0000-0000-0000-000000000002') = current_date + 53, 'the factory lost its target date');
select pg_temp.expect(public.factory_target(:'ord', '20000000-0000-0000-0000-000000000002') is not null, 'the factory lost the target of its moved style');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'LC-3', 'ship_date', current_date + 30),
  '[{"style":"Z-1","qty":"10","factory_id":"20000000-0000-0000-0000-000000000001"}]'::jsonb) as ord3 \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect(public.factory_target(:'ord3', '20000000-0000-0000-0000-000000000002') is null, 'a factory read the ship date of an order it has no style on');
-- The ship date is cleared after the plan request.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(pg_temp.head(:'ord2') || '{"ship_date":""}', pg_temp.lines(:'ord2'));
select pg_temp.expect_error(format($$select public.accept_targets_for_factory('%s', '20000000-0000-0000-0000-000000000002')$$, :'ord2'),
  'Enter the PO''s ship date first.');
select pg_temp.expect_error(format($$select pg_temp.owner_release('%s', '20000000-0000-0000-0000-000000000002')$$, :'ord2'),
  'Enter the PO''s ship date first.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fb');
select pg_temp.expect_error(format($$select public.save_factory_tna('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric',
  'factory_on', current_date + 400)))$$, :'ord2', :'a1'), 'Enter the PO''s ship date first.');

-- ---------------------------------------------------------------- QC always has a photo
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$insert into public.qc_checks (order_id, line_id, kind, result) values ('%s', '%s', 'final', 'pass')$$, :'ord', :'k1'),
  'permission denied%');
select gen_random_uuid() as q1 \gset
select public.record_qc(:'ord', jsonb_build_object('id', :'q1', 'line_id', :'k1', 'kind', 'inline', 'result', 'pass'),
  jsonb_build_array(jsonb_build_object('path', public.current_company() || '/' || :'ord' || '/qc/' || :'q1' || '/1.jpg', 'kind', 'photo'),
                    jsonb_build_object('path', public.current_company() || '/' || :'ord' || '/qc/' || :'q1' || '/r.pdf', 'kind', 'report')));
select pg_temp.expect((select checked_by = auth.uid() from public.qc_checks where id = :'q1'), 'QC not recorded as by Quality');
select pg_temp.expect_error(format($$select public.record_qc('%s', jsonb_build_object('line_id', '%s', 'kind', 'inline', 'result', 'pass'),
  '[{"path":"elsewhere/1.jpg","kind":"photo"}]')$$, :'ord', :'k1'), 'Those files didn''t upload properly.%');
select pg_temp.expect_error(format($$select public.record_qc(gen_random_uuid(), jsonb_build_object('line_id', '%s', 'kind', 'inline', 'result', 'pass'),
  '[{"path":"x/1.jpg","kind":"photo"}]')$$, :'k1'), 'That order isn''t in your company.');
-- The photo can go while the report stays (the team keeps the signed report as proof), but not the last file.
update public.qc_photos set removed_at = now() where qc_id = :'q1' and kind = 'photo';
select pg_temp.expect_error(format($$update public.qc_photos set removed_at = now() where qc_id = '%s' and kind = 'report'$$, :'q1'),
  'A QC check needs at least one photo or report as proof. Add another before removing this one.');
update public.qc_photos set removed_at = null where qc_id = :'q1' and kind = 'photo';
update public.qc_photos set removed_at = now() where qc_id = :'q1' and kind = 'report';
insert into public.qc_photos (qc_id, path) values (:'q1', public.current_company() || '/' || :'ord' || '/qc/' || :'q1' || '/2.jpg');
update public.qc_photos set removed_at = now() where qc_id = :'q1' and path like '%/1.jpg';
select pg_temp.expect((select count(*) = 1 from public.qc_photos where qc_id = :'q1' and removed_at is null), 'photo not taken off once another was added');
-- A cancelled check can lose its last photo.
update public.qc_checks set cancelled_at = now(), cancel_reason = 'Wrong style' where id = :'q1';
update public.qc_photos set removed_at = now() where qc_id = :'q1';
select pg_temp.expect((select count(*) = 0 from public.qc_photos where qc_id = :'q1' and removed_at is null), 'a cancelled check kept its photo');
