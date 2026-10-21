-- System recheck of 21 Oct 2026 (0054): closing an order short when a style never went, and the buyer's part shipments.
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
  ('00000000-0000-0000-0000-0000000000bb', 'buyer@areeba.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
select id as co from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Kkora');
select public.add_buyer_member('buyer@areeba.in', :'ah');
-- Two orders of two styles each. On both, only the dress went (300 of 600); the kurta was dropped.
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-1', 'ship_date', (current_date + 30)::text),
  '[{"style":"DRESS","qty":600,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":400},{"style":"KURTA","qty":400,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":300}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2', 'ship_date', (current_date + 30)::text),
  '[{"style":"DRESS2","qty":600,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":400},{"style":"KURTA2","qty":400,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":300}]') as o2 \gset
reset role;
select id as dress from public.order_lines where order_id = :'o1' and style = 'DRESS' \gset
select id as dress2 from public.order_lines where order_id = :'o2' and style = 'DRESS2' \gset
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/1', :'ah', current_date, 189000) returning id as i1 \gset
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/2', :'ah', current_date, 189000) returning id as i2 \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at, invoice_id, invoiced_at, eway_at, lr_no, lr_path, shipped_at)
values (:'co', :'o1', '20000000-0000-0000-0000-000000000001', 'K-1', current_date, 120000, now(), :'i1', now(), now(), 'LR-1', 'x/lr.jpg', now()) returning id as d1 \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at, invoice_id, invoiced_at, eway_at, lr_no, lr_path, shipped_at)
values (:'co', :'o2', '20000000-0000-0000-0000-000000000001', 'K-2', current_date, 120000, now(), :'i2', now(), now(), 'LR-2', 'x/lr.jpg', now()) returning id as d2 \gset
insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate) values (:'d1', :'dress', :'co', 300, 400), (:'d2', :'dress2', :'co', 300, 400);
-- Final QC passed on the dress of the first order only.
insert into public.qc_checks (company_id, order_id, line_id, kind, result) values (:'co', :'o1', :'dress', 'final', 'pass');
set role authenticated;

-- ================================================================ the order can't be marked shipped as it is
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$update public.orders set status = 'shipped' where id = '%s'$$, :'o1'), 'KURTA has no factory bill and invoice%');

-- ================================================================ buyer sees the part that went
select pg_temp.as_user('00000000-0000-0000-0000-0000000000bb');
select pg_temp.expect((select (l ->> 'shipped')::int = 300 from jsonb_array_elements(public.buyer_orders() -> 'orders') o,
                              jsonb_array_elements(o -> 'lines') l where l ->> 'style' = 'DRESS'), 'buyer does not see 300 pcs of DRESS shipped');
select pg_temp.expect((select (l ->> 'shipped')::int = 0 from jsonb_array_elements(public.buyer_orders() -> 'orders') o,
                              jsonb_array_elements(o -> 'lines') l where l ->> 'style' = 'KURTA'), 'buyer sees KURTA shipped');

-- ================================================================ closing short skips the style that never went
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.close_order_short(:'o1', 'Buyer dropped the kurta');
select pg_temp.expect((select status = 'shipped' and closed_short_at is not null from public.orders where id = :'o1'), 'close short with an unbilled style was refused');
-- Final QC still holds for what was billed: the second order's dress has none.
select pg_temp.expect_error(format($$select public.close_order_short('%s', 'Buyer dropped the kurta')$$, :'o2'), 'Record a passed final QC%');
select pg_temp.expect((select status = 'open' and closed_short_at is null from public.orders where id = :'o2'), 'a refused close short left the order changed');
-- The owner's override is unchanged.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.close_order_short(:'o2', 'Buyer dropped the kurta');
select pg_temp.expect((select status = 'shipped' from public.orders where id = :'o2'), 'the owner could not close short');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000bb');
select pg_temp.expect((select bool_and((o ->> 'closed_short')::boolean) from jsonb_array_elements(public.buyer_orders() -> 'orders') o), 'buyer does not see closed short');
