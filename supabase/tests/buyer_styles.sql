-- Your styles and order again (0101): the buyer's page keeps every style it ordered, and one tap asks to make it again.
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
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date - 90, 'ship_date', current_date + 10),
  '[{"style":"K-1","colour":"Indigo","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"},
    {"style":"K-2","qty":"50","buyer_rate":"600","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"480"}]'::jsonb) as ord1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH09', 'po_date', current_date - 5, 'ship_date', current_date + 50),
  '[{"style":"k-1 ","colour":"indigo","qty":"200","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord2 \gset
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-1', 'po_date', current_date, 'ship_date', current_date + 40),
  '[{"style":"O-1","qty":"80","buyer_rate":"400","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"300"}]'::jsonb) as ord3 \gset
select id as k1_old from public.order_lines where order_id = :'ord1' and style = 'K-1' \gset
select id as k2 from public.order_lines where order_id = :'ord1' and style = 'K-2' \gset
select id as o1 from public.order_lines where order_id = :'ord3' \gset
update public.orders set merchandiser_id = '00000000-0000-0000-0000-00000000000b' where id = :'ord2';

select public.add_buyer_person(:'ah', 'Amy Hart', 'design') as amy \gset
select user_id as amy_user from public.buyer_people where id = :'amy' \gset

-- Amy sees two styles: K-1 Indigo once (two orders, 300 pieces) and K-2.
select pg_temp.as_user(:'amy_user');
select public.buyer_styles() as st \gset
select pg_temp.expect(jsonb_array_length(:'st'::jsonb) = 2, 'one entry per style and colour');
select pg_temp.expect((:'st'::jsonb -> 0 ->> 'last_po') = 'AFH09' and (:'st'::jsonb -> 0 ->> 'times')::int = 2
                      and (:'st'::jsonb -> 0 ->> 'total')::int = 300, 'K-1 counts both orders, newest first');
select pg_temp.expect(:'st'::text not like '%Kkora%' and :'st'::text not like '%450%', 'the buyer sees a factory or its rate');
select pg_temp.expect(not exists (select 1 from jsonb_array_elements(:'st'::jsonb) e where e ->> 'style' = 'O-1'), 'another buyer''s style shows');

-- Order again: refused for another buyer's style, a bad qty or too-soon date; then once only.
select pg_temp.expect_error(format($$select public.buyer_reorder('%s', 100)$$, :'o1'), 'Pick one of your styles.');
select pg_temp.expect_error(format($$select public.buyer_reorder('%s', 0)$$, :'k1_old'), 'Enter how many pieces you need.');
select pg_temp.expect_error(format($$select public.buyer_reorder('%s', 100, current_date + 2)$$, :'k1_old'), 'Pick a date at least a week%');
select (:'st'::jsonb -> 0 ->> 'line_id') as k1_new \gset
select public.buyer_reorder(:'k1_new', 400, current_date + 60, 'Same print, add size XXL') as enq \gset
select pg_temp.expect(:'enq' like 'ENQ-%', 'a reorder becomes an inquiry');
select pg_temp.expect_error(format($$select public.buyer_reorder('%s', 100)$$, :'k1_old'), 'You already asked to make K-1 again.%');
select pg_temp.expect((public.buyer_styles() -> 0 -> 'asked' ->> 'no') = :'enq', 'the style shows its reorder being priced');
select pg_temp.expect((select count(*) = 0 from public.inquiries), 'the buyer reads the team''s inquiries');

-- The team sees it due today, for that order's merchandiser, with the buyer's words.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select merchandiser_id = '00000000-0000-0000-0000-00000000000b' and next_follow_up = (now() at time zone 'Asia/Kolkata')::date
                              and est_qty = 400 and unit = 'pcs' and contact_name = 'Amy Hart' and buyer_id = :'ah'
                              and product ilike 'Reorder: K-1 indigo' and notes like '%AFH09%add size XXL%' and status = 'new'
                       from public.inquiries where inquiry_no = :'enq'), 'the reorder inquiry is set up for the merchandiser');
-- Once priced and lost, the buyer can ask again.
update public.inquiries set status = 'lost', lost_reason = 'Buyer went elsewhere' where inquiry_no = :'enq';
select pg_temp.as_user(:'amy_user');
select pg_temp.expect((public.buyer_styles() -> 0 -> 'asked') = 'null'::jsonb, 'a closed reorder still shows as being priced');
select public.buyer_reorder(:'k2', 50) as enq2 \gset
select pg_temp.expect(:'enq2' like 'ENQ-%', 'K-2 reorder made');

-- Team logins can't use the buyer's reorder.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.buyer_reorder('%s', 100)$$, :'k2'), 'This login is not set up for a buyer.');
