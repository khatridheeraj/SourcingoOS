-- Factory certificates, capacity and lead time (0108).
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
  ('00000000-0000-0000-0000-00000000000b', 'accounts@sourcingo.in'), ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'accounts' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name, city, tally_ledger) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP', 'Jaipur', 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name, city) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts', 'Sanganer' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-ZL","real_name":"Zolo Label"}') as zl \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":300,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
select public.save_order(jsonb_build_object('buyer_id', :'zl', 'buyer_po', 'ZL-9', 'ship_date', (current_date + 20)::text),
  '[{"style":"ZL-1","qty":200,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o2 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.buyer_link(:'ah') as ah_secret \gset
reset role;
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as areeba from public.members where buyer_id = :'ah' \gset
select id as k_line from public.order_lines where order_id = :'o1' and style = 'AV-142' \gset
select id as s_line from public.order_lines where order_id = :'o1' and style = 'AV-129' \gset
select id as z_line from public.order_lines where order_id = :'o2' \gset
select company_id as co from public.orders where id = :'o1' \gset
select set_config('request.jwt.claim.sub', '', false);

-- Kkora on SO/172: cutting on time, stitching 3 days late, finishing still open 2 days past target; one step has no target.
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on, not_needed) values
  (:'co', :'o1', :'k_line', 'cutting', current_date - 10, current_date - 11, false),
  (:'co', :'o1', :'k_line', 'stitching', current_date - 6, current_date - 3, false),
  (:'co', :'o1', :'k_line', 'finishing', current_date - 2, null, false),
  (:'co', :'o1', :'k_line', 'printing', null, current_date - 5, false),
  (:'co', :'o2', :'z_line', 'cutting', current_date - 4, current_date - 4, false),
  (:'co', :'o1', :'s_line', 'cutting', current_date - 4, current_date - 1, false);
-- Kkora shipped ZL-9 (PO 30 days ago) 20 days after its PO; SO/172 finished ex-factory 25 days after its PO.
update public.orders set po_date = current_date - 30 where id = :'o2';
update public.orders set po_date = current_date - 35 where id = :'o1';
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount) values (:'co', 'SPL/1', :'zl', current_date, 100000) returning id as i1 \gset
insert into public.dispatches (id, company_id, order_id, factory_id, purchase_bill_no, purchase_bill_date, purchase_taxable, invoice_due_at, invoice_id, invoiced_at, eway_at, lr_no, lr_path, shipped_at)
values ('40000000-0000-0000-0000-000000000001', :'co', :'o2', '20000000-0000-0000-0000-000000000001', 'PB-1', current_date, 1000, now(), :'i1', now(), now(), 'LR1', 'x/lr1.pdf', now() - interval '10 days');
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on, not_needed) values
  (:'co', :'o1', :'k_line', 'ex_factory', current_date - 12, current_date - 10, false);

set role authenticated;
-- ================================================================ certificates
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', 'GOTS', null, null, null, null)$$, 'Only the factory itself%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', 'G', null, null, null, null)$$, 'Give the certificate''s name%');
select pg_temp.expect_error($$select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', 'GOTS', null, current_date - 400, null, null)$$, 'That certificate ran out over a year ago%');
select pg_temp.expect_error($$select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', 'GOTS', null, null, 'elsewhere/x.pdf', null)$$, 'Upload the certificate again%');
-- Quality adds GOTS (checked at once) and a lapsed BSCI.
select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', ' GOTS ', 'CU 1234', current_date + 200, null, null) as c_gots \gset
select public.save_factory_certificate('20000000-0000-0000-0000-000000000001', 'BSCI', null, current_date - 5, null, null) as c_bsci \gset
select pg_temp.expect((select status from public.factory_certificates where id = :'c_gots') = 'checked', 'team certificate should be checked at once');

-- The factory adds its own OEKO-TEX: it needs a scan, waits for a check, and doesn't count until then.
select pg_temp.as_user(:'kkora');
select pg_temp.expect_error($$select public.save_factory_certificate(null, 'OEKO-TEX', null, current_date + 90, null, null)$$, 'Add a photo or PDF%');
select pg_temp.expect_error($$select public.save_factory_certificate('20000000-0000-0000-0000-000000000002', 'OEKO-TEX', null, null, null, null)$$, 'Only the factory itself%');
select public.save_factory_certificate(null, 'OEKO-TEX', 'OT-9', current_date + 90, :'co' || '/factory-files/20000000-0000-0000-0000-000000000001/certs/a.pdf', 'oeko.pdf') as c_oeko \gset
select pg_temp.expect((select count(*) from jsonb_array_elements(public.factory_certificates_mine())) = 3, 'factory should see its three certificates');
select pg_temp.expect((public.factory_record_mine() -> 'certificates') @> '[{"name":"GOTS"}]' and not (public.factory_record_mine() -> 'certificates') @> '[{"name":"OEKO-TEX"}]',
  'an unchecked certificate counts on the record');
select pg_temp.expect_error(format('select public.remove_factory_certificate(%L)', :'c_gots'), 'That certificate can''t be removed here%');
select pg_temp.expect_error(format('select public.check_factory_certificate(%L, true, null)', :'c_oeko'), 'Only the owner, a manager%');
-- Storage: the factory uploads and opens only its own papers.
select pg_temp.expect(public.can_upload_photo(:'co' || '/factory-files/20000000-0000-0000-0000-000000000001/certs/b.pdf'), 'factory cannot upload its certificate');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/factory-files/20000000-0000-0000-0000-000000000002/certs/b.pdf'), 'factory uploads into another factory');
select pg_temp.expect(public.factory_can_read_photo(:'co' || '/factory-files/20000000-0000-0000-0000-000000000001/certs/a.pdf'), 'factory cannot open its certificate');
select pg_temp.expect(not public.factory_can_read_photo(:'co' || '/factory-files/20000000-0000-0000-0000-000000000002/certs/a.pdf'), 'factory opens another factory''s papers');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.check_factory_certificate(%L, false, %L)', :'c_oeko', ''), 'Say why%');
select public.check_factory_certificate(:'c_oeko', true, null);
select public.factory_records('20000000-0000-0000-0000-000000000001') -> 0 as k \gset
select pg_temp.expect(jsonb_array_length(:'k'::jsonb -> 'certificates') = 3, 'checked certificates missing from the record: ' || :'k');

-- The buyer reads only certificates still in date, never a number.
select pg_temp.as_user(:'areeba');
select public.buyer_factory_records() as b \gset
select pg_temp.expect(:'b'::text like '%GOTS%' and :'b'::text like '%OEKO-TEX%' and :'b'::text not like '%BSCI%', 'buyer certificates wrong: ' || :'b');
select pg_temp.expect(:'b'::text not like '%CU 1234%' and :'b'::text not like '%oeko.pdf%', 'buyer sees a certificate number or file');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/factory-files/20000000-0000-0000-0000-000000000001/certs/c.pdf'), 'buyer uploads factory papers');

-- ================================================================ capacity
select pg_temp.as_user(:'kkora');
select date_trunc('week', public.india_today())::date as mon \gset
select pg_temp.expect_error($$select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', (date_trunc('week', public.india_today())::date + 1)::text, 'free', 100)))$$, 'Weeks run from this Monday%');
select pg_temp.expect_error($$select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', (date_trunc('week', public.india_today())::date - 7)::text, 'free', 100)))$$, 'Weeks run from this Monday%');
select pg_temp.expect_error($$select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', date_trunc('week', public.india_today())::date::text, 'free', 'lots')))$$, 'Give the free pieces as a number%');
select pg_temp.expect_error($$select public.set_factory_capacity('20000000-0000-0000-0000-000000000002', '[]')$$, 'Only the factory itself%');
select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', :'mon', 'free', 2000, 'note', 'Diwali over'),
                                                           jsonb_build_object('week', (:'mon'::date + 7)::text, 'free', 0)));
select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', :'mon', 'free', 1500)));
select public.factory_capacity_mine(8) as cap \gset
select pg_temp.expect(jsonb_array_length(:'cap'::jsonb -> 'weeks') = 8 and (:'cap'::jsonb -> 'weeks' -> 0 ->> 'free')::int = 1500
  and (:'cap'::jsonb -> 'weeks' -> 1 ->> 'free')::int = 0 and :'cap'::jsonb -> 'weeks' -> 2 -> 'free' = 'null'::jsonb, 'capacity weeks wrong: ' || :'cap');
-- Clearing a week means "not said", not zero.
select public.set_factory_capacity(null, jsonb_build_array(jsonb_build_object('week', (:'mon'::date + 7)::text, 'free', null)));
select pg_temp.expect(public.factory_capacity_mine(8) -> 'weeks' -> 1 -> 'free' = 'null'::jsonb, 'cleared week still says a number');
select pg_temp.expect(public.factory_capacity() = '[]'::jsonb, 'a factory reads every factory''s capacity');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.factory_capacity('20000000-0000-0000-0000-000000000001', 12) -> 0 as kc \gset
select pg_temp.expect(jsonb_array_length(:'kc'::jsonb -> 'weeks') = 12, 'team capacity weeks wrong');
-- What is due to ship with us: ZL-9 (200 pcs, ship in 20 days) lands in its ship week.
select pg_temp.expect((select sum((w ->> 'due_pcs')::int) from jsonb_array_elements(:'kc'::jsonb -> 'weeks') w) = 700, 'pieces due to ship wrong: ' || :'kc');
select public.set_factory_capacity('20000000-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('week', :'mon', 'free', 800)));
select pg_temp.expect(jsonb_array_length(public.factory_capacity()) = 2, 'team should see both factories');
select pg_temp.as_user(:'areeba');
select pg_temp.expect(public.factory_capacity() = '[]'::jsonb and public.factory_capacity_mine() is null, 'a buyer reads capacity');
select pg_temp.expect_error($$select public.set_factory_capacity('20000000-0000-0000-0000-000000000001', '[]')$$, 'Only the factory itself%');

-- ================================================================ lead time
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.lead_times() as lt \gset
select pg_temp.expect((select count(*) from jsonb_array_elements(:'lt'::jsonb) x where x ->> 'factory_id' = '20000000-0000-0000-0000-000000000001'
  and (x ->> 'orders')::int = 2 and (x ->> 'mid')::numeric = 22.5 or (x ->> 'factory_id' = '20000000-0000-0000-0000-000000000001' and (x ->> 'mid')::int in (22, 23))) = 1,
  'Kkora lead time wrong (20 and 25 days): ' || :'lt');
select pg_temp.expect((select count(*) from jsonb_array_elements(:'lt'::jsonb) x where x -> 'factory_id' = 'null'::jsonb and x ->> 'product' = 'garment') = 1,
  'company-wide garment lead time missing: ' || :'lt');
select pg_temp.expect((public.factory_records('20000000-0000-0000-0000-000000000001') -> 0 ->> 'lead_orders')::int = 2, 'lead orders missing from the record');
select pg_temp.as_user(:'kkora');
select pg_temp.expect(public.lead_times() = '[]'::jsonb, 'a factory reads every lead time');

reset role;
select pg_temp.expect(not has_function_privilege('authenticated', 'public.capacity_weeks(uuid, uuid[], integer)', 'execute'), 'capacity_weeks callable from the app');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.lead_days(uuid)', 'execute'), 'lead_days callable from the app');
select pg_temp.expect(not has_function_privilege('anon', 'public.save_factory_certificate(uuid, text, text, date, text, text)', 'execute'), 'signed-out visitors add certificates');
\echo factory_certs_capacity: ok
