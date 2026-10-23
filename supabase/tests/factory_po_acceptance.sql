-- Factory POs accepted by email (0062): photos on every style before sending, queue and follow-ups for the
-- scheduled email task, acceptance by reply, link or team, and who may do what.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":500,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
reset role;
insert into public.factory_pos (company_id, order_id, factory_id) select company_id, :'o1', '20000000-0000-0000-0000-000000000001' from public.orders where id = :'o1';
select accept_token as tok from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001' \gset
set role authenticated;

-- Not released: can't email, and the link shows nothing.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.po_mail_blocker(:'o1', '20000000-0000-0000-0000-000000000001') like 'Lock and release%', 'blocked until released');
select pg_temp.expect(public.factory_po_link(:'o1', '20000000-0000-0000-0000-000000000001') = :'tok', 'orders team gets the link');
select pg_temp.expect_error($$select accept_token from public.factory_pos$$, '%permission denied%');
select pg_temp.expect_error($$select public.factory_po_doc(gen_random_uuid())$$, '%permission denied%');
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.po_mail_blocker(:'o1', '20000000-0000-0000-0000-000000000001') like 'Add the style photo first: AV-142%', 'photo needed');
select pg_temp.expect_error(format('select public.request_po_mail(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001', 'k@kkora.in'), 'Add the style photo first%');
reset role;
update public.order_lines set photo_path = company_id || '/' || order_id || '/styles/' || id || '/a.jpg' where order_id = :'o1';
set role authenticated;
select pg_temp.expect_error(format('select public.request_po_mail(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001', 'not-an-email'), 'Enter the factory''s email%');
select pg_temp.expect_error(format('select public.request_po_mail(%L, %L, %L, %L)', :'o1', '20000000-0000-0000-0000-000000000001', 'k@kkora.in', 'a@b.in, nope'), 'One of the CC%');
select public.request_po_mail(:'o1', '20000000-0000-0000-0000-000000000001', ' K@Kkora.in ', 'merch@sourcingo.in; a@b.in');
select pg_temp.expect((select mail_to = 'k@kkora.in' and mail_cc = 'merch@sourcingo.in, a@b.in' from public.factory_pos where order_id = :'o1'), 'queued, cleaned');
select pg_temp.expect((select email = 'k@kkora.in' from public.factories where id = '20000000-0000-0000-0000-000000000001'), 'factory email kept');
-- Quality can't email or mark accepted.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format('select public.request_po_mail(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001', 'k@kkora.in'), 'Only the orders team%');
select pg_temp.expect_error(format('select public.mark_po_accepted(%L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001'), 'Only the orders team%');
select pg_temp.expect(public.factory_po_link(:'o1', '20000000-0000-0000-0000-000000000001') is null, 'no link for quality');

-- The scheduled task (postgres): due, content, sent, follow-ups 2 hours later, a question pauses, acceptance stops.
reset role;
select pg_temp.expect(jsonb_array_length(public.po_mail_due()) = 1 and public.po_mail_due()->0->>'kind' = 'po' and public.po_mail_due()->0->>'to' = 'k@kkora.in', 'PO due to the factory');
update public.companies set po_mail_test_to = 'merch@sourcingo.in';
select pg_temp.expect(public.po_mail_due()->0->>'to' = 'merch@sourcingo.in' and public.po_mail_due()->0->>'test_for' = 'k@kkora.in' and public.po_mail_due()->0->'cc' = 'null'::jsonb, 'test mode sends to the test inbox only');
select pg_temp.expect((public.po_mail_content(:'o1', '20000000-0000-0000-0000-000000000001', 'po')->>'subject') = 'Purchase order SO/172/2026 from Sourcingo', 'subject with SO number');
select pg_temp.expect((public.po_mail_content(:'o1', '20000000-0000-0000-0000-000000000001', 'po')->>'html') like '%/po/' || :'tok' || '%', 'email links the PO');
select pg_temp.expect((public.po_mail_content(:'o1', '20000000-0000-0000-0000-000000000001', 'po')->>'html') not like '%AV-129%', 'other factory''s style not on it');
select public.po_mail_sent(:'o1', '20000000-0000-0000-0000-000000000001', 'thread-1', 'po');
select pg_temp.expect(jsonb_array_length(public.po_mail_due()) = 0, 'nothing due right after sending');
update public.factory_pos set mail_requested_at = now() - interval '4 hours', last_mailed_at = now() - interval '2 hours' where order_id = :'o1';
select pg_temp.expect(public.po_mail_due()->0->>'kind' = 'follow_up' and public.po_mail_due()->0->>'thread_id' = 'thread-1', 'follow-up due after 2 hours');
select public.po_mail_sent(:'o1', '20000000-0000-0000-0000-000000000001', null, 'follow_up');
select pg_temp.expect((select follow_ups = 1 and mail_thread_id = 'thread-1' from public.factory_pos where order_id = :'o1'), 'follow-up counted, thread kept');
update public.factory_pos set last_mailed_at = now() - interval '3 hours' where order_id = :'o1';
select public.po_mail_reply(:'o1', '20000000-0000-0000-0000-000000000001', false, 'Can the rate be 470?');
select pg_temp.expect(jsonb_array_length(public.po_mail_due()) = 0, 'a factory question pauses follow-ups');
select pg_temp.expect(jsonb_array_length(public.po_mail_waiting()) = 1, 'still waiting to accept');
-- The team answers and sends again: a fresh PO email in the same thread.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.request_po_mail(:'o1', '20000000-0000-0000-0000-000000000001', 'k@kkora.in', null);
reset role;
select pg_temp.expect(public.po_mail_due()->0->>'kind' = 'po' and public.po_mail_due()->0->>'thread_id' = 'thread-1', 'sent again in the thread');
select public.po_mail_reply(:'o1', '20000000-0000-0000-0000-000000000001', true, 'Accepted, thanks');
select pg_temp.expect((select accepted_via = 'email' and accept_note = 'Accepted, thanks' from public.factory_pos where order_id = :'o1'), 'accepted by email');
select pg_temp.expect(jsonb_array_length(public.po_mail_due()) = 0 and jsonb_array_length(public.po_mail_waiting()) = 0, 'nothing more once accepted');
select pg_temp.expect(public.accept_po_by_token(:'tok', 'Ramesh'), 'link accept on an accepted PO still says yes');
select pg_temp.expect((select accepted_via = 'email' from public.factory_pos where order_id = :'o1'), 'first acceptance kept');
select pg_temp.expect(not public.accept_po_by_token(gen_random_uuid(), ''), 'unknown token');
select pg_temp.expect((public.factory_po_doc(:'tok')->>'po_no') = 'SO/172/2026' and jsonb_array_length(public.factory_po_doc(:'tok')->'lines') = 1, 'doc for the link');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format('select public.request_po_mail(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001', 'k@kkora.in'), 'The factory has already accepted%');
select pg_temp.expect(public.inr(904700) = '9,04,700' and public.inr(545.5) = '545.50' and public.inr(12) = '12', 'rupees the Indian way');
