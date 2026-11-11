-- The buyer sends a new PO from its page (0085): its own company folder, its files checked, marked with its buyer, and it sees where it is.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.headers(p jsonb) returns void language sql as $$
  select set_config('request.headers', p::text, false);
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AH-2201', 'ship_date', (current_date + 40)::text),
  '[{"style":"AH-DRESS-01","qty":600}]') as o1 \gset
select public.buyer_link(:'ah') as ah_secret \gset
select public.buyer_link(:'oz') as oz_secret \gset
reset role;
select user_id as ah_user from public.buyer_links where buyer_id = :'ah' \gset
select user_id as oz_user from public.buyer_links where buyer_id = :'oz' \gset
reset role;
select id as co from public.companies \gset
select gen_random_uuid() as p1 \gset
select gen_random_uuid() as p2 \gset

-- The buyer sends a PO with its file; it lands in Buyer POs waiting to be read, marked with the buyer and PO number.
set role authenticated;
select pg_temp.as_user(:'ah_user');
select pg_temp.expect(public.can_use_po_folder(:'co'), 'buyer cannot upload to its company folder');
select pg_temp.expect(not public.can_use_po_folder(gen_random_uuid()::text), 'buyer can upload to another company');
select public.buyer_send_po(:'p1', jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'p1' || '/a.pdf', 'name', 'AH-2301.pdf',
  'type', 'application/pdf', 'size', 52000)), ' AH-2301 ', 'Please confirm by Friday.');
select pg_temp.expect_error(format('select public.buyer_send_po(%L, %L, null, null)', :'p2', '[]'), 'Pick the PO file first.');
select pg_temp.expect_error(format('select public.buyer_send_po(%L, %L, null, null)', :'p2',
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'p1' || '/b.pdf', 'name', 'x.pdf', 'type', 'application/pdf', 'size', 10))),
  'That file didn''t upload properly.%');
select pg_temp.expect_error(format('select public.buyer_send_po(%L, %L, null, null)', :'p2',
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'p2' || '/b.exe', 'name', 'x.exe', 'type', 'application/x-msdownload', 'size', 10))),
  'That file didn''t upload properly.%');
select pg_temp.expect_error(format('select public.buyer_send_po(%L, %L, null, null)', :'p1',
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'p1' || '/c.pdf', 'name', 'x.pdf', 'type', 'application/pdf', 'size', 10))),
  'This PO was already sent.%');
-- The buyer can't read Buyer POs, but sees its own sent PO with Sourcingo; the other buyer sees nothing.
select pg_temp.expect((select count(*) from public.incoming_pos) = 0, 'buyer reads incoming POs');
select public.buyer_sent_pos() as mine \gset
select pg_temp.expect(jsonb_array_length(:'mine'::jsonb) = 1 and :'mine'::jsonb -> 0 ->> 'state' = 'with_team'
  and :'mine'::jsonb -> 0 ->> 'po' = 'AH-2301' and :'mine'::jsonb -> 0 -> 'files' ->> 0 = 'AH-2301.pdf', 'sent PO not listed right');
select pg_temp.as_user(:'oz_user');
select pg_temp.expect(jsonb_array_length(public.buyer_sent_pos()) = 0, 'other buyer sees it');

-- The team can't send as a buyer; it sees the PO in Buyer POs waiting to be read, with its buyer.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error(format('select public.buyer_send_po(%L, %L, null, null)', :'p2',
  jsonb_build_array(jsonb_build_object('path', :'co' || '/' || :'p2' || '/b.pdf', 'name', 'x.pdf', 'type', 'application/pdf', 'size', 10))),
  'This login is not set up for a buyer.');
select pg_temp.expect((select status = 'receiving' and buyer_id = :'ah' and buyer_po = 'AH-2301' and source = 'upload'
  from public.incoming_pos where id = :'p1'), 'team does not see it waiting');
select pg_temp.expect((select note from public.buyer_po_uploads where incoming_id = :'p1') = 'Please confirm by Friday.', 'note lost');

-- Reading that finds no buyer or PO number keeps what the buyer sent it as.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.save_po_reading(:'p1', '[{"buyer_name":"Someone Else","po_number":"","lines":[]}]'::jsonb, null);
select pg_temp.expect((select buyer_id = :'ah' and buyer_po = 'AH-2301' and status = 'to_check' from public.incoming_pos where id = :'p1'),
  'reading lost the buyer');

-- Once the team adds it as an order, the buyer sees the order.
update public.incoming_pos set status = 'added', order_id = :'o1' where id = :'p1';
set role authenticated;
select pg_temp.as_user(:'ah_user');
select public.buyer_sent_pos() as mine \gset
select pg_temp.expect(:'mine'::jsonb -> 0 ->> 'state' = 'added' and :'mine'::jsonb -> 0 ->> 'order_po' = 'AH-2201', 'added order not shown');
-- A team preview reads the list; it can't send.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah'));
select pg_temp.expect(jsonb_array_length(public.buyer_sent_pos()) = 1, 'preview does not read');
select pg_temp.headers('{}');
reset role;
\echo 'buyer_sends_po: ok'
