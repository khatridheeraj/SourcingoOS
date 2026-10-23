-- The factory PO in Sourcingo's own format (0061): PO number and delivery line per factory PO, the factory's
-- address/GSTIN/email, and our own PO details, each changed only by the people allowed to.
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
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":500,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
reset role;
insert into public.factory_pos (company_id, order_id, factory_id) select company_id, :'o1', '20000000-0000-0000-0000-000000000001' from public.orders where id = :'o1';
set role authenticated;

-- The merchandiser sets the PO number and delivery line, and the factory's details.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_factory_po_details(:'o1', '20000000-0000-0000-0000-000000000001', ' SO/172/2026 ', '15/11/26 half lot, 2nd lot 20/11/26');
select pg_temp.expect((select po_no = 'SO/172/2026' and delivery_note like '15/11/26%' from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001'), 'PO number and delivery line saved, trimmed');
select public.set_factory_po_details(:'o1', '20000000-0000-0000-0000-000000000001', '', '');
select pg_temp.expect((select po_no is null and delivery_note is null from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001'), 'empty clears back to the default');
select pg_temp.expect_error(format('select public.set_factory_po_details(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000002', 'X'), 'Ask the factory for its plan first%');
update public.factories set address = 'GH-6, Sector 6, Vidyadhar Nagar, Jaipur 302039', gstin = '08ABDFK7531J1Z4', email = 'kkora@example.com' where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect((select gstin = '08ABDFK7531J1Z4' from public.factories where id = '20000000-0000-0000-0000-000000000001'), 'factory GSTIN saved');
select pg_temp.expect_error($$update public.factories set gstin = 'bad' where id = '20000000-0000-0000-0000-000000000001'$$, '%factories_gstin_check%');
-- Only the owner sets our details.
select pg_temp.expect_error($$select public.set_company_po_details('Sourcingo Pvt. Ltd.', 'a', 'b', '08ABRCS2561B1Z9', '1', 'x@y.in')$$, 'Only the owner%');

-- Quality can't change a factory PO or a factory.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format('select public.set_factory_po_details(%L, %L, %L, null)', :'o1', '20000000-0000-0000-0000-000000000001', 'X'), 'Only the orders team%');
update public.factories set email = 'q@q.in' where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect((select email = 'kkora@example.com' from public.factories where id = '20000000-0000-0000-0000-000000000001'), 'quality cannot change a factory');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_company_po_details('Sourcingo Pvt. Ltd.', 'Plot 19, Maruti Colony, Sanganer, Jaipur', '', '08abrcs2561b1z9', '9602445110', 'Sourcingo.India@gmail.com');
select pg_temp.expect((select legal_name = 'Sourcingo Pvt. Ltd.' and gstin = '08ABRCS2561B1Z9' and ship_address is null and email = 'sourcingo.india@gmail.com' from public.companies), 'owner sets our details, GSTIN upper, email lower');
select pg_temp.expect_error($$select public.set_company_po_details('S', 'a', 'b', 'nope', '1', 'x@y.in')$$, 'That GSTIN doesn''t look right%');
