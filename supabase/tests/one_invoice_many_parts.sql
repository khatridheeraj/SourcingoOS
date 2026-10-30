-- One Tally invoice for several parts of an order. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.factories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Shree Shai'), ('20000000-0000-0000-0000-000000000002', 'Ritika');
select public.save_buyer('{"code":"BYR-KFT","real_name":"Kaftanize"}') as kft \gset
select public.save_order(jsonb_build_object('buyer_id', :'kft', 'buyer_po', 'KFT-88'),
  '[{"style":"Cambric","qty":"200","buyer_rate":"78","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"70"},
    {"style":"Printed","qty":"300","buyer_rate":"74","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"66"},
    {"style":"Plain","qty":"100","buyer_rate":"100","factory_id":"20000000-0000-0000-0000-000000000002","factory_rate":"90"}]'::jsonb) as ord \gset
select id as l1 from public.order_lines where style = 'Cambric' \gset
select id as l2 from public.order_lines where style = 'Printed' \gset
select id as l3 from public.order_lines where style = 'Plain' \gset
reset role;
update public.buyers set tally_ledger = 'KAFTANIZE RETAILS' where id = :'kft';
set role authenticated;
-- Part 1: 170 × 78 = 13,260 + 5% = 13,923. Part 2: 251 × 74 = 18,574 + 5% = 19,502.70. Together 33,425.70, in Tally 33,426.
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', '812',
  'bill_date', '2026-10-20', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'l1', 'qty', 170, 'purchase_rate', 70, 'sale_rate', 78)))) as d1 \gset
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000002', 'bill_no', '354',
  'bill_date', '2026-10-21', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'l2', 'qty', 251, 'purchase_rate', 66, 'sale_rate', 74)))) as d2 \gset
select public.record_purchase(jsonb_build_object('order_id', :'ord', 'factory_id', '20000000-0000-0000-0000-000000000002', 'bill_no', '360',
  'bill_date', '2026-10-22', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'l3', 'qty', 100, 'purchase_rate', 90, 'sale_rate', 100)))) as d3 \gset

-- 1. Tally brings one invoice for parts 1 and 2: both take it, part 3 keeps waiting, Payments has it once at Tally's total.
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount)
select id, 'g-202', 'TAX INVOICE', 'sales', 'SPL/26-27/202', '2026-10-23', 'KAFTANIZE RETAILS', 33426 from public.companies;
do $$ begin
  if (select count(*) from public.dispatches where invoice_no = 'SPL/26-27/202') <> 2 then raise exception 'shared invoice not taken by both parts'; end if;
  if (select count(*) from public.dispatches where invoice_id is null and cancelled_at is null) <> 1 then raise exception 'part 3 should still wait'; end if;
  if (select count(*) || '|' || sum(amount) from public.invoices where invoice_no = 'SPL/26-27/202') <> '1|33426.00' then
    raise exception 'shared invoice not in Payments once at the Tally total';
  end if;
  if (select string_agg((invoice_taxable + invoice_gst)::text, ',' order by purchase_bill_no desc) from public.dispatches where invoice_no = 'SPL/26-27/202')
     <> '13923.00,19502.70' then raise exception 'each part should keep its own value'; end if;
end $$;

-- 2. A single invoice still goes to its own part.
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount)
select id, 'g-205', 'TAX INVOICE', 'sales', 'SPL/26-27/205', '2026-10-24', 'KAFTANIZE RETAILS', 10500 from public.companies;
do $$ begin
  if (select invoice_no from public.dispatches where purchase_bill_no = '360') <> 'SPL/26-27/205' then raise exception 'single invoice not taken'; end if;
end $$;

-- 3. By hand, for a buyer not in Tally yet: one invoice entered on two parts of an order, and Payments adds them up.
set role authenticated;
select public.save_buyer('{"code":"BYR-FLV","real_name":"Flavia"}') as flv \gset
select public.save_order(jsonb_build_object('buyer_id', :'flv', 'buyer_po', 'FLV-1'),
  '[{"style":"Kurta","qty":"100","buyer_rate":"78","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"70"}]'::jsonb) as ordf \gset
select id as lf from public.order_lines where style = 'Kurta' \gset
select public.record_purchase(jsonb_build_object('order_id', :'ordf', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', '900',
  'bill_date', '2026-10-24', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'lf', 'qty', 10, 'purchase_rate', 70, 'sale_rate', 78)))) as d4 \gset
select public.record_purchase(jsonb_build_object('order_id', :'ordf', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', '901',
  'bill_date', '2026-10-24', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'lf', 'qty', 10, 'purchase_rate', 70, 'sale_rate', 78)))) as d5 \gset
select public.record_dispatch_invoice(:'d4', '{"invoice_no":"SPL/26-27/300","invoice_date":"2026-10-24","taxable":780}');
select public.record_dispatch_invoice(:'d5', '{"invoice_no":"SPL/26-27/300","invoice_date":"2026-10-24","taxable":780}');
do $$ begin
  if (select amount from public.invoices where invoice_no = 'SPL/26-27/300') <> 1638 then raise exception 'hand invoice for two parts not added up'; end if;
end $$;

-- 4. An invoice of another buyer or order can't be shared, and a Tally total bigger than the parts is refused when no part waits.
select public.save_order(jsonb_build_object('buyer_id', :'kft', 'buyer_po', 'KFT-89'),
  '[{"style":"Other","qty":"10","buyer_rate":"100","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"90"}]'::jsonb) as ord2 \gset
select id as l9 from public.order_lines where style = 'Other' \gset
select public.record_purchase(jsonb_build_object('order_id', :'ord2', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', '950',
  'bill_date', '2026-10-24', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'l9', 'qty', 10, 'purchase_rate', 90, 'sale_rate', 100)))) as d9 \gset
do $$ begin
  begin
    perform public.record_dispatch_invoice((select id from public.dispatches where purchase_bill_no = '950'),
      '{"invoice_no":"SPL/26-27/300","invoice_date":"2026-10-24","taxable":1000}');
    raise exception 'invoice shared across buyers';
  exception when others then
    if sqlerrm not like '%another buyer%' then raise; end if;
  end;
  begin
    perform public.record_dispatch_invoice((select id from public.dispatches where purchase_bill_no = '950'),
      '{"invoice_no":"SPL/26-27/202","invoice_date":"2026-10-24","taxable":1000}');
    raise exception 'invoice of another order taken';
  exception when others then
    if sqlerrm not like '%another order%' then raise; end if;
  end;
end $$;
reset role;
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount)
select id, 'g-210', 'TAX INVOICE', 'sales', 'SPL/26-27/210', '2026-10-24', 'KAFTANIZE RETAILS', 5000 from public.companies;
set role authenticated;
do $$ begin
  begin
    perform public.record_dispatch_invoice((select id from public.dispatches where purchase_bill_no = '950'),
      '{"invoice_no":"SPL/26-27/210","invoice_date":"2026-10-24","taxable":1000}');
    raise exception 'bigger Tally total accepted with no other part waiting';
  exception when others then
    if sqlerrm not like '%is ₹5000.00 in Tally, but%' then raise; end if;
  end;
end $$;

-- 5. Typing a shared invoice on one part while another part of the order waits says it fills in by itself.
select public.record_purchase(jsonb_build_object('order_id', :'ord2', 'factory_id', '20000000-0000-0000-0000-000000000001', 'bill_no', '951',
  'bill_date', '2026-10-24', 'lines', jsonb_build_array(jsonb_build_object('line_id', :'l9', 'qty', 10, 'purchase_rate', 90, 'sale_rate', 100)))) as d10 \gset
do $$ begin
  begin
    perform public.record_dispatch_invoice((select id from public.dispatches where purchase_bill_no = '950'),
      '{"invoice_no":"SPL/26-27/210","invoice_date":"2026-10-24","taxable":1000}');
    raise exception 'bigger Tally total accepted on one part by hand';
  exception when others then
    if sqlerrm not like '%more than this part%fills in by itself%' then raise; end if;
  end;
end $$;
