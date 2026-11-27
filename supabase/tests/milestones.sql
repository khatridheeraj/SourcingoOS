-- Milestone payments (0113): plans, per-order plans, ship and delivery days.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;
create function pg_temp.headers(p jsonb) returns void language sql as $$
  select set_config('request.headers', p::text, false);
$$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'accounts@sourcingo.in'), ('00000000-0000-0000-0000-00000000000d', 'merchandiser@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'accounts' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000d', 'merchandiser' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name, city, tally_ledger) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP', 'Jaipur', 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name, city) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts', 'Sanganer' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-ZL","real_name":"Zolo Label"}') as zl \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'po_date', (current_date - 10)::text, 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"buyer_rate":200,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":120},
    {"style":"AV-129","qty":300,"buyer_rate":100,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":60}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'zl', 'buyer_po', 'ZL-9', 'ship_date', (current_date + 20)::text),
  '[{"style":"ZL-1","qty":200,"buyer_rate":150,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":90}]') as o2 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.factory_link('20000000-0000-0000-0000-000000000002') as s_secret \gset
select public.buyer_link(:'ah') as ah_secret \gset
reset role;
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as shreeji from public.members where factory_id = '20000000-0000-0000-0000-000000000002' \gset
select user_id as areeba from public.members where buyer_id = :'ah' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select id as z_line from public.order_lines where order_id = :'o2' \gset
select company_id as co from public.orders where id = :'o1' \gset
-- Kkora's AV-142 failed then passed; Shreeji's AV-129 not checked yet.
insert into public.qc_checks (company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes) values
  (:'co', :'o1', :'k_line', 'final', current_date - 3, 'fail', 80, 8, 'Open seams'),
  (:'co', :'o1', :'k_line', 'recheck', current_date - 1, 'pass', 80, 2, null);

set role authenticated;

-- Off by default: the owner sees the plan; Accounts records money; the merchandiser can't read money.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- The default follows the old deposit: 30% with the PO, 70% on the pass.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.guarantee_terms() -> 'plan' = '[{"label":"Deposit","pct":30,"when":"po","days":0},{"label":"Balance","pct":70,"when":"passed","days":0}]'::jsonb,
  'default plan is 30/70');
select public.guarantee_orders() as g \gset
select pg_temp.expect((select (e ->> 'own_plan')::boolean = false and e ->> 'shipped_on' is null and e ->> 'delivered_on' is null
  and jsonb_array_length(e -> 'plan') = 2 from jsonb_array_elements((:'g'::jsonb) -> 'orders') e where e ->> 'order_id' = :'o1'), 'order on the default plan');

-- Plans are checked.
select pg_temp.expect_error($$select public.set_pay_plan(null, '[{"label":"A","pct":50,"when":"po"}]')$$, '%add up to 50%%');
select pg_temp.expect_error($$select public.set_pay_plan(null, '[{"label":"A","pct":100,"when":"soon"}]')$$, 'Pick when%');
select pg_temp.expect_error($$select public.set_pay_plan(null, '[{"label":"","pct":100,"when":"po"}]')$$, 'Name each%');
select pg_temp.expect_error($$select public.set_pay_plan(null, '[{"label":"A","pct":100,"when":"po","days":200}]')$$, 'Up to 180%');
select pg_temp.expect_error($$select public.set_pay_plan(null, '[]')$$, 'Add at least%');
select pg_temp.expect_error($$select public.set_pay_plan(null, null)$$, 'Add at least%');

-- The owner's new default: 30 with the PO, 40 on the pass, 30 a fortnight after delivery. The website deposit follows.
select public.set_pay_plan(null, '[{"label":"Deposit","pct":30,"when":"po","x":"y"},{"label":"On QC pass","pct":40,"when":"passed","days":0},{"label":"After delivery","pct":30,"when":"delivered","days":14}]');
select pg_temp.expect(jsonb_array_length(public.guarantee_terms() -> 'plan') = 3 and not (public.guarantee_terms() -> 'plan')::text like '%"x"%'
  and (public.guarantee_terms() ->> 'deposit_pct')::int = 30, 'three milestones, cleaned, deposit 30');

-- Accounts gives one order its own plan; the merchandiser can't; the owner alone sets the default.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.set_pay_plan(null, '[{"label":"A","pct":100,"when":"po"}]')$$, 'Only the owner%');
select public.set_pay_plan(:'o2', '[{"label":"Full","pct":100,"when":"shipped","days":30}]');
select public.guarantee_orders() as g \gset
select pg_temp.expect((select (e ->> 'own_plan')::boolean and e -> 'plan' -> 0 ->> 'when' = 'shipped'
  from jsonb_array_elements((:'g'::jsonb) -> 'orders') e where e ->> 'order_id' = :'o2'), 'ZL-9 on its own plan');
select pg_temp.expect((select jsonb_array_length(e -> 'plan') = 3 from jsonb_array_elements((:'g'::jsonb) -> 'orders') e where e ->> 'order_id' = :'o1'),
  'SO/172 follows the new default');
select public.set_pay_plan(:'o2', null);
select pg_temp.expect((select not (e ->> 'own_plan')::boolean from jsonb_array_elements(public.guarantee_orders() -> 'orders') e where e ->> 'order_id' = :'o2'),
  'back on the default');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select public.set_pay_plan('$$ || :'o2' || $$', '[{"label":"A","pct":100,"when":"po"}]')$$, 'Only Accounts%');

-- The old terms form rewrites the default as deposit + balance only when the deposit changes.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_guarantee(false, 30, 20);
select pg_temp.expect(jsonb_array_length(public.guarantee_terms() -> 'plan') = 3, 'same deposit keeps the plan');
select public.set_guarantee(false, 0, 20);
select pg_temp.expect(public.guarantee_terms() -> 'plan' -> 0 ->> 'pct' = '100', 'no deposit: all on the pass');

-- Ship and delivery days: ZL-9 ships in one part with an LR, then its GRN comes in.
reset role;
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/1', :'zl', current_date - 6, 30000) returning id as inv \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at,
    invoice_id, invoiced_at, eway_at, lr_path, shipped_at, lr_date, lr_no)
  values (:'co', :'o2', '20000000-0000-0000-0000-000000000001', 'KK-1', current_date - 6, 18000, now(), :'inv', now(), now(), 'x/lr.pdf',
    now() - interval '5 days', current_date - 5, 'LR1')
  returning id as d1 \gset
set session_replication_role = replica;
update public.orders set status = 'shipped' where id = :'o2';
set session_replication_role = origin;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (e ->> 'shipped_on')::date = current_date - 5 and e ->> 'delivered_on' is null
  from jsonb_array_elements(public.guarantee_orders() -> 'orders') e where e ->> 'order_id' = :'o2'), 'shipped on the LR day, not delivered yet');
reset role;
update public.dispatches set grn_path = 'x/grn.pdf', grn_at = now() where id = :'d1';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (e ->> 'delivered_on')::date = public.india_today()
  from jsonb_array_elements(public.guarantee_orders() -> 'orders') e where e ->> 'order_id' = :'o2'), 'delivered on the GRN day');
\echo milestones: ok
