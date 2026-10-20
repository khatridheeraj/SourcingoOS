-- Locked targets, factory links and the morning brief (0033). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Anya');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"A-1","qty":"50","buyer_rate":"300","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"250"}]'::jsonb) as ord \gset
select id as k1 from public.order_lines where style = 'K-1' \gset
select id as a1 from public.order_lines where style = 'A-1' \gset

-- ---------------------------------------------------------------- targets lock at release
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_line_stages(:'ord', (select jsonb_agg(jsonb_build_object('line_id', l, 'stage', s, 'planned_on', current_date + 10 + n::int))
  from unnest(array['greige', 'fit_sample', 'fabric', 'printing', 'strike_off', 'pp_sample', 'size_set', 'cutting', 'stitching', 'inline',
                    'midline', 'finishing', 'packed', 'final_qc', 'ex_factory']) with ordinality u (s, n), unnest(array[:'k1'::uuid, :'a1'::uuid]) l));
-- Before release the merchandiser moves targets freely, and nothing is a baseline yet.
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'stage', 'greige', 'planned_on', current_date + 9)));
select pg_temp.expect((select baseline_on is null and planned_on = current_date + 9 from public.line_stages where line_id = :'k1' and stage = 'greige'),
  'a target before release was locked or given a baseline');
select public.request_factory_plan(:'ord', '20000000-0000-0000-0000-000000000001', 7);
select public.accept_targets_for_factory(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.owner_release(:'ord', '20000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) = 15 from public.line_stages where line_id = :'k1' and baseline_on = planned_on), 'release did not keep the baseline');
select pg_temp.expect((select count(*) = 0 from public.line_stages where line_id = :'a1' and baseline_on is not null), 'another factory''s plan got a baseline');
-- The merchandiser can't move a released target, even with a reason; done dates still go in.
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric', 'planned_on', current_date + 40, 'target_note', 'factory asked')))$$, :'ord', :'k1'),
  'Targets are locked once the factory PO is released.%');
select pg_temp.expect_error(format($$update public.line_stages set planned_on = planned_on + 5 where line_id = '%s' and stage = 'cutting'$$, :'k1'),
  'Targets are locked once the factory PO is released.%');
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'stage', 'greige', 'planned_on', current_date + 9, 'done_on', current_date)));
select pg_temp.expect((select done_on = current_date from public.line_stages where line_id = :'k1' and stage = 'greige'), 'done date not saved after release');
-- The other factory's plan isn't released, so its targets still move.
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'a1', 'stage', 'fabric', 'planned_on', current_date + 30)));
-- An extra step added after release gets its target once, which becomes its baseline.
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'stage', 'extra_0000abcd', 'label', 'Embroidery', 'planned_on', current_date + 20)));
select pg_temp.expect((select baseline_on = current_date + 20 from public.line_stages where line_id = :'k1' and stage = 'extra_0000abcd'),
  'a step planned after release has no baseline');
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'extra_0000abcd', 'not_needed', true)))$$, :'ord', :'k1'),
  'Targets are locked once the factory PO is released.%');
-- The owner moves one, but only with a reason; the baseline stays.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.save_line_stages('%s', jsonb_build_array(jsonb_build_object('line_id', '%s', 'stage', 'fabric', 'planned_on', current_date + 40)))$$, :'ord', :'k1'),
  'Say why the target moves.%');
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'stage', 'fabric', 'planned_on', current_date + 40, 'target_note', 'Buyer changed the fabric')));
select pg_temp.expect((select planned_on = current_date + 40 and baseline_on = current_date + 13 and target_note = 'Buyer changed the fabric'
  from public.line_stages where line_id = :'k1' and stage = 'fabric'), 'owner''s move not saved with its reason and baseline');
select pg_temp.expect_error(format($$update public.line_stages set baseline_on = current_date where line_id = '%s' and stage = 'fabric' returning 1/0$$, :'k1'),
  'division by zero');
select pg_temp.expect((select baseline_on = current_date + 13 from public.line_stages where line_id = :'k1' and stage = 'fabric'), 'a baseline was changed');
-- A save without target changes needs no reason, and keeps the old reason.
select public.save_line_stages(:'ord', jsonb_build_array(jsonb_build_object('line_id', :'k1', 'stage', 'fabric', 'planned_on', current_date + 40, 'done_on', current_date)));
select pg_temp.expect((select target_note = 'Buyer changed the fabric' from public.line_stages where line_id = :'k1' and stage = 'fabric'), 'old reason lost');

-- ---------------------------------------------------------------- factory links
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-000000000001')$$, 'Only the orders team can send a factory its link.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.factory_link('20000000-0000-0000-0000-000000000001') as secret \gset
select pg_temp.expect(length(:'secret') = 32 and :'secret' ~ '^[A-Za-z0-9_-]+$', 'link secret is not a 32-character address-safe string');
select pg_temp.expect(public.factory_link('20000000-0000-0000-0000-000000000001') = :'secret', 'asking again made a new link');
select pg_temp.expect((select count(*) = 1 from public.factory_links), 'link not kept');
select public.factory_link_login(:'secret') as login \gset
select pg_temp.expect((:'login'::jsonb ->> 'factory') = 'Kkora' and (:'login'::jsonb ->> 'email') like 'factory-%@links.sourcingo.in', 'link login not found');
select pg_temp.expect(public.factory_link_login('wrong' || :'secret') is null, 'a wrong secret signs in');
select pg_temp.expect(public.factory_link_login('') is null, 'an empty secret signs in');
select user_id as link_user from public.factory_links \gset
select pg_temp.expect((select role = 'factory' and factory_id = '20000000-0000-0000-0000-000000000001' and active from public.members where user_id = :'link_user'),
  'the link login is not Kkora''s factory login');
reset role;
select pg_temp.expect((select encrypted_password = extensions.crypt(:'secret', encrypted_password) and email_confirmed_at is not null from auth.users where id = :'link_user'),
  'the link''s password is not its secret');
select pg_temp.expect((select current_company_id is not null from public.profiles where id = :'link_user'), 'the link login has no company');
select pg_temp.expect((select count(*) = 1 from auth.identities where user_id = :'link_user'), 'the link login has no identity');
select pg_temp.expect((select count(*) = 0 from public.history where position(:'secret' in coalesce(after::text, '')) > 0), 'the activity log keeps the link secret');
insert into auth.sessions (user_id) values (:'link_user');
insert into auth.refresh_tokens (user_id, revoked) values (:'link_user', false);
set role authenticated;
-- The link login is an ordinary factory login: its own panel, nothing else.
select pg_temp.as_user(:'link_user');
select pg_temp.expect((public.factory_tna() ->> 'factory') = 'Kkora', 'the link login can''t open its panel');
select pg_temp.expect((select count(*) = 0 from public.factory_links), 'a factory reads the links');
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-000000000001', true)$$, 'Only the orders team can send a factory its link.');
-- A new link stops the old one and signs it out.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.factory_link('20000000-0000-0000-0000-000000000001', true) as secret2 \gset
select pg_temp.expect(:'secret2' <> :'secret' and public.factory_link_login(:'secret') is null and public.factory_link_login(:'secret2') is not null, 'new link did not replace the old one');
reset role;
select pg_temp.expect((select encrypted_password = extensions.crypt(:'secret2', encrypted_password) from auth.users where id = :'link_user'), 'new secret is not the password');
select pg_temp.expect((select bool_and(not_after <= now()) from auth.sessions where user_id = :'link_user'), 'the old link stayed signed in');
select pg_temp.expect((select bool_and(revoked) from auth.refresh_tokens where user_id = :'link_user'), 'the old link can still refresh');
set role authenticated;
select pg_temp.expect_error($$select public.factory_link('20000000-0000-0000-0000-0000000000ff')$$, 'Pick one of your active factories.');

-- ---------------------------------------------------------------- morning brief
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.brief_data() as b \gset
select pg_temp.expect((:'b'::jsonb ->> 'role') = 'merchandiser' and jsonb_array_length(:'b'::jsonb -> 'orders') = 1, 'brief has the wrong orders');
select pg_temp.expect(jsonb_array_length(:'b'::jsonb -> 'orders' -> 0 -> 'lines' -> 0 -> 'steps') = 16, 'brief misses steps (15 standard and the extra one)');
select pg_temp.expect((:'b'::jsonb -> 'orders' -> 0 ->> 'buyer') = 'Areeba Fashion House', 'brief has no buyer name');
select pg_temp.expect((:'b'::jsonb -> 'cheques') = 'null'::jsonb and (:'b'::jsonb ->> 'pos_to_check') = '0', 'merchandiser brief shows cheques or misses POs');
select pg_temp.expect(not jsonb_path_exists(:'b'::jsonb, '$.** ? (@ == 450 || @ == 555 || @ like_regex "^(450|555)(\\.0+)?$")'), 'brief shows a price');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((public.brief_data() -> 'pos_to_check') = 'null'::jsonb, 'Quality''s brief shows POs');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect((public.brief_data() -> 'cheques' ->> 'to_clear') = '0', 'Accounts brief misses cheques');
select pg_temp.as_user(:'link_user');
select pg_temp.expect_error('select public.brief_data()', 'The morning brief is for the Sourcingo team.');
select pg_temp.expect_error($$select public.brief_data_for('00000000-0000-0000-0000-00000000000a')$$, 'permission denied%');
select pg_temp.expect_error($$select public.brief_data_for_email('owner@sourcingo.in')$$, 'permission denied%');
reset role;
select pg_temp.expect((public.brief_data_for_email('OWNER@sourcingo.in') ->> 'role') = 'owner', 'the Gmail brief can''t find the owner');
