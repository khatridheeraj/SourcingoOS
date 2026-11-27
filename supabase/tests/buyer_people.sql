-- Buyer team access (0100): each person at a buyer gets their own link, name on messages, and can be stopped alone.
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

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-1', 'po_date', current_date, 'ship_date', current_date + 40),
  '[{"style":"O-1","qty":"80","buyer_rate":"400","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"300"}]'::jsonb) as ord2 \gset

-- Buyer team access (0100): each person at a buyer gets their own link and login.
select public.add_buyer_person(:'ah', 'Amy Hart', 'design', '+44 7700 900123', 'amy@areeba.co.uk') as amy \gset
select public.add_buyer_person(:'ah', 'Raj', 'accounts') as raj \gset
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'amy hart', 'design')$$, :'ah'), '%already has a link for amy hart.');
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'B', 'design')$$, :'ah'), 'Write the person''s name.');
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'Bo Lee', 'boss')$$, :'ah'), 'Pick what the person does.');
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'Bo Lee', 'design', '12')$$, :'ah'), 'Write the WhatsApp number%');
select public.buyer_person_link(:'amy') as s_amy \gset
select public.buyer_person_link(:'raj') as s_raj \gset
select pg_temp.expect(:'s_amy' <> :'s_raj' and public.buyer_person_link(:'amy') = :'s_amy', 'each person has one steady link');
select pg_temp.expect((public.buyer_link_login(:'s_amy') ->> 'name') = 'Amy Hart', 'a person''s link signs them in by name');
select user_id as amy_user from public.buyer_people where id = :'amy' \gset
select pg_temp.expect((select role = 'buyer' and buyer_id = :'ah' and active from public.members where user_id = :'amy_user'), 'Amy is a buyer login for Areeba');
select pg_temp.expect((select full_name = 'Amy Hart (Areeba Fashion House)' from public.profiles where id = :'amy_user'), 'the team sees Amy by name');

-- Quality can't hand out access; nobody reads the secrets.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'Zed', 'other')$$, :'ah'), 'Only the orders team%');
select pg_temp.expect((select count(*) = 0 from public.buyer_people), 'quality reads buyer people');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select secret from public.buyer_people$$, 'permission denied%');

-- Amy sees Areeba's orders only, writes under her name, and knows who she is.
select pg_temp.as_user(:'amy_user');
select public.buyer_orders() as seen \gset
select pg_temp.expect(jsonb_array_length(:'seen'::jsonb -> 'orders') = 1 and (:'seen'::jsonb -> 'orders' -> 0 ->> 'buyer_po') = 'AFH07', 'Amy sees other buyers'' orders');
select pg_temp.expect((public.buyer_me() ->> 'name') = 'Amy Hart', 'the page greets Amy');
select public.post_buyer_message(:'ord', 'Can we see the print strike-off?');
select pg_temp.expect((public.buyer_messages_mine() -> 0 ->> 'who') = 'Amy Hart', 'Amy''s message carries her name');
select pg_temp.expect_error(format($$select public.add_buyer_person('%s', 'Zed', 'other')$$, :'ah'), 'Only the orders team%');

-- Stopping Amy stops only Amy; a new link switches her back on.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.stop_buyer_person(:'amy');
select pg_temp.expect(public.buyer_link_login(:'s_amy') is null and public.buyer_link_login(:'s_raj') is not null, 'stopping Amy stopped someone else');
select pg_temp.expect_error(format($$select public.buyer_person_link('%s')$$, :'amy'), '%access is stopped%');
select public.buyer_person_link(:'amy', true) as s_amy2 \gset
select pg_temp.expect(:'s_amy2' <> :'s_amy' and public.buyer_link_login(:'s_amy2') is not null and public.buyer_link_login(:'s_amy') is null, 'a new link switches Amy back on');
