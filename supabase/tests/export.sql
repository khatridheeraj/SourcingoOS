-- Selling overseas (0098): delivered price on a costing, export details per lot, exporter details, and "Made here before".
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

grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to anon, authenticated;
set role authenticated;

-- Exporter details: owner only, checked.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.save_exporter('{"iec":"ABCDE1234F"}')$$, 'Only the owner%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.save_exporter('{"iec":"ABC"}')$$, 'The IEC has 10%');
select public.save_exporter('{"iec":"abcde 1234f","ad_code":"0510005","lut_no":"AD0803260001","lut_date":"2026-04-01","export_port":"Nhava Sheva"}');
select pg_temp.expect((select iec = 'ABCDE1234F' and ad_code = '0510005' and lut_date = '2026-04-01' from public.companies), 'exporter details saved, IEC tidied');

-- Export details per lot: orders team; quality can't.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_export('50000000-0000-0000-0000-000000000001', jsonb_build_object('currency', 'GBP', 'fx', '117', 'incoterm', 'FOB', 'lines', jsonb_build_object(:'line', jsonb_build_object('hs', '62114290', 'rate', '4.75'))));
select pg_temp.expect((select export ->> 'currency' = 'GBP' from public.dispatches where id = '50000000-0000-0000-0000-000000000001'), 'export details kept on the lot');
select pg_temp.expect_error($$select public.save_export('50000000-0000-0000-0000-000000000001', '{"currency":"pounds"}')$$, 'Pick the invoice currency.');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error($$select public.save_export('50000000-0000-0000-0000-000000000001', '{"currency":"USD"}')$$, 'Only the orders team%');

-- Freight rates: orders team, sane numbers.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_freight_rates('{"europe":{"sea":95,"air":360}}');
select pg_temp.expect_error($$select public.save_freight_rates('{"europe":{"sea":-5}}')$$, 'A freight rate%');
select pg_temp.expect((select (freight_rates -> 'europe' ->> 'sea')::numeric = 95 from public.companies), 'freight rates saved');

-- A costing sent with its delivered price; the buyer sees it on its page.
reset role;
insert into public.inquiries (id, buyer_id, product, est_qty, asked_on_page, sample_in_on)
values ('70000000-0000-0000-0000-000000000001', :'ah', 'Linen co-ord', 300, true, current_date);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.send_costing('70000000-0000-0000-0000-000000000001', '{"fabrics":[],"costs":[{"name":"CMT","amount":500}],"margin":15}', 500, 575, null, 'Ex-Jaipur',
  '{"country":"GB","currency":"GBP","total":6.1,"price":4.91,"freight":0.3,"insurance":0.03,"duty":0}') as cid \gset
select pg_temp.expect((select landed ->> 'currency' = 'GBP' and price = 575 from public.inquiry_costings where id = :'cid'), 'delivered price kept with the quote');
select pg_temp.expect((select status = 'quoted' from public.inquiries where id = '70000000-0000-0000-0000-000000000001'), 'the inquiry is quoted');
select pg_temp.expect_error($$select public.send_costing('70000000-0000-0000-0000-000000000001', '{}', 1, 2, null, null, '[1]')$$, 'The delivered price%');
-- The old six-box call still works (a quote with no delivered price).
select public.send_costing('70000000-0000-0000-0000-000000000001', '{"costs":[]}', 500, 590, null, null) as cid2 \gset
select pg_temp.expect((select landed is null from public.inquiry_costings where id = :'cid2'), 'a quote without a delivered price has none');

-- Made here before: nothing until goods have shipped; counts only; photos only when the owner shows them.
reset role;
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect((public.site_made_before(array['kurta'], false) ->> 'styles')::int = 0, 'nothing shipped yet');
reset role;
update public.order_lines set description = 'Cotton kurta' where id = :'line';
-- (Test only: skip the invoice, e-way bill and LR that shipping needs in real use.)
alter table public.dispatches drop constraint dispatches_check3;
update public.dispatches set shipped_at = now() where id = '50000000-0000-0000-0000-000000000001';
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect((j ->> 'styles')::int = 1 and (j ->> 'qty')::int = 100 and jsonb_array_length(j -> 'photos') = 0 and j::text not like '%Areeba%' and j::text not like '%Kkora%',
  'counts a shipped kurta, no names, no photo yet') from (select public.site_made_before(array['kurta'], false) j) x;
select pg_temp.expect((public.site_made_before(array['kaftan'], false) ->> 'styles')::int = 0, 'a kurta is not a kaftan');
select pg_temp.expect((public.site_made_before(array[]::text[], true) ->> 'styles')::int = 0, 'no fabric shipped');
select pg_temp.expect_error($$select public.set_site_photo('00000000-0000-0000-0000-000000000000', null, null)$$, 'permission denied%');
reset role;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.set_site_photo(%L, %L, 'Kurta')$$, :'line', :'company' || '/x.jpg'), 'Only the owner%');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format($$select public.set_site_photo(%L, 'other/x.jpg', 'Kurta')$$, :'line'), 'That photo is not ours%');
select public.set_site_photo(:'line', :'company' || '/k1.jpg', 'Block-print kurta');
reset role;
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect((public.site_made_before(array['kurta'], false) -> 'photos' -> 0 ->> 'caption') = 'Block-print kurta', 'the chosen photo shows');
reset role;
