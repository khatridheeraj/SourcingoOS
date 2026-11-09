-- "See what they see" (0075): the orders team previews a buyer's or factory's own page, read-only.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora'), ('20000000-0000-0000-0000-000000000002', 'Rangrez');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-1', 'po_date', current_date, 'ship_date', current_date + 40),
  '[{"style":"O-1","qty":"80","buyer_rate":"400","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"300"}]'::jsonb) as ord2 \gset

-- Without a preview, a team member has no buyer or factory page.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error('select public.buyer_orders()', 'This login is not set up for a buyer.');
select pg_temp.expect_error('select public.factory_tna()', 'This login is not set up for a factory.');

-- Previewing Areeba shows Areeba's orders only, and its shipments list.
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah'));
select pg_temp.expect(public.buyer_orders() ->> 'buyer' = 'Areeba Fashion House', 'preview shows the wrong buyer');
select pg_temp.expect((select array_agg(o ->> 'buyer_po') = array['AFH07'] from jsonb_array_elements(public.buyer_orders() -> 'orders') o), 'preview shows another buyer''s orders');
select pg_temp.expect(jsonb_typeof(public.buyer_shipments()) = 'array', 'buyer shipments not a list');
select pg_temp.expect(jsonb_typeof(public.buyer_samples()) = 'array', 'buyer samples not a list');

-- A made-up or garbled id previews nothing.
select pg_temp.headers('{"x-preview-buyer":"30000000-0000-0000-0000-000000000009"}');
select pg_temp.expect_error('select public.buyer_orders()', 'This login is not set up for a buyer.');
select pg_temp.headers('{"x-preview-buyer":"not-a-uuid''; drop table x"}');
select pg_temp.expect_error('select public.buyer_orders()', 'This login is not set up for a buyer.');

-- Previewing a factory shows that factory's page.
select pg_temp.headers('{"x-preview-factory":"20000000-0000-0000-0000-000000000001"}');
select pg_temp.expect(public.factory_tna() ->> 'factory' = 'Kkora', 'factory preview shows the wrong factory');
select pg_temp.expect(jsonb_typeof(public.factory_samples()) = 'array' and jsonb_typeof(public.factory_step_updates()) = 'array'
  and jsonb_typeof(public.factory_line_files()) = 'array' and jsonb_typeof(public.factory_line_details()) = 'array', 'factory preview lists broken');

-- A preview never lets the team act in the buyer's or factory's name.
select pg_temp.expect(public.my_buyer() is null and public.my_factory() is null, 'a preview header made the team member a buyer or factory');

-- A buyer's own login always sees itself, whatever header it sends.
select pg_temp.headers('{}');
select public.buyer_link(:'oz') as secret \gset
select user_id as oz_user from public.buyer_links where buyer_id = :'oz' \gset
select pg_temp.as_user(:'oz_user');
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah', 'x-preview-factory', '20000000-0000-0000-0000-000000000001'));
select pg_temp.expect(public.buyer_orders() ->> 'buyer' = 'Ozia Retail', 'a buyer previewed another buyer');
select pg_temp.expect(public.viewing_factory() is null, 'a buyer previewed a factory');
select pg_temp.expect_error('select public.factory_tna()', 'This login is not set up for a factory.');

-- Nobody signed out can call them.
reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.buyer_shipments()', 'execute')
  and not has_function_privilege('anon', 'public.viewing_buyer()', 'execute'), 'signed-out visitors can call the preview functions');
