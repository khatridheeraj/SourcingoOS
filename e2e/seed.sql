-- Made-up test data for the local app check (e2e/). Nothing here is real: every name ends in "Test"
-- or is plainly invented. Dates are relative to today, so the data never goes stale.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local', '{"full_name":"Owner Test"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local', '{"full_name":"Manager Test"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'merch@test.local', '{"full_name":"Merch Test"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'qc@test.local', '{"full_name":"Quality Test"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'accounts@test.local', '{"full_name":"Accounts Test"}'),
  ('00000000-0000-0000-0000-0000000000a6', 'factory@test.local', '{"full_name":"Factory Test"}'),
  ('00000000-0000-0000-0000-0000000000a7', 'buyer@test.local', '{"full_name":"Buyer Test"}');
update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id;

insert into public.factories (id, company_id, name, city, contact_name, phone) select v.id::uuid, c.id, v.name, v.city, v.contact, v.phone from public.companies c,
  (values ('20000000-0000-0000-0000-000000000001', 'Kkora Test Fashions', 'Jaipur', 'Ramesh', '+919800000001'),
          ('20000000-0000-0000-0000-000000000002', 'Shree Test Exports', 'Jaipur', 'Sunil', '+919800000002'),
          ('20000000-0000-0000-0000-000000000003', 'Flavia Test Creation', 'Delhi', 'Anil', '+919800000003')) v (id, name, city, contact, phone);

insert into public.members (company_id, user_id, role, factory_id) select c.id, u.id::uuid, u.role, u.factory::uuid from public.companies c,
  (values ('00000000-0000-0000-0000-0000000000a1', 'owner', null), ('00000000-0000-0000-0000-0000000000a2', 'manager', null),
          ('00000000-0000-0000-0000-0000000000a3', 'merchandiser', null), ('00000000-0000-0000-0000-0000000000a4', 'quality', null),
          ('00000000-0000-0000-0000-0000000000a5', 'accounts', null),
          ('00000000-0000-0000-0000-0000000000a6', 'factory', '20000000-0000-0000-0000-000000000001')) u (id, role, factory);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Test House","credit_days":45}') as ah \gset
select public.save_buyer('{"code":"BYR-MR","real_name":"Mira Test Retail","credit_days":30}') as mr \gset
select public.save_buyer('{"code":"BYR-NV","real_name":"Nova Test Brands","credit_days":60}') as nv \gset

-- Orders at every point of their life, so each screen has something to show.
-- 1. Just in: no factory, no plan.
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2201', 'ship_date', (current_date + 55)::text),
  '[{"style":"AH-DRESS-01","qty":600,"buyer_rate":540},{"style":"AH-KURTA-02","qty":400,"buyer_rate":420}]') as o_new \gset
-- 2. Factory chosen, plan not set.
select public.save_order(jsonb_build_object('buyer_id', :'mr', 'buyer_po', 'MR-778', 'ship_date', (current_date + 40)::text),
  '[{"style":"MR-TOP-11","qty":1200,"buyer_rate":310,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":205},{"style":"MR-SKIRT-12","qty":800,"buyer_rate":380,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":250}]') as o_fac \gset
-- 3. In production, on plan.
select public.save_order(jsonb_build_object('buyer_id', :'nv', 'buyer_po', 'NV-5521', 'ship_date', (current_date + 25)::text),
  '[{"style":"NV-SHIRT-A","qty":900,"buyer_rate":450,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":300},{"style":"NV-SHIRT-B","qty":900,"buyer_rate":450,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":300},{"style":"NV-PANT-C","qty":500,"buyer_rate":520,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":360}]') as o_prod \gset
-- 4. Behind: steps past their targets.
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2150', 'ship_date', (current_date + 9)::text),
  '[{"style":"AH-TUNIC-07","qty":700,"buyer_rate":390,"factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":260}]') as o_late \gset
-- 5. Packed, waiting for final QC.
select public.save_order(jsonb_build_object('buyer_id', :'mr', 'buyer_po', 'MR-760', 'ship_date', (current_date + 3)::text),
  '[{"style":"MR-DRESS-09","qty":500,"buyer_rate":610,"factory_id":"20000000-0000-0000-0000-000000000003","factory_rate":420}]') as o_qc \gset
-- 6. Past its ship date.
select public.save_order(jsonb_build_object('buyer_id', :'nv', 'buyer_po', 'NV-5400', 'ship_date', (current_date - 4)::text),
  '[{"style":"NV-JACKET-Z","qty":300,"buyer_rate":980,"factory_id":"20000000-0000-0000-0000-000000000003","factory_rate":700}]') as o_over \gset

-- Plans: every step gets a target spread back from the ship date; earlier steps are done.
reset role;
create function pg_temp.plan(p_order uuid, p_done int, p_slip int) returns void language plpgsql as $$
declare s text; i int := 0; ship date; n int := 15;
begin
  select ship_date into ship from public.orders where id = p_order;
  foreach s in array array['greige','fit_sample','fabric','printing','strike_off','pp_sample','size_set','cutting','stitching','inline','midline','finishing','packed','final_qc','ex_factory'] loop
    insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on)
    select l.company_id, l.order_id, l.id, s, ship - (n - i) * 4 - p_slip,
      case when i < p_done then ship - (n - i) * 4 - p_slip + 1 end
    from public.order_lines l where l.order_id = p_order;
    i := i + 1;
  end loop;
end $$;
insert into public.factory_pos (company_id, order_id, factory_id, released_at, po_no)
select o.company_id, o.id, l.factory_id, now() - interval '20 days', 'FPO-' || o.order_no
from public.orders o join (select distinct order_id, factory_id from public.order_lines where factory_id is not null) l on l.order_id = o.id
where o.id in (:'o_prod', :'o_late', :'o_qc', :'o_over');
select pg_temp.plan(:'o_prod', 8, 0);
select pg_temp.plan(:'o_late', 6, 20);
select pg_temp.plan(:'o_qc', 13, 0);
select pg_temp.plan(:'o_over', 12, 6);
update public.factory_pos set plan_requested_on = current_date - 1 where order_id = :'o_fac';

-- Leads.
insert into public.inquiries (company_id, inquiry_no, buyer_id, product, est_qty, status, next_follow_up)
select c.id, 'INQ-T1', :'ah', 'Summer linen co-ords, 3 styles', 1500, 'new', current_date - 1 from public.companies c;
insert into public.inquiries (company_id, inquiry_no, buyer_id, product, est_qty, quoted_price, status, next_follow_up)
select c.id, 'INQ-T2', :'nv', 'Denim jackets, 2 washes', 800, 720, 'quoted', current_date + 3 from public.companies c;

-- A buyer login for Areeba.
insert into public.members (company_id, user_id, role, buyer_id) select c.id, '00000000-0000-0000-0000-0000000000a7', 'buyer', :'ah' from public.companies c;

-- 7. Plan done and sent to the owner for approval.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_order(jsonb_build_object('buyer_id', :'nv', 'buyer_po', 'NV-5600', 'ship_date', (current_date + 50)::text),
  '[{"style":"NV-DRESS-Q","qty":650,"buyer_rate":560,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":380}]') as o_appr \gset
reset role;
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, factory_on)
select l.company_id, l.order_id, l.id, s.stage, current_date + s.n::int * 2, current_date + s.n::int * 2
from public.order_lines l, unnest(array['greige','fit_sample','fabric','printing','strike_off','pp_sample','size_set','cutting','stitching','inline','midline','finishing','packed','final_qc','ex_factory']) with ordinality s (stage, n)
where l.order_id = :'o_appr';
insert into public.factory_pos (company_id, order_id, factory_id, lock_requested_at, lock_requested_by, buffer_days)
select company_id, :'o_appr', '20000000-0000-0000-0000-000000000002', now() - interval '3 hours', '00000000-0000-0000-0000-0000000000a3', 7
from public.orders where id = :'o_appr';

-- 8. Final QC passed: ready to ship.
update public.line_stages set done_on = planned_on where order_id = :'o_over' and stage in ('packed', 'final_qc');
insert into public.qc_checks (company_id, order_id, line_id, kind, checked_on, result, pieces_checked, checked_by)
select l.company_id, l.order_id, l.id, 'final', current_date - 1, 'pass', 80, '00000000-0000-0000-0000-0000000000a4'
from public.order_lines l where l.order_id = :'o_over';

-- 9. Buyer POs: one read and waiting past the 2-day flag with a point to check, one just in, one set aside.
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, received_at, status, buyer_id, buyer_po, read)
select c.id, 'email', 'e2e-po-1', 'orders@areeba.test', 'PO AH-2240 summer dresses', now() - interval '3 days', 'to_check', :'ah', 'AH-2240',
  '{"buyer_name":"Areeba Test House","buyer_code":"BYR-AH","po_number":"AH-2240","po_date":null,"ship_date":null,"notes":null,
    "lines":[{"style":"AH-DRESS-07","description":"Tiered dress","colour":"Indigo","sizes":"S-XL","qty":480,"rate":555},
             {"style":"AH-TOP-08","description":"Smocked top","colour":"White","sizes":"S-XL","qty":320,"rate":310}],
    "doubts":["Ship date not printed on the PO"]}'::jsonb
from public.companies c;
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, received_at, status, buyer_id, buyer_po, read)
select c.id, 'email', 'e2e-po-2', 'buying@mira.test', 'New order MR-118', now() - interval '2 hours', 'to_check', :'mr', 'MR-118',
  '{"buyer_name":"Mira Test Retail","buyer_code":"BYR-MR","po_number":"MR-118","po_date":null,"ship_date":null,"notes":null,
    "lines":[{"style":"MR-SHIRT-11","description":"Linen shirt","colour":"Sand","sizes":"M-XXL","qty":900,"rate":395}],"doubts":[]}'::jsonb
from public.companies c;
-- A PO whose number is already on an order but for another style (Flavia PO 101, 24 Oct 2026): not the same PO.
insert into public.incoming_pos (company_id, source, received_at, status, buyer_id, buyer_po, matched_order_id, files, read)
select o.company_id, 'upload', now() - interval '1 hour', 'to_check', o.buyer_id, 'NV-5600', o.id, '[]'::jsonb,
  '{"buyer_code":"BYR-NV","po_number":"NV-5600","po_date":null,"ship_date":null,"notes":null,
    "lines":[{"style":"NV-COAT-R","description":"Wool coat","colour":null,"sizes":null,"qty":500,"rate":485}],"doubts":[]}'::jsonb
from public.orders o where o.buyer_po = 'NV-5600';
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, received_at, status)
select c.id, 'email', 'e2e-po-3', 'news@mira.test', 'Our autumn lookbook', now() - interval '1 day', 'not_po' from public.companies c;

-- 10. Goods with us: the late order shipped in part. Its first lot went 10 days ago and its GRN is late; its second
-- was bought 30 hours ago and is not invoiced yet (held over 24 hours).
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id)
select company_id, 'INV-T-101', buyer_id, current_date - 11, 154350, current_date + 49, id from public.orders where id = :'o_over'
returning id as inv \gset
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, purchase_gst,
  purchased_at, invoice_due_at, invoice_id, invoice_no, invoiced_at, eway_bill_no, eway_at, transporter, lr_no, lr_path, cartons, shipped_at, grn_due_on)
select company_id, id, '20000000-0000-0000-0000-000000000003', 'PB-T-101', current_date - 12, 105000, 5250,
  now() - interval '12 days', now() - interval '11 days', :'inv', 'INV-T-101', now() - interval '11 days', 'EWB-T-101', now() - interval '11 days',
  'Test Roadways', '55021', 'e2e/lr-55021.pdf', 12, now() - interval '10 days', current_date - 2
from public.orders where id = :'o_over';
insert into public.dispatches (company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, purchase_gst, purchased_at, invoice_due_at)
select company_id, id, '20000000-0000-0000-0000-000000000003', 'PB-T-102', current_date - 1, 105000, 5250, now() - interval '30 hours', now() - interval '6 hours'
from public.orders where id = :'o_over';
insert into public.dispatch_lines (dispatch_id, line_id, company_id, qty, purchase_rate, sale_rate)
select d.id, l.id, l.company_id, 150, 700, 980 from public.dispatches d join public.order_lines l on l.order_id = d.order_id where d.order_id = :'o_over';

-- 11. Payments: an older invoice to Mira is past due and its cheque, dated two days ago, is still in hand (to deposit);
-- Nova has given a post-dated cheque for part of the late order's invoice.
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, due_date)
select c.id, 'INV-T-090', :'mr', current_date - 40, 98000, current_date - 10 from public.companies c
returning id as inv90 \gset
insert into public.cheques (company_id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on)
select c.id, :'mr', '004512', 'HDFC Bank', current_date - 2, 98000, 'in_hand', current_date - 3 from public.companies c
returning id as chq1 \gset
insert into public.cheque_allocations (company_id, cheque_id, invoice_id, amount)
select c.id, :'chq1', :'inv90', 98000 from public.companies c;
insert into public.cheques (company_id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on)
select company_id, buyer_id, '118230', 'ICICI Bank', current_date + 20, 80000, 'in_hand', current_date - 1 from public.invoices where id = :'inv'
returning id as chq2 \gset
insert into public.cheque_allocations (company_id, cheque_id, invoice_id, amount)
select company_id, :'chq2', id, 80000 from public.invoices where id = :'inv';

-- 12. Bills to pay, as read from Tally: Flavia has an old bill part paid and now overdue, and a newer one not due yet
-- (together they match its ledger balance); Jaipur Test Trims, a micro enterprise and not a factory, is past 45 days.
update public.factories set tally_ledger = 'Flavia Test Creation' where id = '20000000-0000-0000-0000-000000000003';
insert into public.tally_ledgers (company_id, name, parent, balance)
select c.id, v.name, 'Sundry Creditors', v.balance from public.companies c,
  (values ('Flavia Test Creation', -210000), ('Jaipur Test Trims', -18500)) v (name, balance);
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, bills)
select c.id, v.guid, v.vtype, v.kind, v.number, current_date - v.ago, v.party, v.amount, v.bills::jsonb from public.companies c,
  (values ('e2e-pur-1', 'Purchase', 'purchase', 'PB-T-090', 75, 'Flavia Test Creation', 120000, '[{"name":"PB-T-090","amount":120000}]'),
          ('e2e-pur-2', 'Purchase', 'purchase', 'PB-T-101', 12, 'Flavia Test Creation', 110250, '[{"name":"PB-T-101","amount":110250}]'),
          ('e2e-pay-1', 'Payment', 'payment', '41', 5, 'Flavia Test Creation', 20250, '[{"name":"PB-T-090","amount":20250}]'),
          ('e2e-pur-3', 'Purchase', 'purchase', 'JTT-44', 50, 'Jaipur Test Trims', 18500, '[{"name":"JTT-44","amount":18500}]')) v (guid, vtype, kind, number, ago, party, amount, bills);
insert into public.supplier_terms (company_id, ledger, msme) select c.id, 'Jaipur Test Trims', 'micro' from public.companies c;

-- 13. A fabric order, like a mill order for cambric: both styles typed in as Fabric, so they skip the garment steps.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_order(jsonb_build_object('buyer_id', :'mr', 'buyer_po', 'MR-FAB-31', 'ship_date', (current_date + 24)::text),
  '[{"style":"Cotton Cambric Test","description":"Fabric","qty":1500,"buyer_rate":78,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":70},{"style":"Printed Cambric Test","description":"Fabric","qty":2500,"buyer_rate":74,"factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":66}]') as o_fab \gset
reset role;
