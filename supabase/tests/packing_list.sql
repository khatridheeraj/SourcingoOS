-- Packing lists (0081): carton runs per style and size, checked and replaced as a whole.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000f1', 'factory@links.sourcingo.in');
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
insert into public.members (company_id, user_id, role, factory_id)
select c.id, u.id, u.role, u.factory from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner', null::uuid), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser', null),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality', null),
          ('00000000-0000-0000-0000-0000000000f1'::uuid, 'factory', '20000000-0000-0000-0000-000000000001'::uuid)) u (id, role, factory);
update public.profiles set current_company_id = (select id from public.companies);
select id as company from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset
reset role;
select id as line from public.order_lines where order_id = :'ord' \gset
insert into public.dispatches (id, company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at)
values ('50000000-0000-0000-0000-000000000001', :'company', :'ord', '20000000-0000-0000-0000-000000000001', 'KK/1', current_date, 45000, now() + interval '4 hours');
insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate) values ('50000000-0000-0000-0000-000000000001', :'line', :'company', 100, 450);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');

select pg_temp.expect(public.save_packing_list('50000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('carton_from', 1, 'carton_to', 4, 'line_id', :'line', 'sizes', '{"S": 5, "M": 10, "L": 5, "XL": 0}'::jsonb, 'net_kg', 6, 'gross_kg', 6.8),
  jsonb_build_object('carton_from', 5, 'carton_to', 5, 'line_id', :'line', 'sizes', '{"M": 20}'::jsonb))) = 2, 'list not saved');
select pg_temp.expect((select count(*) = 2 and bool_and(not sizes ? 'XL') from public.packing_rows where removed_at is null), 'rows or empty sizes wrong');
select pg_temp.expect((select cartons = 5 from public.dispatches where id = '50000000-0000-0000-0000-000000000001'), 'carton count not filled');

select pg_temp.expect_error(format($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":1,"carton_to":3,"line_id":"%s","sizes":{"S":1}},{"carton_from":3,"carton_to":4,"line_id":"%s","sizes":{"S":1}}]')$$, :'line', :'line'), 'Row 2: cartons 3 to 4 are already on another row.');
select pg_temp.expect_error(format($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":1,"carton_to":1,"line_id":"%s","sizes":{"S":0}}]')$$, :'line'), 'Row 1: a carton holds at least one piece.');
select pg_temp.expect_error(format($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":1,"carton_to":1,"line_id":"%s","sizes":{"S":1.5}}]')$$, :'line'), 'Row 1: pieces of S must be a whole number.');
select pg_temp.expect_error(format($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":2,"carton_to":1,"line_id":"%s","sizes":{"S":1}}]')$$, :'line'), 'Row 1: cartons run from%');
select pg_temp.expect_error(format($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":1,"line_id":"%s","sizes":{"S":1},"net_kg":5,"gross_kg":4}]')$$, :'line'), 'Row 1: gross weight%');
select pg_temp.expect_error($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[{"carton_from":1,"line_id":"60000000-0000-0000-0000-000000000001","sizes":{"S":1}}]')$$, 'Row 1: that style is not in this lot.');
select pg_temp.expect((select count(*) = 2 from public.packing_rows where removed_at is null), 'a refused save lost the list');

-- Saving again replaces the list and keeps the old rows; Quality and factories can't read or write it.
select public.save_packing_list('50000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('carton_from', 1, 'carton_to', 10, 'line_id', :'line', 'sizes', '{"Pieces": 10}'::jsonb)));
select pg_temp.expect((select count(*) filter (where removed_at is null) = 1 and count(*) = 3 from public.packing_rows), 'old rows not kept as removed');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect((select count(*) = 0 from public.packing_rows), 'Quality reads packing lists');
select pg_temp.expect_error($$select public.save_packing_list('50000000-0000-0000-0000-000000000001', '[]')$$, 'Only the orders team makes packing lists.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) = 0 from public.packing_rows), 'a factory reads packing lists');
