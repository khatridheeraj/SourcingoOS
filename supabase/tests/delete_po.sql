-- Deleting a wrong PO (0067): owner only, with a reason; hidden from everyone; frees the PO number; can be brought back.
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
select public.save_buyer('{"code":"BYR-FC","real_name":"Flavia"}') as fc \gset
reset role;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'fc', 'buyer_po', '101', 'ship_date', (current_date + 20)::text),
  '[{"style":"AV-135","description":"Cord set","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o \gset
select public.save_order(jsonb_build_object('buyer_id', :'fc', 'buyer_po', '102', 'ship_date', (current_date + 20)::text),
  '[{"style":"AV-141","description":"Cord set","qty":300,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o2 \gset
reset role;
-- The order came from a PO on Buyer POs.
insert into public.incoming_pos (company_id, source, received_at, status, buyer_id, buyer_po, order_id)
select company_id, 'upload', now(), 'added', buyer_id, buyer_po, id from public.orders where id = :'o';

-- ================================================================ only the owner, and only with a reason
set role authenticated;
select pg_temp.expect_error(format($$select public.remove_order('%s', 'entered twice')$$, :'o'), 'Only the owner can delete a PO.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.remove_order('%s', ' ')$$, :'o'), 'Say why this PO is being deleted%');

-- ================================================================ deleted: hidden from everyone
select public.remove_order(:'o', 'Entered twice by mistake');
select pg_temp.expect((select count(*) = 0 from public.orders where id = :'o'), 'the owner still sees the deleted order');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 0 from public.orders where id = :'o'), 'the merchandiser still sees the deleted order');
select pg_temp.expect((select count(*) = 1 from public.orders where id = :'o2'), 'the other order went too');
select pg_temp.expect((select count(*) = 0 from public.orders where id = :'o' and status = 'open'), 'the deleted order is still open');
select pg_temp.expect((select count(*) = 0 from public.deleted_orders() x, jsonb_array_elements(x) e), 'the merchandiser sees the deleted list');
-- Can't be changed while deleted.
update public.orders set notes = 'x' where id = :'o';
reset role;
select pg_temp.expect((select status = 'cancelled' and notes is null and removed_reason = 'Entered twice by mistake' and removed_status = 'open'
  and removed_by = '00000000-0000-0000-0000-00000000000a' from public.orders where id = :'o'), 'the order was not kept as deleted with its reason');
select pg_temp.expect((select status = 'not_po' from public.incoming_pos where order_id = :'o'), 'its buyer PO did not go back under Set aside');
select pg_temp.expect((select count(*) > 0 from public.history where table_name = 'orders' and row_id = :'o' and after ->> 'removed_at' is not null),
  'the delete is not in the activity log');

-- The owner sees it in the deleted list.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (x -> 0 ->> 'id') = :'o' and (x -> 0 ->> 'reason') = 'Entered twice by mistake' and (x -> 0 ->> 'pieces')::int = 500
  from public.deleted_orders() x), 'the owner''s deleted list is wrong');

-- ================================================================ the PO number is free again
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select jsonb_array_length(public.order_entry_warnings(:'fc', '101', array['AV-135']) -> 'same_po') = 0), 'the deleted order still warns as the same PO');
select public.save_order(jsonb_build_object('buyer_id', :'fc', 'buyer_po', '101', 'ship_date', (current_date + 25)::text),
  '[{"style":"AV-135","description":"Cord set","qty":450,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o3 \gset

-- ================================================================ bring back
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.restore_order('%s')$$, :'o'), 'PO 101 of this buyer is on SO-% now.%');
select public.remove_order(:'o3', 'Wrong quantity');
select public.restore_order(:'o');
select pg_temp.expect((select status = 'open' from public.orders where id = :'o'), 'the order did not come back open');
select pg_temp.expect_error(format($$select public.restore_order('%s')$$, :'o'), 'This PO is not deleted any more.%');
reset role;
select pg_temp.expect((select status = 'added' from public.incoming_pos where order_id = :'o'), 'its buyer PO did not come back as added');
select pg_temp.expect((select removed_at is null and removed_reason is null and removed_po is null and buyer_po = '101' from public.orders where id = :'o'), 'the delete marks stayed or the PO number did not come back');

-- ================================================================ what can't be deleted
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at)
select company_id, :'o2', '20000000-0000-0000-0000-000000000001', 'PB-1', current_date, 1000, now() + interval '1 day' from public.orders where id = :'o2';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.remove_order('%s', 'wrong')$$, :'o2'), 'Goods are already bought on this order%');
select pg_temp.expect_error(format($$select public.remove_order('%s', 'again')$$, :'o3'), 'This order is no longer here.%');
reset role;

-- ================================================================ a deleted order's factory PO is not emailed
update public.orders set removed_at = now(), status = 'cancelled' where id = :'o';
insert into public.factory_pos (company_id, order_id, factory_id, released_at, mail_requested_at, mail_to)
select company_id, id, '20000000-0000-0000-0000-000000000001', now(), now(), 'f@x.in' from public.orders where id = :'o';
select pg_temp.expect((select jsonb_array_length(public.po_mail_due()) = 0), 'a deleted order''s factory PO is due to be emailed');
