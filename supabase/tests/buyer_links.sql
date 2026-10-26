-- Buyer status links (0070): a private link opens the buyer's own orders with no password, like a factory's link.
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

-- Only the orders team makes a link.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.buyer_link('%s')$$, :'ah'), 'Only the orders team can send a buyer its link.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.buyer_link(:'ah') as secret \gset
select pg_temp.expect(length(:'secret') = 32 and :'secret' ~ '^[A-Za-z0-9_-]+$', 'link secret is not a 32-character address-safe string');
select pg_temp.expect(public.buyer_link(:'ah') = :'secret', 'asking again made a new link');
select public.buyer_link_login(:'secret') as login \gset
select pg_temp.expect((:'login'::jsonb ->> 'email') like 'buyer-%@links.sourcingo.in', 'link login not found');
select pg_temp.expect(public.buyer_link_login('wrong' || :'secret') is null, 'a wrong secret signs in');
select pg_temp.expect(public.buyer_link_login('') is null, 'an empty secret signs in');
select user_id as link_user from public.buyer_links \gset
select pg_temp.expect((select role = 'buyer' and buyer_id = :'ah' and active from public.members where user_id = :'link_user'), 'the link login is not Areeba''s buyer login');
reset role;
select pg_temp.expect((select encrypted_password = extensions.crypt(:'secret', encrypted_password) from auth.users where id = :'link_user'), 'the link''s password is not its secret');
select pg_temp.expect((select count(*) = 0 from public.history where position(:'secret' in coalesce(after::text, '')) > 0), 'the activity log keeps the link secret');
insert into auth.sessions (user_id) values (:'link_user');
insert into auth.refresh_tokens (user_id, revoked) values (:'link_user', false);
set role authenticated;

-- The link login sees its own orders only, and no links, factories or rates.
select pg_temp.as_user(:'link_user');
select public.buyer_orders() as seen \gset
select pg_temp.expect(jsonb_array_length(:'seen'::jsonb -> 'orders') = 1 and (:'seen'::jsonb -> 'orders' -> 0 ->> 'buyer_po') = 'AFH07', 'the buyer sees other buyers'' orders');
select pg_temp.expect(position('Kkora' in :'seen') = 0 and position('450' in :'seen') = 0, 'the buyer sees the factory or its rate');
select pg_temp.expect((select count(*) = 0 from public.buyer_links), 'a buyer reads the links');
select pg_temp.expect_error(format($$select public.buyer_link('%s', true)$$, :'ah'), 'Only the orders team can send a buyer its link.');

-- A new link stops the old one and signs it out.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.buyer_link(:'ah', true) as secret2 \gset
select pg_temp.expect(:'secret2' <> :'secret' and public.buyer_link_login(:'secret') is null and public.buyer_link_login(:'secret2') is not null, 'new link did not replace the old one');
reset role;
select pg_temp.expect((select bool_and(not_after <= now()) from auth.sessions where user_id = :'link_user'), 'the old link stayed signed in');
select pg_temp.expect((select bool_and(revoked) from auth.refresh_tokens where user_id = :'link_user'), 'the old link can still refresh');
set role authenticated;
select pg_temp.expect_error($$select public.buyer_link('30000000-0000-0000-0000-0000000000ff')$$, 'Pick one of your active buyers.');
