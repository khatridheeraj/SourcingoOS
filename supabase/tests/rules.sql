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

do $$ begin
  perform public.save_order('{"buyer_id":"10000000-0000-0000-0000-000000000001","buyer_po":"PO-DUP"}',
    '[{"style":"A","colour":"Red","qty":1},{"style":"a ","colour":"red","qty":2}]');
  raise exception 'duplicate style line was accepted';
exception when unique_violation then null;
end $$;

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
reset role;
