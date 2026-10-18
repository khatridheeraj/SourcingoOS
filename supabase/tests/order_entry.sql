-- Order entry check tests: duplicate buyer POs, repeated styles, and emails from unknown senders.
-- Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
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
insert into public.inbound_keys (company_id, key_hash, label)
select id, encode(sha256(convert_to('mailbox-secret', 'UTF8')), 'hex'), 'Dheeraj mailbox' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}') as oz \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH-0007'),
  '[{"style":"K-1","qty":"100"},{"style":"K-2","qty":"50"}]'::jsonb) as afh07 \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH-0009', 'status', 'cancelled'),
  '[{"style":"K-9","qty":"100"}]'::jsonb) as afh09 \gset

-- ---------------------------------------------------------------- order_entry_warnings
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.order_entry_warnings(:'ah', ' afh-0007 ', array['k-1 ', 'K-3'], null) as w \gset
select pg_temp.expect(jsonb_array_length(:'w'::jsonb -> 'same_po') = 1, 'the same PO number was not found');
select pg_temp.expect((:'w'::jsonb -> 'same_po' -> 0 ->> 'id') = :'afh07', 'the same PO pointed at the wrong order');
select pg_temp.expect(jsonb_array_length(:'w'::jsonb -> 'similar_po') = 0, 'an exact PO was also listed as similar');
select pg_temp.expect((:'w'::jsonb -> 'same_style' -> 0 -> 'styles') = '["K-1"]'::jsonb, 'a repeated style was not found');

select public.order_entry_warnings(:'ah', 'AFH 7', '{}', null) as w \gset
select pg_temp.expect(jsonb_array_length(:'w'::jsonb -> 'same_po') = 0 and jsonb_array_length(:'w'::jsonb -> 'similar_po') = 1,
  'a PO number differing only in spaces, dashes and zeros was not flagged as similar');

select public.order_entry_warnings(:'ah', 'AFH-0007', array['K-1'], :'afh07') as w \gset
select pg_temp.expect(:'w'::jsonb = '{"same_po":[],"similar_po":[],"same_style":[]}', 'an order warned about itself');

select public.order_entry_warnings(:'ah', 'AFH-0010', array['K-9'], null) as w \gset
select pg_temp.expect(jsonb_array_length(:'w'::jsonb -> 'same_style') = 0, 'a style on a cancelled order was warned about');

select public.order_entry_warnings(:'oz', 'AFH-0007', array['K-1'], null) as w \gset
select pg_temp.expect(:'w'::jsonb = '{"same_po":[],"similar_po":[],"same_style":[]}', 'another buyer''s PO or style was warned about');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  perform public.order_entry_warnings((select id from public.buyers where code = 'BYR-AH'), 'X', '{}', null);
  raise exception 'Quality could check orders';
exception when raise_exception then
  if sqlerrm <> 'Only the orders team can check orders.' then raise; end if;
end $$;

-- ---------------------------------------------------------------- unknown senders
-- With no known senders anywhere, emails are read as before.
set role service_role;
select public.receive_email_po('mailbox-secret', '{"email_id":"s0","from":"someone@else.com","subject":"PO"}') as s0 \gset
select pg_temp.expect((select status = 'receiving' and not sender_unknown from public.incoming_pos where id = :'s0'),
  'an email was held before any sender was known');

-- Only the owner sets a buyer's known senders; addresses and domains are tidied and checked.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.set_buyer_po_senders((select id from public.buyers where code = 'BYR-AH'), array['x@y.com']);
  raise exception 'a merchandiser could set PO senders';
exception when raise_exception then
  if sqlerrm not like 'Only the owner%' then raise; end if;
end $$;
do $$ begin
  perform po_senders from public.buyers limit 1;
  raise exception 'a merchandiser could read PO senders';
exception when insufficient_privilege then null;
end $$;
select pg_temp.expect(public.buyer_po_senders() = '{}', 'a merchandiser got the PO senders');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  perform public.set_buyer_po_senders((select id from public.buyers where code = 'BYR-AH'), array['not an email']);
  raise exception 'a bad sender was saved';
exception when raise_exception then
  if sqlerrm not like '%is not an email address%' then raise; end if;
end $$;
select public.set_buyer_po_senders(:'ah', array[' Orders@Areeba.in ', 'areeba-fashion.com', '@areeba-fashion.com']);
select pg_temp.expect((public.buyer_po_senders() -> :'ah') = '["@areeba-fashion.com", "orders@areeba.in"]',
  'PO senders were not tidied');

set role service_role;
select public.receive_email_po('mailbox-secret', '{"email_id":"s1","from":"\"Areeba\" <ORDERS@areeba.in>","subject":"PO 8"}') as s1 \gset
select public.receive_email_po('mailbox-secret', '{"email_id":"s2","from":"raj@areeba-fashion.com","subject":"PO 9"}') as s2 \gset
select public.receive_email_po('mailbox-secret', '{"email_id":"s3","from":"Bills <bills@bank.com>","subject":"Statement"}') as s3 \gset
select public.receive_email_po('mailbox-secret', '{"email_id":"s4","from":"raj@notareeba-fashion.com","subject":"PO"}') as s4 \gset
select pg_temp.expect((select status = 'receiving' from public.incoming_pos where id = :'s1'), 'a known address was held');
select pg_temp.expect((select status = 'receiving' from public.incoming_pos where id = :'s2'), 'a known domain was held');
select pg_temp.expect((select status = 'held' and sender_unknown from public.incoming_pos where id = :'s3'), 'an unknown sender was not held');
select pg_temp.expect((select status = 'held' from public.incoming_pos where id = :'s4'), 'a look-alike domain was taken as known');

-- A held email is never read, even if the reader is asked.
select public.save_po_reading(:'s3', '[{"buyer_code":"BYR-AH","po_number":"X1"}]', null);
select pg_temp.expect((select status = 'held' and read is null from public.incoming_pos where id = :'s3'), 'a held email was read');

-- Only the owner sees held mail or sorts it.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(not exists (select 1 from public.incoming_pos where sender_unknown), 'a merchandiser saw mail from an unknown sender');
select pg_temp.expect(not public.can_read_po_file((select company_id from public.buyers limit 1) || '/' || :'s3' || '/a.pdf'),
  'a merchandiser could open the files of a held email');
do $$ begin
  perform public.set_incoming_po_status((select id from public.incoming_pos where email_id = 's3'), 'not_po');
  raise exception 'a merchandiser sorted a held email';
exception when raise_exception then
  if sqlerrm <> 'Only the orders team can sort incoming POs.' then raise; end if;
end $$;
do $$ begin
  perform public.accept_po_sender((select id from public.incoming_pos where email_id = 's3'), null);
  raise exception 'a merchandiser accepted a held email';
exception when raise_exception then
  if sqlerrm not like 'Only the owner%' then raise; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) = 2 from public.incoming_pos where status = 'held'), 'the owner does not see held mail');
select pg_temp.expect(public.can_read_po_file((select company_id from public.buyers limit 1) || '/' || :'s3' || '/a.pdf'),
  'the owner could not open the files of a held email');
do $$ begin
  perform public.set_incoming_po_status((select id from public.incoming_pos where email_id = 's3'), 'not_po');
  raise exception 'a held email was set aside without accept or ignore';
exception when raise_exception then
  if sqlerrm <> 'Accept or ignore this sender first.' then raise; end if;
end $$;

-- Ignored: set aside and still private. Put back: held again.
select public.ignore_po_sender(:'s3');
select pg_temp.expect((select status = 'not_po' and sender_unknown from public.incoming_pos where id = :'s3'), 'ignoring did not set it aside');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(not exists (select 1 from public.incoming_pos where email_id = 's3'), 'an ignored email became visible to the team');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_incoming_po_status(:'s3', 'to_check');
select pg_temp.expect((select status = 'held' from public.incoming_pos where id = :'s3'), 'putting back an ignored email skipped the owner');

-- Accepted and remembered: it is read, the team sees it, and the sender's next email is picked up as normal.
select public.accept_po_sender(:'s4', :'oz');
select pg_temp.expect((select status = 'reading' and not sender_unknown from public.incoming_pos where id = :'s4'), 'accepting did not start the reading');
select pg_temp.expect((public.buyer_po_senders() -> :'oz') = '["raj@notareeba-fashion.com"]', 'the accepted sender was not remembered');
do $$ begin
  perform public.accept_po_sender((select id from public.incoming_pos where email_id = 's4'), null);
  raise exception 'an email was accepted twice';
exception when raise_exception then
  if sqlerrm not like 'This email is not waiting%' then raise; end if;
end $$;
set role service_role;
select public.save_po_reading(:'s4', '[{"buyer_code":"BYR-OZ","po_number":"OZ1","lines":[]}]', null);
select pg_temp.expect((select status = 'to_check' from public.incoming_pos where id = :'s4'), 'an accepted email was not read');
select public.receive_email_po('mailbox-secret', '{"email_id":"s5","from":"Raj <raj@notareeba-fashion.com>","subject":"PO 2"}') as s5 \gset
select pg_temp.expect((select status = 'receiving' from public.incoming_pos where id = :'s5'), 'a remembered sender was held again');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(exists (select 1 from public.incoming_pos where email_id = 's4'), 'the team cannot see an accepted email');

-- Accepting without a buyer reads this one email and remembers nobody.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.accept_po_sender(:'s3', null);
select pg_temp.expect(not (public.buyer_po_senders()::text like '%bank.com%'), 'a sender was remembered without a buyer');

-- The From line is read the same way however it is written.
select pg_temp.expect(public.email_address('"Areeba, Orders" <Orders@Areeba.in>') = 'orders@areeba.in', 'quoted From line misread');
select pg_temp.expect(public.email_address('orders@areeba.in') = 'orders@areeba.in', 'bare address misread');
select pg_temp.expect(public.email_address('Areeba') is null, 'a From line with no address gave one');
select pg_temp.expect(public.po_key(' PO-0045 / a ') = 'po45a' and public.po_key('---') is null, 'PO numbers not compared on letters and digits');
