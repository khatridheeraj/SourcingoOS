-- Buyer messages (0084): the buyer writes on its own open orders, the team answers, open messages wait until answered or Done.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.headers(p jsonb) returns void language sql as $$
  select set_config('request.headers', p::text, false);
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2201', 'ship_date', (current_date + 40)::text),
  '[{"style":"AH-DRESS-01","qty":600}]') as o1 \gset
select public.buyer_link(:'ah') as ah_secret \gset
select public.buyer_link(:'oz') as oz_secret \gset
reset role;
select user_id as ah_user from public.buyer_links where buyer_id = :'ah' \gset
select user_id as oz_user from public.buyer_links where buyer_id = :'oz' \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-77', 'ship_date', (current_date + 30)::text),
  '[{"style":"OZ-TOP-01","qty":300}]') as o2 \gset

-- The buyer writes on its own order; blank or someone else's order is refused; the team can't write as the buyer.
select pg_temp.as_user(:'ah_user');
select public.post_buyer_message(:'o1', '  Can we move the ship date by a week?  ') as m1 \gset
select pg_temp.expect(public.buyer_messages_mine() -> 0 ->> 'body' = 'Can we move the ship date by a week?', 'body not trimmed');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o1', '   '), 'Write your message first.');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o2', 'hello'), 'That order is not open any more%');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o1', repeat('x', 2001)), 'Keep the message under%');
select pg_temp.expect_error('insert into public.buyer_messages (company_id, order_id, body, from_buyer) select company_id, id, ''x'', true from public.orders limit 1', 'permission denied%');
-- A buyer can't read the table directly, only through buyer_messages_mine.
select pg_temp.expect((select count(*) from public.buyer_messages) = 0, 'buyer reads the table');
select pg_temp.expect(jsonb_array_length(public.buyer_messages_mine()) = 1, 'buyer does not see its message');
select pg_temp.as_user(:'oz_user');
select pg_temp.expect(jsonb_array_length(public.buyer_messages_mine()) = 0, 'other buyer sees it');
select pg_temp.expect_error(format('select public.answer_buyer(%L, %L)', :'o2', 'hi'), 'Only the team can answer the buyer.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o1', 'x'), 'This login is not set up for a buyer.');

-- The team sees it open; an answer closes it and shows to the buyer as Sourcingo, with no name.
select pg_temp.expect((select count(*) from public.buyer_messages where from_buyer and answered_at is null) = 1, 'not open for the team');
select public.answer_buyer(:'o1', 'Yes, new date 20 Dec.') as a1 \gset
select pg_temp.expect((select answered_by from public.buyer_messages where id = :'m1') = '00000000-0000-0000-0000-00000000000a', 'answer did not close it');
select pg_temp.as_user(:'ah_user');
select public.buyer_messages_mine() as mine \gset
select pg_temp.expect(jsonb_array_length(:'mine'::jsonb) = 2 and not (:'mine'::jsonb -> 1 ->> 'from_buyer')::boolean, 'buyer does not see the answer');
select pg_temp.expect(not (:'mine'::jsonb::text like '%created_by%' or :'mine'::jsonb::text like '%answered%'), 'buyer sees who answered');

-- Done without answering: Quality can clear it too; nothing else changes.
select public.post_buyer_message(:'o1', 'Thanks. And the carton marks?') as m2 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.buyer_messages_done(:'o1') = 1, 'done did not clear one');
select pg_temp.expect(public.buyer_messages_done(:'o1') = 0, 'done cleared twice');

-- A team preview reads the buyer's messages but can't write as the buyer.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah'));
select pg_temp.expect(jsonb_array_length(public.buyer_messages_mine()) = 3, 'preview does not read');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o1', 'x'), 'This login is not set up for a buyer.');
select pg_temp.headers('{}');

-- Once the order is not open any more, the buyer can't write on it and it leaves its page.
reset role;
update public.orders set status = 'cancelled' where id = :'o1';
set role authenticated;
select pg_temp.as_user(:'ah_user');
select pg_temp.expect(jsonb_array_length(public.buyer_messages_mine()) = 0, 'closed order still listed');
select pg_temp.expect_error(format('select public.post_buyer_message(%L, %L)', :'o1', 'x'), 'That order is not open any more%');
reset role;
\echo 'buyer_messages: ok'
