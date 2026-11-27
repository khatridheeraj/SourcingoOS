-- A buyer page for a new lead (0102): one tap makes the asker a buyer with their own link, and the ask moves to their page.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

-- Two website asks: a new company, and one already a buyer.
select public.site_ask_costing('{"company":"Maison Lune Paris","name":"Claire Dubois","email":"Claire@maisonlune.fr","phone":"+33 6 12 34 56 78","country":"France","product":"Linen kaftan","qty":"400"}') as q1 \gset
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
reset role;
select public.site_ask_costing('{"company":"ozia retail","name":"Omar","email":"omar@ozia.com","product":"Co-ord set"}') as q2 \gset
set role authenticated;
select id as i1 from public.inquiries where inquiry_no = :'q1' \gset
select id as i2 from public.inquiries where inquiry_no = :'q2' \gset

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.make_buyer_from_inquiry('%s')$$, :'i1'), 'Only the orders team%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.make_buyer_from_inquiry(:'i1') as r1 \gset
select pg_temp.expect((:'r1'::jsonb ->> 'existing')::boolean = false and (:'r1'::jsonb ->> 'name') = 'Claire Dubois', 'a new buyer was made for Claire');
select pg_temp.expect((select b.code = 'BYR-MLP' and n.real_name = 'Maison Lune Paris' from public.buyers b join public.buyer_names n on n.buyer_id = b.id
                       where b.id = (:'r1'::jsonb ->> 'buyer_id')::uuid), 'the buyer is BYR-MLP, Maison Lune Paris');
select pg_temp.expect((select email = 'claire@maisonlune.fr' and phone = '+33 6 12 34 56 78' and job = 'sourcing' from public.buyer_people
                       where id = (:'r1'::jsonb ->> 'person_id')::uuid), 'Claire has her own link with her email and phone');
select pg_temp.expect((select buyer_id = (:'r1'::jsonb ->> 'buyer_id')::uuid and asked_on_page and status = 'new' from public.inquiries where id = :'i1'), 'the ask moved to her page');
select pg_temp.expect_error(format($$select public.make_buyer_from_inquiry('%s')$$, :'i1'), '%is already for a buyer%');

-- Ozia is already a buyer: linked, not made again. A second Maison Lune would get BYR-MLP2.
select public.make_buyer_from_inquiry(:'i2') as r2 \gset
select pg_temp.expect((:'r2'::jsonb ->> 'existing')::boolean and (:'r2'::jsonb ->> 'buyer_id') = :'oz', 'Ozia was linked, not made again');
select pg_temp.expect((select count(*) = 1 from public.buyer_names where lower(real_name) = 'ozia retail'), 'Ozia twice');
reset role;
select pg_temp.expect(public.buyer_code_for('Maison Lune Paris') = 'BYR-MLP2' and public.buyer_code_for('The Co') like 'BYR-%', 'codes stay unique');
set role authenticated;

-- Claire sees her ask on her page.
select user_id as claire from public.buyer_people where id = (:'r1'::jsonb ->> 'person_id')::uuid \gset
select pg_temp.as_user(:'claire');
select pg_temp.expect(jsonb_array_length(public.buyer_costings_mine()) = 1 and (public.buyer_costings_mine() -> 0 ->> 'product') = 'Linen kaftan', 'Claire sees her costing ask');
