-- The public website (0096): visitors ask for a costing or ask to join as a factory, and read only the Guarantee switch.
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
grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'), ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);

-- A visitor (no sign-in).
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect((public.site_facts() ->> 'guarantee')::boolean = false, 'the Guarantee starts off');
select public.site_ask_costing('{"company":"North Loom Ltd","name":"Amy Hart","email":"Amy@NorthLoom.co.uk","country":"United Kingdom",
  "product":"Block-print cotton kaftan, 3 colours","qty":"1,200 pcs","target":"USD 9","when":"March","message":"Sample ready in London."}') as enq \gset
select pg_temp.expect(:'enq' like 'ENQ-%', 'a costing ask gets an inquiry number');
select pg_temp.expect_error($$select public.site_ask_costing('{"name":"Amy Hart","email":"amy@northloom.co.uk","product":"Another kaftan"}')$$, 'We already have your request%');
select pg_temp.expect_error($$select public.site_ask_costing('{"name":"Bo","email":"not-an-email","product":"Kurta"}')$$, '%email address%');
select pg_temp.expect_error($$select public.site_ask_costing('{"name":"Bo Lee","email":"bo@x.com","product":""}')$$, '%what you would like made%');
select pg_temp.expect_error($$select count(*) from public.inquiries$$, 'permission denied%');
select pg_temp.expect_error($$select count(*) from public.factory_applications$$, 'permission denied%');
select public.site_join_factory('{"name":"Shree Prints","city":"Sanganer","contact_name":"Ramesh","phone":"+91 98290 00000","makes":"Kurtas, co-ord sets","pieces_month":"8000","people":"45"}');
select pg_temp.expect_error($$select public.site_join_factory('{"name":"Shree Prints","city":"Sanganer","contact_name":"Ramesh","phone":"+91 98290 00000","makes":"Kurtas"}')$$, 'We already have your details%');
select pg_temp.expect_error($$select public.site_join_factory('{"name":"X Prints","city":"Jaipur","contact_name":"Ram","phone":"12","makes":"Kurtas"}')$$, '%mobile number%');
reset role;

-- The orders team sees both; follow-up is due today so it shows on Home.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select from_site and country = 'United Kingdom' and est_qty = 1200 and contact = 'amy@northloom.co.uk'
  and prospect = 'North Loom Ltd' and next_follow_up = (now() at time zone 'Asia/Kolkata')::date and notes like '%Target price: USD 9%'
  from public.inquiries where inquiry_no = :'enq'), 'the ask lands as a website inquiry due today');
select pg_temp.expect((select count(*) = 1 from public.factory_applications where status = 'new' and pieces_month = 8000), 'the factory ask waits for the team');
update public.factory_applications set status = 'contacted', status_by = auth.uid(), status_at = now();
select pg_temp.expect_error($$update public.factory_applications set name = 'Other'$$, 'permission denied%');
-- Quality does not work with enquiries.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) = 0 from public.factory_applications), 'quality does not see factory asks');
reset role;
