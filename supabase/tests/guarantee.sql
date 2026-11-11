-- The Sourcingo Guarantee (0095): payment plan facts, payments, buyer claims and who may see what.
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
select pg_temp.expect((public.guarantee_terms() ->> 'live')::boolean = false and (public.guarantee_terms() ->> 'deposit_pct')::int = 30
  and (public.guarantee_terms() ->> 'shown')::boolean, 'off by default, 30% deposit, shown to the team');
select public.guarantee_orders() as g \gset
select pg_temp.expect((select (e ->> 'value')::numeric = 130000 and e ->> 'passed_on' is null and (e ->> 'priced')::boolean
  from jsonb_array_elements((:'g'::jsonb) -> 'orders') e where e ->> 'order_id' = :'o1'), 'SO/172 worth 1.3 lakh, not passed while AV-129 waits');
select pg_temp.expect((select (f ->> 'cost')::numeric = 60000 and (f ->> 'passed_on')::date = current_date - 1
  from jsonb_array_elements((:'g'::jsonb) -> 'orders') e cross join lateral jsonb_array_elements(e -> 'factories') f
  where e ->> 'order_id' = :'o1' and f ->> 'name' = 'Kkora Fashions LLP'), 'Kkora passed yesterday on its own styles; owed 60,000');
select pg_temp.expect((:'g'::jsonb) -> 'buyers' ->> :'ah' = 'Areeba', 'the team reads buyer names');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error('select public.guarantee_orders()', 'Only Accounts and the owner%');
select pg_temp.expect_error($$select public.record_guarantee_payment('$$ || :'o1' || $$', 'deposit', null, 39000, current_date, null)$$, 'Only Accounts%');
select pg_temp.expect_error('select public.set_guarantee(true, 30, 15)', 'Only the owner%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.record_guarantee_payment(:'o1', 'deposit', null, 39000, current_date - 5, 'NEFT') as p1 \gset
select public.record_guarantee_payment(:'o1', 'factory', '20000000-0000-0000-0000-000000000001', 60000, current_date, null) as p2 \gset
select pg_temp.expect_error($$select public.record_guarantee_payment('$$ || :'o2' || $$', 'factory', '20000000-0000-0000-0000-000000000002', 10, current_date, null)$$, '%doesn''t make anything%');
select pg_temp.expect_error($$select public.record_guarantee_payment('$$ || :'o1' || $$', 'balance', null, 10, current_date + 1, null)$$, '%future%');
select pg_temp.expect_error($$select public.record_guarantee_payment('$$ || :'o1' || $$', 'balance', null, 10.005, current_date, null)$$, '%rupees%');
select public.record_guarantee_payment(:'o1', 'balance', null, 5, current_date, 'typo') as p3 \gset
select public.cancel_guarantee_payment(:'p3');
select public.guarantee_orders() as g \gset
select pg_temp.expect((select (e ->> 'paid_deposit')::numeric = 39000 and (e ->> 'paid_balance')::numeric = 0
  from jsonb_array_elements((:'g'::jsonb) -> 'orders') e where e ->> 'order_id' = :'o1'), 'deposit counted, cancelled balance not');

-- The buyer sees nothing while it is off; the team's preview of the buyer does, without factory names or costs.
reset role;
select set_config('request.jwt.claim.sub', :'areeba', false);
set role authenticated;
select pg_temp.expect((public.buyer_guarantee() ->> 'shown')::boolean = false, 'a real buyer sees nothing while off');
select pg_temp.expect_error($$select public.raise_buyer_claim('$$ || :'k_line' || $$', 'defect', 10, 'remake', 'Holes', '{}')$$, 'Claims open here soon%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah'));
select public.buyer_guarantee() as bg \gset
select pg_temp.expect((:'bg'::jsonb ->> 'shown')::boolean and jsonb_array_length(:'bg'::jsonb -> 'orders') = 1
  and not (:'bg'::jsonb::text ~ 'Kkora|factories|cost|buyer_id'), 'preview shows only its own PO, never a factory or cost');
select pg_temp.headers('{}');
reset role;
select set_config('request.jwt.claim.sub', :'kkora', false);
set role authenticated;
select pg_temp.expect((public.factory_guarantee() ->> 'shown')::boolean = false, 'a real factory sees nothing while off');

-- The owner turns it on: the buyer and the factory read their own plans.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error('select public.set_guarantee(true, 95, 15)', '%0%% to 90%%%');
-- ZL-9 was entered before the switch-on: it stays on its old terms, out of the plan.
reset role;
update public.orders set created_at = now() - interval '30 days' where id = :'o2';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(jsonb_array_length(public.guarantee_orders() -> 'orders') = 2, 'the preview draws over every open order');
select public.set_guarantee(true, 25, 15);
select pg_temp.expect(jsonb_array_length(public.guarantee_orders() -> 'orders') = 1 and public.guarantee_terms() ->> 'from' = public.india_today()::text,
  'once on, only orders entered from today');
select public.set_guarantee(false, 25, 15);
select public.set_guarantee(true, 25, 15);
select pg_temp.expect(public.guarantee_terms() ->> 'from' = public.india_today()::text, 'turning it off and on keeps the first day');
reset role;
select set_config('request.jwt.claim.sub', :'kkora', false);
set role authenticated;
select public.factory_guarantee() as fg \gset
select pg_temp.expect(jsonb_array_length(:'fg'::jsonb -> 'orders') = 1
  and (select (e ->> 'cost')::numeric = 60000 and (e ->> 'paid')::numeric = 60000 from jsonb_array_elements(:'fg'::jsonb -> 'orders') e where e ->> 'order_id' = :'o1')
  and not (:'fg'::jsonb::text ~ 'Areeba|Shreeji|buyer_rate|value'), 'Kkora reads its own pay, never the buyer or Shreeji');
reset role;
select set_config('request.jwt.claim.sub', :'shreeji', false);
set role authenticated;
select pg_temp.expect((select (e ->> 'cost')::numeric = 18000 and e ->> 'passed_on' is null
  from jsonb_array_elements(public.factory_guarantee() -> 'orders') e), 'Shreeji waits for its pass');

-- The buyer raises a claim on its own style, with photos under the claim folder; not on another buyer's order.
reset role;
select set_config('request.jwt.claim.sub', :'areeba', false);
set role authenticated;
select pg_temp.expect(public.can_upload_photo(:'co' || '/' || :'o1' || '/claims/' || :'k_line' || '/a.jpg'), 'buyer uploads claim photos on its order');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/' || :'o2' || '/claims/' || :'z_line' || '/a.jpg'), 'not on another buyer''s order');
select pg_temp.expect_error($$select public.raise_buyer_claim('$$ || :'z_line' || $$', 'defect', 10, 'remake', 'Holes', '{}')$$, '%isn''t yours%');
select pg_temp.expect_error($$select public.raise_buyer_claim('$$ || :'k_line' || $$', 'defect', 501, 'remake', 'Holes', '{}')$$, 'Pieces affected%');
select pg_temp.expect_error($$select public.raise_buyer_claim('$$ || :'k_line' || $$', 'defect', 10, 'remake', '  ', '{}')$$, 'Say what is wrong%');
select pg_temp.expect_error($$select public.raise_buyer_claim('$$ || :'k_line' || $$', 'defect', 10, 'remake', 'Holes', '{x/y.jpg}')$$, 'Upload the photos again%');
select public.raise_buyer_claim(:'k_line', 'defect', 40, 'remake', 'Holes at the side seam', array[:'co' || '/' || :'o1' || '/claims/' || :'k_line' || '/a.jpg']) as c1 \gset
select pg_temp.expect(:'c1' = 'BC-0001', 'first claim number');
select pg_temp.expect(public.buyer_can_read_photo(:'co' || '/' || :'o1' || '/claims/' || :'k_line' || '/a.jpg'), 'buyer reads its claim photo');
select pg_temp.expect((select c ->> 'decide_by' = (public.india_today() + 7)::text and c ->> 'decision' is null
  from jsonb_array_elements(public.buyer_guarantee() -> 'claims') c), 'decided within 7 days');

-- The merchandiser raises one for Zolo (it rang), and decides both.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.raise_buyer_claim(:'z_line', 'short', 12, 'refund', 'Carton 4 short by 12', '{}') as c2 \gset
select id as c1_id from public.buyer_claims where claim_no = 'BC-0001' \gset
select id as c2_id from public.buyer_claims where claim_no = 'BC-0002' \gset
select pg_temp.expect((select not by_buyer from public.buyer_claims where id = :'c2_id'), 'raised by the team');
select pg_temp.expect_error($$select public.decide_buyer_claim('$$ || :'c2_id' || $$', 'declined', null, '', false)$$, 'Say why%');
select pg_temp.expect_error($$select public.decide_buyer_claim('$$ || :'c2_id' || $$', 'refund', 2000, null, false)$$, 'The refund is more than%');
select public.decide_buyer_claim(:'c2_id', 'refund', 1800, 'Sorry, refunded on your next invoice', true) as fc2 \gset
select public.decide_buyer_claim(:'c1_id', 'remake', null, null, true) as fc1 \gset
select pg_temp.expect(:'fc2' = 'CL-0001' and :'fc1' = 'CL-0002', 'both passed to Kkora as factory claims');
select pg_temp.expect_error($$select public.decide_buyer_claim('$$ || :'c1_id' || $$', 'declined', null, 'x', false)$$, '%already decided%');
reset role;
select pg_temp.expect((select amount = 1080 and reason = 'short' and ledger = 'Kkora Fashions LLP' and note like 'Buyer claim BC-0002, ZL-1:%'
  from public.factory_claims where claim_no = 'CL-0001'), 'factory pays its rate for the short pieces');
select pg_temp.expect((select amount = 4800 and reason = 'quality' from public.factory_claims where claim_no = 'CL-0002'), 'remake costs Kkora 40 x 120');
-- A style whose factory isn't linked to Tally can't pass on, but can be decided without.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.raise_buyer_claim(:'s_line', 'wrong', 5, 'remake', 'Wrong shade', '{}') as c3 \gset
select id as c3_id from public.buyer_claims where claim_no = 'BC-0003' \gset
select pg_temp.expect_error($$select public.decide_buyer_claim('$$ || :'c3_id' || $$', 'remake', null, null, true)$$, '%isn''t linked to its Tally ledger%');
select pg_temp.expect(public.decide_buyer_claim(:'c3_id', 'remake', null, null, false) is null, 'decided without a factory claim');
select pg_temp.expect(jsonb_array_length(public.guarantee_claims()) = 3, 'the team reads every claim');
-- Quality reads claims but can't decide; a factory can't read them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select (c -> 'buyer_rate') = 'null'::jsonb from jsonb_array_elements(public.guarantee_claims()) c limit 1), 'quality sees no rates');
reset role;
select set_config('request.jwt.claim.sub', :'kkora', false);
set role authenticated;
select pg_temp.expect_error('select public.guarantee_claims()', 'Only the team%');
select pg_temp.expect((select count(*) from public.buyer_claims) = 0, 'a factory reads no buyer claims');

-- The buyer reads the decisions.
reset role;
select set_config('request.jwt.claim.sub', :'areeba', false);
set role authenticated;
select pg_temp.expect((select count(*) = 2 and bool_and(c ->> 'decision' = 'remake') from jsonb_array_elements(public.buyer_guarantee() -> 'claims') c),
  'Areeba sees its two claims agreed for remake, not Zolo''s');
\echo guarantee: ok
