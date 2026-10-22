-- The buyer's PO on each order (0059): the orders team adds and takes off PO files; nobody else sees them.
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
select id as co from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-1', 'ship_date', (current_date + 40)::text),
  '[{"style":"DRESS","qty":600}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2', 'ship_date', (current_date + 40)::text),
  '[{"style":"TOP","qty":100}]') as o2 \gset

-- The merchandiser adds the PO.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.add_order_po_files(:'o1', jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'o1' || '/a.pdf', 'name', 'AH-1 PO.pdf',
  'type', 'application/pdf', 'size', 120000)));
select pg_temp.expect((select count(*) = 1 from public.order_po_files where order_id = :'o1'), 'the PO file was not added');
select pg_temp.expect(public.orders_with_po_file(array[:'o1'::uuid, :'o2'::uuid]) = array[:'o1'::uuid], 'only AH-1 has a PO file');
-- Files must sit in the order's own folder and be a PO file type.
select pg_temp.expect_error(format($$select public.add_order_po_files('%s', '[{"path":"%s/%s/b.pdf","name":"x","type":"application/pdf","size":5}]')$$, :'o1', :'co', :'o2'), 'That file didn''t upload properly%');
select pg_temp.expect_error(format($$select public.add_order_po_files('%s', '[{"path":"%s/%s/b.exe","name":"x","type":"application/x-msdownload","size":5}]')$$, :'o1', :'co', :'o1'), 'That file didn''t upload properly%');
select pg_temp.expect_error(format($$select public.add_order_po_files('%s', '[]')$$, :'o1'), 'Pick the PO file first%');

-- Quality neither adds nor sees the buyer's PO.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.add_order_po_files('%s', '[{"path":"%s/%s/c.pdf","name":"x","type":"application/pdf","size":5}]')$$, :'o1', :'co', :'o1'), 'Only the orders team%');
select pg_temp.expect((select count(*) = 0 from public.order_po_files), 'Quality can see PO files');
select pg_temp.expect(cardinality(public.orders_with_po_file(array[:'o1'::uuid])) = 0, 'Quality learns which orders have a PO');
reset role;
select id as f1 from public.order_po_files limit 1 \gset
set role authenticated;
select pg_temp.expect_error(format($$select public.remove_order_po_file('%s')$$, :'f1'), 'Only the orders team%');

-- Taking it off keeps the row, out of the list.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.remove_order_po_file(:'f1');
select pg_temp.expect((select removed_at is not null from public.order_po_files where id = :'f1'), 'the file was not taken off');
select pg_temp.expect(cardinality(public.orders_with_po_file(array[:'o1'::uuid])) = 0, 'a removed file still counts');
select pg_temp.expect_error(format($$select public.remove_order_po_file('%s')$$, :'f1'), 'Only the orders team%');

-- A PO that came by email counts too.
reset role;
insert into public.incoming_pos (company_id, source, status, files, order_id, created_by)
values (:'co', 'upload', 'added', jsonb_build_array(jsonb_build_object('path', :'co' || '/x/po.pdf', 'name', 'po.pdf', 'type', 'application/pdf', 'size', 5)), :'o2', null);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.orders_with_po_file(array[:'o1'::uuid, :'o2'::uuid]) = array[:'o2'::uuid], 'the emailed PO does not count');

-- A factory PO is issued only against a PO received from the buyer (0060).
reset role;
insert into public.factories (id, company_id, name) values ('20000000-0000-0000-0000-000000000001', :'co', 'Kkora');
update public.order_lines set factory_id = '20000000-0000-0000-0000-000000000001' where order_id in (:'o1', :'o2');
\set fac 20000000-0000-0000-0000-000000000001
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.release_blocker(:'o1', :'fac') like 'The buyer''s PO isn''t on file yet%', 'AH-1 has no PO file but was not blocked');
select pg_temp.expect_error(format($$select public.release_factory_po('%s', '%s')$$, :'o1', :'fac'), 'The buyer''s PO isn''t on file yet%');
select pg_temp.expect_error(format($$select public.request_po_lock('%s', '%s')$$, :'o1', :'fac'), 'The buyer''s PO isn''t on file yet%');
-- With the emailed PO, AH-2 moves on to the usual plan checks.
select pg_temp.expect(public.release_blocker(:'o2', :'fac') not like 'The buyer''s PO%', 'AH-2 has its emailed PO but was blocked');
