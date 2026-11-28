-- Buyer details switch (0126): the assistant merchandiser runs orders but sees nothing about buyers.
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
grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a5', 'asst@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'manager@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'), ('00000000-0000-0000-0000-0000000000a5'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'manager'), ('00000000-0000-0000-0000-00000000000c'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia","city":"London","notes":"Pays on time"}') as oz \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-1', 'ship_date', (current_date + 40)::text),
  '[{"style":"OZ-DRESS","qty":600,"buyer_rate":"450"}]') as o1 \gset
select public.set_buyer_delivery(:'oz', '12 Long Lane, London');
-- The owner switches Buyer details off for the assistant.
select public.set_member_perms('00000000-0000-0000-0000-0000000000a5', '{"buyers":false}');
select pg_temp.expect_error($$select public.set_member_perms('00000000-0000-0000-0000-0000000000a5', '{"buyers":"no"}')$$, 'Switches are on or off%');

reset role;
insert into public.buyer_messages (company_id, order_id, body, from_buyer) select company_id, id, 'Can we ship early?', true from public.orders where id = :'o1';
insert into public.inquiries (company_id, inquiry_no, buyer_id, product, status, created_by)
  select company_id, 'ENQ-0001', :'oz', 'Linen shirts', 'new', '00000000-0000-0000-0000-00000000000a' from public.orders where id = :'o1';
set role authenticated;

-- ---------------------------------------------------------------- who has it by default
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.can_see_buyers((select id from public.companies)), 'a merchandiser has Buyer details by default');
select pg_temp.expect((select real_name from public.buyer_names) = 'Ozia', 'and reads the real name');
select pg_temp.expect((select buyer_rate from public.line_prices(array[:'o1'::uuid])) = 450, 'and the selling price');
select pg_temp.expect((select count(*) from public.buyer_messages) = 1, 'and the buyer''s messages');
select pg_temp.expect((select delivery_address from public.buyer_details()) = '12 Long Lane, London', 'and the delivery address');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.can_see_buyers((select id from public.companies)), 'a manager has it');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect(public.can_see_buyers((select id from public.companies)), 'Accounts has it');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect(not public.can_see_buyers((select id from public.companies)), 'Quality does not');
select pg_temp.expect((select count(*) from public.buyer_names) = 0, 'Quality reads no real names');
select pg_temp.expect((select count(*) from public.buyer_messages) = 0, 'nor buyer messages');

-- ---------------------------------------------------------------- the assistant merchandiser
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect(public.can_edit_orders((select id from public.companies)), 'the assistant still runs orders');
select pg_temp.expect((select count(*) from public.orders) = 1, 'and sees the order');
select pg_temp.expect((select code from public.buyers) = 'BYR-OZ', 'with the buyer''s code');
select pg_temp.expect((select count(*) from public.buyer_names) = 0, 'but never the real name');
select pg_temp.expect_error($$select city from public.buyers$$, 'permission denied%');
select pg_temp.expect_error($$select delivery_address from public.buyers$$, 'permission denied%');
select pg_temp.expect((select count(*) from public.buyer_details()) = 0, 'no city, notes or address through buyer_details');
select pg_temp.expect((select buyer_rate from public.line_prices(array[:'o1'::uuid])) is null, 'no selling price');
select pg_temp.expect((select factory_rate from public.line_prices(array[:'o1'::uuid])) is null, 'the factory rate is there to fill (none set yet)');
select pg_temp.expect((select count(*) from public.buyer_messages) = 0, 'no buyer messages');
select pg_temp.expect((select count(*) from public.inquiries) = 0, 'no inquiries');
select pg_temp.expect((select count(*) from public.buyer_people) = 0, 'no buyer contacts');
select pg_temp.expect((select count(*) from public.incoming_pos) = 0, 'no buyer emails');
select pg_temp.expect((select count(*) from public.dispatches) = 0, 'no Dispatch');
select pg_temp.expect((select count(*) from public.history where table_name in ('order_lines', 'inquiries', 'buyer_messages')) = 0, 'no history of buyer records or selling prices');
select pg_temp.expect_error(format($$select public.answer_buyer(%L, 'Yes')$$, :'o1'), 'Only the team can answer the buyer%');
select pg_temp.expect_error(format($$select public.buyer_link(%L)$$, :'oz'), 'Only the orders team%');
select pg_temp.expect_error(format($$select public.add_buyer_person(%L, 'Ana')$$, :'oz'), 'Only the orders team%');
select pg_temp.expect_error(format($$select public.set_buyer_delivery(%L, 'Elsewhere')$$, :'oz'), 'Only the orders team%');
select pg_temp.expect_error($$insert into public.inquiries (company_id, inquiry_no, product, created_by) select id, 'ENQ-0002', 'Tees', auth.uid() from public.companies$$, '%row-level security%');
select pg_temp.expect_error($$select public.guarantee_claims()$$, 'Only the team reads claims%');
-- Saving the order (a new ship date) keeps the selling price the assistant never saw.
select public.save_order(jsonb_build_object('id', :'o1', 'buyer_id', :'oz', 'buyer_po', 'OZ-1', 'ship_date', (current_date + 45)::text),
  (select jsonb_agg(jsonb_build_object('id', id, 'style', style, 'qty', qty, 'buyer_rate', '')) from public.order_lines where order_id = :'o1'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select buyer_rate from public.line_prices(array[:'o1'::uuid])) = 450, 'the selling price survives the assistant''s save');
select pg_temp.expect((select ship_date from public.orders where id = :'o1') = current_date + 45, 'and the assistant''s change is saved');

-- Bell, morning brief: names hidden for the assistant, kept for the owner.
reset role;
select pg_temp.expect((select count(*) from public.bell_for('00000000-0000-0000-0000-0000000000a5', now() - interval '1 day') where kind in ('buyer_message', 'enquiry')) = 0,
  'the assistant''s bell has no buyer messages or enquiries');
select pg_temp.expect((select count(*) from public.bell_for('00000000-0000-0000-0000-00000000000b', now() - interval '1 day') where kind = 'buyer_message' and who = 'Ozia') = 1,
  'the merchandiser hears the buyer, by name');
select pg_temp.expect((public.brief_data_for('00000000-0000-0000-0000-0000000000a5') -> 'orders' -> 0 ->> 'buyer') = 'BYR-OZ', 'the assistant''s brief shows the code');
select pg_temp.expect((public.brief_data_for('00000000-0000-0000-0000-00000000000b') -> 'orders' -> 0 ->> 'buyer') = 'Ozia', 'the merchandiser''s brief shows the name');
select pg_temp.expect(jsonb_array_length(public.brief_data_for('00000000-0000-0000-0000-0000000000a5') -> 'inquiries_due') = 0, 'and no inquiries for the assistant');

-- Switching it back on gives everything back.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_member_perms('00000000-0000-0000-0000-0000000000a5', '{"buyers":null}');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect((select real_name from public.buyer_names) = 'Ozia', 'Buyer details back on: the name is back');

\echo 'Buyer details switch: all checks passed.'
