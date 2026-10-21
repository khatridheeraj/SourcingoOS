-- The team's own mail in the PO inbox (0053). Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fb', 'kkora@factory.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
insert into public.inbound_keys (company_id, key_hash, label)
select id, encode(sha256(convert_to('mailbox-secret', 'UTF8')), 'hex'), 'Dheeraj mailbox' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.add_factory_member('kkora@factory.in', '20000000-0000-0000-0000-000000000001');
select public.set_buyer_po_senders(:'ah', array['@areeba.in']);
reset role;
-- An email the owner held from before 0053's clean-up ran.
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, status, sender_unknown)
select id, 'email', 'old-1', 'Dheeraj Khatri <owner@sourcingo.in>', 'Investor summary', 'held', true from public.companies;
insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, status, sender_unknown)
select id, 'email', 'old-2', 'Merch <merch@sourcingo.in>', 'Fwd: PO from a new buyer', 'held', true from public.companies;
update public.incoming_pos i set status = 'not_po'
where i.status = 'held' and public.team_sender(i.company_id, i.email_from) and coalesce(i.email_subject, '') !~* '^\s*(fwd?|fw)\s*:';
select pg_temp.expect((select status = 'not_po' and sender_unknown from public.incoming_pos where email_id = 'old-1'), 'the owner''s own held mail was not set aside privately');
select pg_temp.expect((select status = 'held' from public.incoming_pos where email_id = 'old-2'), 'a held forward was set aside');

set role service_role;
-- The team's own sent mail is skipped.
select pg_temp.expect(public.receive_email_po('mailbox-secret', '{"email_id":"t1","from":"Dheeraj Khatri <OWNER@sourcingo.in>","subject":"John, 20 minutes on Sourcingo?"}') is null,
  'the owner''s own email was taken in');
select pg_temp.expect(public.receive_email_po('mailbox-secret', '{"email_id":"t2","from":"merch@sourcingo.in","subject":"Purchase Order – Sourcingo to Kkora"}') is null,
  'the merchandiser''s factory PO was taken in');
select pg_temp.expect(not exists (select 1 from public.incoming_pos where email_id in ('t1', 't2')), 'skipped mail was stored');
-- A forward from the team is read at once, not held.
select public.receive_email_po('mailbox-secret', '{"email_id":"t3","from":"Merch <merch@sourcingo.in>","subject":"Fwd: Purchase Order KFT-88"}') as t3 \gset
select pg_temp.expect((select status = 'receiving' and not sender_unknown from public.incoming_pos where id = :'t3'), 'a forwarded PO was not read');
select public.receive_email_po('mailbox-secret', '{"email_id":"t4","from":"merch@sourcingo.in","subject":"FW: PO"}') as t4 \gset
select pg_temp.expect((select status = 'receiving' from public.incoming_pos where id = :'t4'), 'an FW: forward was not read');
-- Others behave as before: a known buyer is read, an unknown sender is held, and a factory login is not "the team".
select public.receive_email_po('mailbox-secret', '{"email_id":"b1","from":"orders@areeba.in","subject":"PO AH-9"}') as b1 \gset
select pg_temp.expect((select status = 'receiving' from public.incoming_pos where id = :'b1'), 'a known buyer''s PO was not read');
select public.receive_email_po('mailbox-secret', '{"email_id":"u1","from":"Sunil <sunil@nest.in>","subject":"Re: feedback"}') as u1 \gset
select pg_temp.expect((select status = 'held' and sender_unknown from public.incoming_pos where id = :'u1'), 'an unknown sender was not held');
select public.receive_email_po('mailbox-secret', '{"email_id":"f1","from":"kkora@factory.in","subject":"Bill"}') as f1 \gset
select pg_temp.expect((select status = 'held' from public.incoming_pos where id = :'f1'), 'a factory''s email was treated as the team''s');
-- Nobody calls the check directly.
reset role;
set role authenticated;
do $$ begin
  perform public.team_sender(null, 'x@y.in');
  raise exception 'team_sender is callable';
exception when insufficient_privilege then null;
end $$;
