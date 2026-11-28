-- Factory self-onboarding (0110): an ask becomes a factory, the factory fills its profile and asks for a visit.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name, city) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts', 'Sanganer' from public.companies;
select id as co from public.companies \gset

-- Two asks from the website: one new factory, one we already know by name.
select public.site_join_factory('{"name":"Rang Prints","city":"Bagru","contact_name":"Mohan","phone":"9829000001","makes":"Hand block printed kurtas","pieces_month":4000,"people":35}');
select public.site_join_factory('{"name":"shreeji arts","city":"Sanganer","contact_name":"Ravi","phone":"9829000002","makes":"Kaftans"}');
select id as a1 from public.factory_applications where name = 'Rang Prints' \gset
select id as a2 from public.factory_applications where name = 'shreeji arts' \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format('select public.add_factory_from_application(%L)', :'a1'), 'Only the orders team%'); -- Quality is not
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.add_factory_from_application(:'a1') as f1 \gset
select pg_temp.expect(public.add_factory_from_application(:'a1') = :'f1', 'adding twice gives the same factory');
select pg_temp.expect(public.add_factory_from_application(:'a2') = '20000000-0000-0000-0000-000000000002', 'a known name finds that factory');
select pg_temp.expect((select status = 'added' and factory_id = :'f1' from public.factory_applications where id = :'a1'), 'the ask is marked added');
select pg_temp.expect((select city = 'Bagru' and phone = '9829000001' from public.factories where id = :'f1'), 'the factory has the ask''s details');
select pg_temp.expect((select people = 35 and pieces_month = 4000 from public.factory_profiles where factory_id = :'f1'), 'the profile starts from the ask');
select public.factory_link(:'f1') as secret \gset
reset role;
select user_id as rang from public.members where factory_id = :'f1' \gset
set role authenticated;

-- The factory fills its own profile.
select pg_temp.as_user(:'rang');
select public.save_factory_profile(null, jsonb_build_object('makes', '["Kurtas","Printed fabric","Kurtas"]'::jsonb, 'machines', '40', 'gstin', '08abcde1234f1z5',
  'photos', jsonb_build_array(:'co' || '/factory-files/' || :'f1' || '/photos/a.jpg')));
select pg_temp.expect((select jsonb_array_length(p -> 'makes') = 2 and (p ->> 'machines')::int = 40 and (p ->> 'people')::int = 35
  and p ->> 'gstin' = '08ABCDE1234F1Z5' and jsonb_array_length(p -> 'photos') = 1 from public.factory_profile_mine() p), 'the profile saved, untouched fields kept');
select pg_temp.expect(not exists (select 1 from public.factory_profiles), 'a factory cannot read the profiles table');
select pg_temp.expect_error(format('select public.save_factory_profile(null, %L)', jsonb_build_object('photos', jsonb_build_array(:'co' || '/factory-files/20000000-0000-0000-0000-000000000002/photos/x.jpg'))), 'Those photos belong%');
select pg_temp.expect_error('select public.save_factory_profile(null, ''{"gstin":"123"}'')', 'A GSTIN is%');
select pg_temp.expect_error('select public.save_factory_profile(null, ''{"people":"lots"}'')', 'Give people%');
select pg_temp.expect_error('select public.save_factory_profile(''20000000-0000-0000-0000-000000000002'', ''{"about":"x"}'')', 'Only the factory itself%');
select pg_temp.expect((public.factory_profile_mine() ->> 'machines')::int = 40, 'the factory reads its own profile');
select pg_temp.expect(not (public.factory_profile_mine() ? 'company_id'), 'no internal fields');

-- It asks for a visit; the team books it.
select pg_temp.expect_error('select public.ask_factory_visit(current_date - 1, null)', 'Pick a day%');
select public.ask_factory_visit(current_date + 3, 'Any weekday');
select pg_temp.expect((select (p ->> 'visit_from')::date = current_date + 3 and p ->> 'visit_on' is null from public.factory_profile_mine() p), 'visit asked');
select pg_temp.expect_error(format('select public.book_factory_visit(%L, current_date + 5)', :'f1'), 'Only the owner%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.factory_profile_mine() is null, 'Quality has no factory profile of its own');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.book_factory_visit(:'f1', current_date + 5);
select pg_temp.expect((select visit_on = current_date + 5 from public.factory_profiles where factory_id = :'f1'), 'visit booked');
select pg_temp.expect((select count(*) = 2 from public.factory_profiles), 'the team reads profiles');
select public.save_factory_profile(:'f1', '{"about":"Bagru block printers since 1998"}');

reset role;
select 'factory_onboarding: ok';
