-- Rule tests. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

-- On a new database the migration creates Sourcingo with no owner, so make one here.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies) where id = '00000000-0000-0000-0000-00000000000a';

-- A second business on the same system, with its own owner.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'boss@other.in');
insert into public.companies (id, name) values ('cccccccc-0000-0000-0000-000000000002', 'Other Co');
insert into public.members values ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', 'owner');
update public.profiles set current_company_id = 'cccccccc-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-0000000000f1';

-- Someone who signs up without being added sees nothing.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'stranger@gmail.com');
do $$ begin
  if (select current_company_id from public.profiles where id = '00000000-0000-0000-0000-00000000000c') is not null then
    raise exception 'a stranger was put in a company';
  end if;
end $$;

-- ---------------------------------------------------------------- owner sets up Sourcingo
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- Adding a merchandiser by email before they have signed in.
do $$ begin
  if public.add_member(' Merch@Sourcingo.in ', 'merchandiser') <> 'invited' then raise exception 'invite not created'; end if;
end $$;

insert into public.buyers (id, code) values ('10000000-0000-0000-0000-000000000001', 'BYR-OZ');
insert into public.buyer_names (buyer_id, real_name) values ('10000000-0000-0000-0000-000000000001', 'Ozia Fashions');
select public.save_buyer('{"id":"10000000-0000-0000-0000-000000000001","code":"BYR-OZ","real_name":" Ozia Fashions ","city":"Delhi"}');
do $$ begin
  if (select real_name from public.buyer_names where buyer_id = '10000000-0000-0000-0000-000000000001') <> 'Ozia Fashions' then
    raise exception 'buyer real name not saved';
  end if;
  perform public.save_buyer('{"code":"BYR-NEW","real_name":"Ozia Fashions"}');
  raise exception 'duplicate real name was accepted';
exception when unique_violation then null;
end $$;
do $$ begin
  if exists (select 1 from public.buyers where code = 'BYR-NEW') then raise exception 'a failed save left a buyer without a name'; end if;
end $$;
select public.save_buyer('{"id":"10000000-0000-0000-0000-000000000001","code":"BYR-OZ","real_name":"Ozia Fashions Pvt Ltd","active":true}');
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Shree Knits');

do $$ begin
  insert into public.buyers (code) values ('byr-oz');
  raise exception 'lower-case buyer code should be rejected';
exception when check_violation then null;
end $$;

do $$ begin
  insert into public.factories (name) values (' shree knits ');
  raise exception 'duplicate factory name should be rejected';
exception when unique_violation then null;
end $$;

do $$ begin
  update public.members set active = false where user_id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'last owner was switched off';
exception when raise_exception then
  if sqlerrm not like 'There must always be one active owner.%' then raise; end if;
end $$;

do $$ begin
  update public.profiles set email = 'x@y.z' where id = auth.uid();
  raise exception 'email was changed';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- the merchandiser signs in for the first time
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
do $$ begin
  if (select role from public.members where user_id = '00000000-0000-0000-0000-00000000000b') <> 'merchandiser' then
    raise exception 'invite was not turned into a membership';
  end if;
  if exists (select 1 from public.invites where closed_at is null) then raise exception 'invite should be closed once used'; end if;
end $$;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');

do $$ begin
  if (select count(*) from public.buyers) <> 1 then raise exception 'staff should see buyer codes'; end if;
  if (select count(*) from public.buyer_names) <> 0 then raise exception 'staff must not see real buyer names'; end if;
  if exists (select 1 from public.history where table_name = 'buyer_names') then raise exception 'staff can read real names in history'; end if;
end $$;

do $$ begin
  insert into public.buyers (code) values ('BYR-XX');
  raise exception 'merchandiser added a buyer';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  update public.members set role = 'owner' where user_id = auth.uid();
  if public.my_role(public.current_company()) <> 'merchandiser' then raise exception 'merchandiser promoted themselves'; end if;
end $$;

do $$ begin
  perform public.add_member('friend@gmail.com', 'manager');
  raise exception 'merchandiser added a person';
exception when raise_exception then
  if sqlerrm <> 'Only the owner can add people.' then raise; end if;
end $$;

insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000002', 'Laxmi Garments');

select public.save_order(
  '{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"OZIA PO 001","ship_date":"2026-11-30"}',
  '[{"style":"OZ-101","colour":"Navy","qty":500,"buyer_rate":"320","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"240"},
    {"style":"OZ-102","qty":300,"factory_id":"20000000-0000-0000-0000-000000000002"}]') \gset

do $$ begin
  if (select order_no from public.orders) <> 'SO-0001' then raise exception 'order number should be SO-0001'; end if;
  if (select count(*) from public.order_lines) <> 2 then raise exception 'both lines should be saved'; end if;
  if (select created_by from public.orders) <> '00000000-0000-0000-0000-00000000000b' then raise exception 'created_by not set'; end if;
  if (select count(*) from public.history where table_name in ('orders', 'order_lines') and actor = auth.uid()) <> 3 then
    raise exception 'history should hold the order and its two lines';
  end if;
end $$;

-- The same buyer PO cannot be entered twice (this is how the old app ended up with copies).
do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"ozia po 001 "}', '[{"style":"X","qty":1}]');
  raise exception 'duplicate buyer PO was accepted';
exception when unique_violation then null;
end $$;

do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"PO-EMPTY"}', '[]');
  raise exception 'empty order was accepted';
exception when raise_exception then
  if sqlerrm <> 'Add at least one style.' then raise; end if;
end $$;
do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"PO-ZERO"}', '[{"style":"Z","qty":0}]');
  raise exception 'zero quantity was accepted';
exception when check_violation then null;
end $$;
do $$ begin
  if (select count(*) from public.orders) <> 1 then raise exception 'a failed save left an order behind'; end if;
end $$;

-- Quality checks gate shipping: no final check, or a failed latest one, keeps the order open for staff.
do $$ begin
  update public.orders set status = 'shipped';
  raise exception 'shipped without a final QC';
exception when raise_exception then
  if sqlerrm not like '%passed final QC%' then raise; end if;
end $$;

-- QC belongs to the Quality team: a merchandiser can't record it.
do $$ begin
  insert into public.qc_checks (order_id, kind, result) select id, 'inline', 'pass' from public.orders;
  raise exception 'a merchandiser recorded QC';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if public.can_upload_photo((select id::text from public.companies where name = 'Sourcingo') || '/o/qc/c/a.jpg') then
    raise exception 'a merchandiser may upload QC photos';
  end if;
  if not public.can_upload_photo((select id::text from public.companies where name = 'Sourcingo') || '/o/styles/l/a.jpg') then
    raise exception 'a merchandiser may not upload style photos';
  end if;
end $$;

-- The owner adds a Quality person, who has already signed in.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.add_member('qc@sourcingo.in', 'quality') <> 'added' then raise exception 'quality person not added'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  if (select count(*) from public.orders) <> 1 then raise exception 'Quality should see orders'; end if;
  if (select count(*) from public.buyer_names) <> 0 then raise exception 'Quality must not see real buyer names'; end if;
  if public.can_upload_photo((select id::text from public.companies where name = 'Sourcingo') || '/o/styles/l/a.jpg') then
    raise exception 'Quality may upload style photos';
  end if;
  update public.orders set stage = 'packed';
  if exists (select 1 from public.orders where stage = 'packed') then raise exception 'Quality changed production'; end if;
  begin
    perform public.save_order(jsonb_build_object('buyer_id', '10000000-0000-0000-0000-000000000001', 'buyer_po', 'QC-PO'), '[{"style":"Q","qty":1}]');
    raise exception 'Quality created an order';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.factories (name) values ('QC Factory');
    raise exception 'Quality added a factory';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.qc_checks (order_id, kind, result, pieces_checked, defects) values (:'save_order', 'inline', 'pass', 50, 2);
insert into public.qc_checks (order_id, kind, result, pieces_checked, defects, notes, checked_on)
  values (:'save_order', 'final', 'fail', 80, 9, 'Loose threads, wrong wash care label', current_date - 1);
do $$ begin
  if public.final_qc_passed((select id from public.orders)) then raise exception 'a failed final QC counted as passed'; end if;
  begin
    insert into public.qc_checks (order_id, kind, result) select id, 'final', 'fail' from public.orders;
    raise exception 'a failed check without notes was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.qc_checks (order_id, kind, result, pieces_checked, defects) select id, 'final', 'pass', 10, 11 from public.orders;
    raise exception 'more defects than pieces checked was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.qc_checks set result = 'pass' where kind = 'final';
    raise exception 'a saved QC result was changed';
  exception when raise_exception then
    if sqlerrm not like '%can''t be changed%' then raise; end if;
  end;
end $$;
insert into public.qc_checks (order_id, kind, result, pieces_checked, defects) values (:'save_order', 'midline', 'pass', 40, 0);
do $$ begin
  if public.final_qc_passed((select id from public.orders)) then raise exception 'a mid-line pass counted as the final'; end if;
end $$;
insert into public.qc_checks (order_id, kind, result, pieces_checked, defects) values (:'save_order', 'recheck', 'pass', 80, 1);
do $$ begin
  if not public.final_qc_passed((select id from public.orders)) then raise exception 'the passing re-check did not count'; end if;
  -- Cancelling the passing check puts the order back to needing a final QC.
  update public.qc_checks set cancelled_at = now(), cancel_reason = 'Entered on the wrong order' where kind = 'recheck' and result = 'pass';
  if public.final_qc_passed((select id from public.orders)) then raise exception 'a cancelled check still counted'; end if;
  begin
    update public.qc_checks set cancelled_at = null where cancelled_at is not null;
    raise exception 'a cancelled check was brought back';
  exception when raise_exception then
    if sqlerrm not like '%already cancelled%' then raise; end if;
  end;
  if (select count(*) from public.history where table_name = 'qc_checks') <> 5 then raise exception 'QC history not kept'; end if;
end $$;
insert into public.qc_checks (order_id, kind, result, pieces_checked, defects) values (:'save_order', 'final', 'pass', 80, 0);

-- QC photos sit under the company's own folder and are taken off a check, never deleted.
insert into public.qc_photos (qc_id, path)
  select id, (select id from public.companies where name = 'Sourcingo') || '/' || order_id || '/qc/' || id || '/a.jpg'
  from public.qc_checks where cancelled_at is null and kind = 'final' and result = 'pass';
do $$ begin
  begin
    insert into public.qc_photos (qc_id, path) select id, 'cccccccc-0000-0000-0000-000000000002/x/qc/y/b.jpg' from public.qc_checks limit 1;
    raise exception 'a photo path outside the company folder was accepted';
  exception when check_violation then null;
  end;
  update public.qc_photos set removed_at = now();
  if (select count(*) from public.qc_photos where removed_at is not null) <> 1 then raise exception 'photo not taken off'; end if;
  begin
    update public.qc_photos set path = 'other';
    raise exception 'a photo path was changed';
  exception when insufficient_privilege then null;
  end;
  if public.is_member_folder('not-a-company') then raise exception 'a non-company folder was allowed'; end if;
  if not public.is_member_folder((select id::text from public.companies where name = 'Sourcingo')) then raise exception 'own company folder refused'; end if;
end $$;
-- A check is recorded with its proof in one step: no photo, no check. Reports ride along.
do $$
declare v_co text := (select id::text from public.companies where name = 'Sourcingo'); v_id uuid := gen_random_uuid(); v_order uuid := (select id from public.orders);
begin
  begin
    perform public.record_qc(v_order, jsonb_build_object('kind', 'greige', 'result', 'pass'),
      jsonb_build_array(jsonb_build_object('path', v_co || '/o/qc/x/r.pdf', 'kind', 'report', 'file_name', 'Greige report.pdf')));
    raise exception 'a check without a photo was accepted';
  exception when raise_exception then
    if sqlerrm not like 'Add at least one photo%' then raise; end if;
  end;
  perform public.record_qc(v_order, jsonb_build_object('id', v_id, 'kind', 'greige', 'result', 'pass', 'pieces_checked', '20'),
    jsonb_build_array(jsonb_build_object('path', v_co || '/' || v_order || '/qc/' || v_id || '/1.jpg', 'kind', 'photo'),
                      jsonb_build_object('path', v_co || '/' || v_order || '/qc/' || v_id || '/2.pdf', 'kind', 'report', 'file_name', 'Greige report.pdf')));
  if (select count(*) from public.qc_photos where qc_id = v_id) <> 2 then raise exception 'check files not saved'; end if;
  if (select file_name from public.qc_photos where qc_id = v_id and kind = 'report') <> 'Greige report.pdf' then raise exception 'report name not kept'; end if;
  if not public.final_qc_passed(v_order) then raise exception 'a greige check changed the final QC result'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
-- Others can't change QC but can comment on it.
insert into public.qc_comments (qc_id, body) select id, 'Please share the shade band too' from public.qc_checks where kind = 'greige';
do $$ begin
  if (select count(*) from public.qc_comments) <> 1 then raise exception 'comment not saved'; end if;
  begin
    update public.qc_comments set body = 'changed';
    raise exception 'a comment was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.qc_comments (qc_id, body, created_by) select id, 'as someone else', '00000000-0000-0000-0000-00000000000a' from public.qc_checks limit 1;
    raise exception 'a comment was posted as someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_qc((select id from public.orders), '{"kind":"final","result":"pass"}', '[{"path":"x","kind":"photo"}]');
    raise exception 'a merchandiser recorded QC';
  exception when raise_exception then
    if sqlerrm not like 'Only the Quality team%' then raise; end if;
  end;
end $$;
do $$ begin
  update public.qc_photos set removed_at = null;
  if (select count(*) from public.qc_photos where removed_at is not null) <> 1 then raise exception 'a merchandiser changed a QC photo'; end if;
  update public.qc_checks set cancelled_at = now(), cancel_reason = 'x';
  if exists (select 1 from public.qc_checks where cancel_reason = 'x') then raise exception 'a merchandiser cancelled QC'; end if;
  if (select count(*) from public.qc_checks) <> 6 then raise exception 'a merchandiser should still see QC'; end if;
end $$;

-- Editing keeps the lines it is given (same id), drops the ones left out, and adds new ones in order.
select public.save_order(
  jsonb_build_object('id', :'save_order', 'buyer_id', '10000000-0000-0000-0000-000000000001', 'buyer_po', 'OZIA PO 001', 'status', 'shipped'),
  jsonb_build_array(
    jsonb_build_object('style', 'OZ-103', 'qty', 50),
    jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-101'), 'style', 'OZ-101', 'colour', 'Navy', 'qty', 520)));
do $$ begin
  if (select status from public.orders) <> 'shipped' then raise exception 'status not updated'; end if;
  if (select string_agg(style || ':' || qty, ',' order by position) from public.order_lines where removed_at is null) <> 'OZ-103:50,OZ-101:520' then
    raise exception 'lines not saved as given: %', (select string_agg(style || ':' || qty, ',' order by position) from public.order_lines where removed_at is null);
  end if;
  if (select removed_at from public.order_lines where style = 'OZ-102') is null then
    raise exception 'the dropped line should be marked removed, not lost';
  end if;
  if (select count(*) from public.history where table_name = 'order_lines' and action = 'update') <> 2 then
    raise exception 'the kept line and the removed line should be logged as one update each';
  end if;
end $$;

-- Production: the stage is stamped when it changes, and saving the order form leaves the stage and new date alone.
do $$ begin
  update public.orders set stage = 'stitching', revised_ship_date = '2026-12-01', delay_reason = 'Fabric late';
  if (select stage_at from public.orders) is null then raise exception 'stage change not stamped'; end if;
  begin
    update public.orders set stage = 'sewing';
    raise exception 'unknown stage was accepted';
  exception when check_violation then null;
  end;
end $$;
select public.save_order(
  jsonb_build_object('id', :'save_order', 'buyer_id', '10000000-0000-0000-0000-000000000001', 'buyer_po', 'OZIA PO 001', 'status', 'shipped'),
  jsonb_build_array(jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'style', 'OZ-103', 'qty', 50),
    jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-101'), 'style', 'OZ-101', 'colour', 'Navy', 'qty', 520)));
do $$ begin
  if (select (stage, revised_ship_date, delay_reason) from public.orders) is distinct from ('stitching'::text, '2026-12-01'::date, 'Fabric late'::text) then
    raise exception 'saving the order form wiped production details';
  end if;
end $$;

do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"PO-DUP"}',
    '[{"style":"A","colour":"Red","qty":1},{"style":"a ","colour":"red","qty":2}]');
  raise exception 'duplicate style line was accepted';
exception when unique_violation then null;
end $$;

-- Production by style: a full TNA per style; the factory PO is released only once the plan is complete,
-- actual dates come after release, and the order follows its slowest style.
select public.save_order(
  jsonb_build_object('id', :'save_order', 'buyer_id', '10000000-0000-0000-0000-000000000001', 'buyer_po', 'OZIA PO 001', 'status', 'open'),
  jsonb_build_array(jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'style', 'OZ-103', 'qty', 50,
      'factory_id', '20000000-0000-0000-0000-000000000001', 'factory_rate', '200'),
    jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-101'), 'style', 'OZ-101', 'colour', 'Navy', 'qty', 520,
      'factory_id', '20000000-0000-0000-0000-000000000001')));
select public.save_line_stages(:'save_order', jsonb_build_array(
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'stage', 'fabric', 'planned_on', '2026-11-01'),
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'stage', 'cutting', 'planned_on', '2026-11-10'),
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-101'), 'stage', 'fabric', 'planned_on', '2026-11-01')));
do $$ begin
  if (select count(*) from public.line_stages) <> 3 then raise exception 'style plan not saved'; end if;
  begin
    perform public.save_line_stages((select id from public.orders), jsonb_build_array(
      jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-101'), 'stage', 'fabric', 'planned_on', '2026-11-01', 'done_on', '2026-11-02')));
    raise exception 'a done date was accepted before the PO was released';
  exception when raise_exception then
    if sqlerrm not like 'Release the factory PO%' then raise; end if;
  end;
  begin
    perform public.release_factory_po((select id from public.orders), '20000000-0000-0000-0000-000000000001');
    raise exception 'a PO with an incomplete plan was released';
  exception when raise_exception then
    if sqlerrm not like 'The plan is not complete yet. Missing: OZ-103 (factory dates: Greige%plan: Greige%| OZ-101 (factory rate; factory dates: Greige%' then raise; end if;
  end;
  begin
    insert into public.line_stages (order_id, line_id, stage, not_needed, planned_on)
      select id, (select id from public.order_lines where style = 'OZ-101'), 'printing', true, '2026-11-05' from public.orders;
    raise exception 'a not-needed step kept a date';
  exception when check_violation then null;
  end;
end $$;
-- Fill every step (printing not needed), add the missing factory rate, then release.
select public.save_line_stages(:'save_order', (
  select jsonb_agg(jsonb_build_object('line_id', l.id, 'stage', st, 'planned_on', case when st = 'printing' then '' else '2026-11-01' end,
                                      'not_needed', st = 'printing'))
  from public.order_lines l cross join unnest(array['greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
    'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory']) st
  where l.order_id = :'save_order' and l.removed_at is null));
update public.order_lines set factory_rate = 240 where style = 'OZ-101';
do $$ begin
  perform public.release_factory_po((select id from public.orders), '20000000-0000-0000-0000-000000000001');
  raise exception 'a PO was released without the factory''s dates';
exception when raise_exception then
  if sqlerrm not like 'The plan is not complete yet. Missing: OZ-103 (factory dates: Greige, Fit sample%' then raise; end if;
end $$;
do $$ begin
  update public.line_stages set factory_on = '2026-11-01';
  raise exception 'the merchandiser entered the factory''s dates';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.line_stages (order_id, line_id, stage, not_needed)
    select id, (select id from public.order_lines where style = 'OZ-101'), 'final_qc', true from public.orders
    on conflict (line_id, stage) do update set not_needed = true, planned_on = null;
  raise exception 'a mandatory step was marked not needed';
exception when check_violation then null;
end $$;
-- The factory's own login enters its dates in its panel, once it has been asked for its plan.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fa', 'vendor@knits.in');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin
    perform public.add_factory_member('vendor@knits.in', '10000000-0000-0000-0000-000000000001');
    raise exception 'a factory login was tied to a buyer id';
  exception when raise_exception then
    if sqlerrm not like 'Pick one of your factories%' then raise; end if;
  end;
  if public.add_factory_member('vendor@knits.in', '20000000-0000-0000-0000-000000000001') <> 'added' then raise exception 'factory login not added'; end if;
  begin
    update public.members set role = 'merchandiser' where user_id = '00000000-0000-0000-0000-0000000000fa';
    raise exception 'a factory login became staff';
  exception when raise_exception then
    if sqlerrm not like 'A factory login stays%' then raise; end if;
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
do $$ begin
  if jsonb_array_length(public.factory_tna() -> 'orders') <> 0 then raise exception 'the factory saw a PO before it was asked for a plan'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.request_factory_plan((select id from public.orders), '20000000-0000-0000-0000-000000000001', 90);
  raise exception 'a plan was requested with a target date in the past';
exception when raise_exception then
  if sqlerrm not like 'With that buffer the target date is already past%' then raise; end if;
end $$;
select public.request_factory_plan(:'save_order', '20000000-0000-0000-0000-000000000001', 7);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
do $$ begin
  if (public.factory_tna() -> 'orders' -> 0 ->> 'target') <> '2026-11-24' or (public.factory_tna() -> 'orders' -> 0 ->> 'plan_due_at') is null then
    raise exception 'factory panel shows no target date or deadline: %', public.factory_tna() -> 'orders' -> 0;
  end if;
  begin
    perform public.save_factory_tna((select (public.factory_tna() -> 'orders' -> 0 ->> 'order_id')::uuid),
      jsonb_build_array(jsonb_build_object('line_id', (public.factory_tna() -> 'orders' -> 0 -> 'lines' -> 0 ->> 'id'), 'stage', 'ex_factory', 'factory_on', '2026-12-28')));
    raise exception 'a factory date after the target was accepted';
  exception when raise_exception then
    if sqlerrm not like 'Every date must be on or before the target date 24 Nov 2026%' then raise; end if;
  end;
end $$;
do $$ begin
  if exists (select 1 from public.orders) or exists (select 1 from public.order_lines) or exists (select 1 from public.buyers)
     or exists (select 1 from public.line_stages) or exists (select 1 from public.history) or exists (select 1 from public.factory_pos) then
    raise exception 'a factory login can read company data';
  end if;
  if jsonb_array_length(public.factory_tna() -> 'orders') <> 1 or jsonb_array_length(public.factory_tna() -> 'orders' -> 0 -> 'lines') <> 2 then
    raise exception 'factory panel does not show its order: %', public.factory_tna();
  end if;
  if (public.factory_tna() -> 'orders' -> 0 -> 'lines' -> 0 -> 'stages' -> 0 ->> 'planned_on') is not null then
    raise exception 'the factory saw the merchandiser''s plan before release';
  end if;
  begin
    perform public.save_line_stages((select (public.factory_tna() -> 'orders' -> 0 ->> 'order_id')::uuid), '[]');
    raise exception 'the factory changed the plan';
  exception when raise_exception then
    if sqlerrm not like 'Only the orders team and Quality%' then raise; end if;
  end;
end $$;
select public.save_factory_tna(:'save_order', (
  select jsonb_agg(jsonb_build_object('line_id', l ->> 'id', 'stage', st, 'factory_on', '2026-11-04'))
  from jsonb_array_elements(public.factory_tna() -> 'orders' -> 0 -> 'lines') l cross join unnest(array['greige', 'fit_sample', 'strike_off', 'pp_sample', 'size_set',
    'fabric', 'printing', 'cutting', 'stitching', 'finishing', 'packed', 'final_qc', 'ex_factory']) st));
do $$ begin
  if (public.factory_tna() -> 'orders' -> 0 ->> 'sent_at') is null then raise exception 'factory TNA not marked as sent'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.line_stages where factory_on is not null) <> 24 then
    raise exception 'factory dates: % (printing is not needed, so 24)', (select count(*) from public.line_stages where factory_on is not null);
  end if;
end $$;
select public.release_factory_po(:'save_order', '20000000-0000-0000-0000-000000000001');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000fa');
do $$ begin
  if (public.factory_tna() -> 'orders' -> 0 -> 'lines' -> 0 -> 'stages' -> 0 ->> 'planned_on') is null then
    raise exception 'the factory does not see the agreed plan after release';
  end if;
  perform public.save_factory_tna((select (public.factory_tna() -> 'orders' -> 0 ->> 'order_id')::uuid),
    jsonb_build_array(jsonb_build_object('line_id', (select (public.factory_tna() -> 'orders' -> 0 -> 'lines' -> 0 ->> 'id')), 'stage', 'fabric', 'factory_on', '2026-11-20')));
  raise exception 'the factory changed its dates after release';
exception when raise_exception then
  if sqlerrm not like 'The PO is released%' then raise; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select released_at is null or released_by <> auth.uid() from public.factory_pos where order_id = (select id from public.orders)) then
    raise exception 'factory PO not released';
  end if;
  if (select count(*) from public.line_stages) <> 26 then raise exception 'full TNA not saved: %', (select count(*) from public.line_stages); end if;
  begin
    update public.factory_pos set released_at = null;
    raise exception 'a release was undone';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.save_line_stages(:'save_order', jsonb_build_array(
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'stage', 'fabric', 'planned_on', '2026-11-01', 'done_on', '2026-11-03'),
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-103' and removed_at is null), 'stage', 'cutting', 'planned_on', '2026-11-10', 'done_on', '2026-11-09')));
do $$ begin
  if (select stage from public.orders) is not null then raise exception 'order stage should follow its slowest style (OZ-101 not started)'; end if;
end $$;
select public.save_line_stages(:'save_order', jsonb_build_array(
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-101'), 'stage', 'fabric', 'planned_on', '2026-11-01', 'done_on', '2026-11-02')));
do $$ begin
  if (select stage from public.orders) <> 'fabric' then raise exception 'order stage not moved to fabric: %', (select stage from public.orders); end if;
  if (select count(*) from public.line_stages) <> 26 then raise exception 'saving again added a duplicate row'; end if;
  begin
    perform public.save_line_stages((select id from public.orders), jsonb_build_array(
      jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-101'), 'stage', 'sewing')));
    raise exception 'unknown stage accepted';
  exception when check_violation then null;
  end;
  begin
    update public.line_stages set line_id = gen_random_uuid();
    raise exception 'a stage row was moved to another style';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  perform public.release_factory_po((select id from public.orders), '20000000-0000-0000-0000-000000000001');
  raise exception 'Quality released a PO';
exception when raise_exception then
  if sqlerrm not like 'Only the orders team%' then raise; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
-- Quality enters done dates, but never the plan.
select public.save_line_stages(:'save_order', jsonb_build_array(
  jsonb_build_object('line_id', (select id from public.order_lines where style = 'OZ-101'), 'stage', 'cutting', 'planned_on', '2030-01-01', 'done_on', '2026-11-12')));
do $$ begin
  if (select done_on::text || '|' || planned_on::text from public.line_stages
      where stage = 'cutting' and line_id = (select id from public.order_lines where style = 'OZ-101')) <> '2026-11-12|2026-11-01' then
    raise exception 'Quality''s done date not saved, or its plan date was taken';
  end if;
  update public.line_stages set planned_on = '2030-01-01' where stage = 'cutting';
  raise exception 'Quality changed a plan date';
exception when raise_exception then
  if sqlerrm not like 'Only the orders team can change the plan%' then raise; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');

-- A removed style can be added back.
select public.save_order(
  jsonb_build_object('id', :'save_order', 'buyer_id', '10000000-0000-0000-0000-000000000001', 'buyer_po', 'OZIA PO 001', 'status', 'open'),
  jsonb_build_array(
    jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-103'), 'style', 'OZ-103', 'qty', 50),
    jsonb_build_object('id', (select id from public.order_lines where style = 'OZ-101'), 'style', 'OZ-101', 'colour', 'Navy', 'qty', 520),
    jsonb_build_object('style', 'OZ-102', 'qty', 300)));
do $$ begin
  if (select count(*) from public.order_lines where removed_at is null) <> 3 then raise exception 'removed style could not be added back'; end if;
end $$;

do $$ begin
  delete from public.orders;
  raise exception 'merchandiser deleted an order';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  insert into public.history (company_id, table_name, row_id, action) values (public.current_company(), 'x', 'x', 'insert');
  raise exception 'history can be written to directly';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- the other business sees none of it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
do $$ begin
  if exists (select 1 from public.orders) or exists (select 1 from public.buyers) or exists (select 1 from public.factories)
     or exists (select 1 from public.history where company_id <> 'cccccccc-0000-0000-0000-000000000002') then
    raise exception 'another company can see Sourcingo data';
  end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'another company can see Sourcingo people'; end if;
end $$;
-- Its own order numbers start at 1, and it can use the same codes and names.
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Fashions"}') as other_buyer \gset
insert into public.factories (name) values ('Shree Knits');
select public.save_order(jsonb_build_object('buyer_id', :'other_buyer', 'buyer_po', 'OZIA PO 001'), '[{"style":"Q","qty":5}]');
do $$ begin
  if (select order_no from public.orders) <> 'SO-0001' then raise exception 'order numbers should run per company'; end if;
end $$;
-- It cannot attach a Sourcingo buyer to its order.
do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"STEAL"}', '[{"style":"Q","qty":5}]');
  raise exception 'used another company''s buyer';
exception when foreign_key_violation then null;
end $$;

-- ---------------------------------------------------------------- not added to any company
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  if exists (select 1 from public.orders) or exists (select 1 from public.buyers) or exists (select 1 from public.companies) then
    raise exception 'a stranger can see data';
  end if;
end $$;
do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"PO-X"}', '[{"style":"X","qty":1}]');
  raise exception 'stranger saved an order';
exception when raise_exception then
  if sqlerrm <> 'Your account is not switched on yet.' then raise; end if;
end $$;
do $$ begin
  update public.profiles set current_company_id = (select id from public.companies limit 1) where id = auth.uid();
  update public.profiles set current_company_id = '00000000-0000-0000-0000-000000000000' where id = auth.uid();
  raise exception 'stranger joined a company by switching to it';
exception when insufficient_privilege or foreign_key_violation or check_violation then null;
  when others then if sqlerrm not like '%row-level security%' then raise; end if;
end $$;

-- ---------------------------------------------------------------- anonymous
reset role;
set role anon;
do $$ begin
  perform 1 from public.orders;
  raise exception 'anon can read orders';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- nothing is ever deleted, even by the owner
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  delete from public.orders;
  raise exception 'owner deleted an order';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.buyers;
  raise exception 'owner deleted a buyer';
exception when insufficient_privilege then null;
end $$;
-- The owner cancels an invite by closing it; adding the email again reopens it.
do $$ begin
  perform public.add_member('later@sourcingo.in', 'accounts');
  update public.invites set closed_at = now() where email = 'later@sourcingo.in';
  if exists (select 1 from public.invites where email = 'later@sourcingo.in' and closed_at is null) then raise exception 'invite not cancelled'; end if;
  perform public.add_member('later@sourcingo.in', 'manager');
  if not exists (select 1 from public.invites where email = 'later@sourcingo.in' and closed_at is null and role = 'manager') then
    raise exception 'invite not reopened';
  end if;
end $$;
-- The owner can mark an order shipped without a final QC (for example a fabric-only order).
do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"OWNER-SHIPPED","status":"shipped"}', '[{"style":"F-1","qty":5}]');
  if (select status from public.orders where buyer_po = 'OWNER-SHIPPED') <> 'shipped' then raise exception 'owner could not ship'; end if;
end $$;
reset role;
