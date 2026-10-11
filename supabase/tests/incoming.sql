-- Incoming PO rule tests. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

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
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07'),
  '[{"style":"K-1","qty":"100"}]'::jsonb) as afh07 \gset

-- ---------------------------------------------------------------- the server receives an email
set role service_role;
select public.receive_email_po('mailbox-secret', '{"email_id":"m1","from":"areeba@gmail.com","subject":"PO AFH08","body":"PFA"}') as e1 \gset
do $$ begin
  if public.receive_email_po('mailbox-secret', '{"email_id":"m1","subject":"again"}') is not null then
    raise exception 'the same email was received twice';
  end if;
  perform public.receive_email_po('wrong', '{"email_id":"m2"}');
  raise exception 'a wrong mailbox key was accepted';
exception when raise_exception then
  if sqlerrm <> 'Unknown mailbox key.' then raise; end if;
end $$;

-- Staff can't hand over emails or save readings themselves.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.receive_email_po('mailbox-secret', '{"email_id":"m3"}');
  raise exception 'a staff login could hand over an email';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.save_po_reading(gen_random_uuid(), '[]', null);
  raise exception 'a staff login could save a reading';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- the AI reading: two POs in one email
set role service_role;
select public.save_po_reading(:'e1', '[
  {"buyer_name":"areeba fashion house ","buyer_code":null,"po_number":"AFH08","ship_date":"2026-11-30","lines":[{"style":"K-2","qty":50}]},
  {"buyer_name":"Areeba Fashion House","po_number":"afh07","lines":[{"style":"K-1","qty":400}]}]', null);
do $$ begin
  if (select count(*) from public.incoming_pos where email_id = 'm1') <> 2 then raise exception 'second PO in the email not split out'; end if;
  if exists (select 1 from public.incoming_pos where email_id = 'm1' and (status <> 'to_check' or buyer_id is null)) then
    raise exception 'buyer not matched by name';
  end if;
  if exists (select 1 from public.incoming_pos where read ? 'buyer_name') then raise exception 'buyer name kept in the reading'; end if;
  if (select matched_order_id is null from public.incoming_pos where email_id = 'm1' and part = 2) then
    raise exception 'a PO already in the system was not matched to its order';
  end if;
  if (select matched_order_id is not null from public.incoming_pos where email_id = 'm1' and part = 1) then
    raise exception 'a new PO was matched to an order';
  end if;
end $$;

-- Reading again doesn't add the extra POs twice.
select public.save_po_reading(:'e1', '[{"buyer_code":"BYR-AH","po_number":"AFH08"},{"buyer_code":"BYR-AH","po_number":"AFH07"}]', null);
do $$ begin
  if (select count(*) from public.incoming_pos where email_id = 'm1') <> 2 then raise exception 'reading again duplicated POs'; end if;
end $$;

-- An email with no PO in it.
select public.receive_email_po('mailbox-secret', '{"email_id":"m4","subject":"Invoice"}') as e4 \gset
select public.save_po_reading(:'e4', '[]', null);
do $$ begin
  if (select status from public.incoming_pos where id = (select id from public.incoming_pos where email_id = 'm4')) <> 'not_po' then raise exception 'non-PO email not set aside'; end if;
end $$;

-- ---------------------------------------------------------------- who sees what
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.incoming_pos) <> 3 then raise exception 'merchandiser does not see incoming POs'; end if;
  if public.incoming_po_buyer_name((select id from public.incoming_pos where part = 2)) is not null then
    raise exception 'merchandiser saw the buyer''s name';
  end if;
end $$;
do $$ begin
  perform buyer_name_read from public.incoming_pos;
  raise exception 'merchandiser could read the buyer name column';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.incoming_po_buyer_name((select id from public.incoming_pos where part = 2)) <> 'Areeba Fashion House' then
    raise exception 'owner does not see the buyer name';
  end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  if (select count(*) from public.incoming_pos) <> 0 then raise exception 'Quality sees incoming POs'; end if;
end $$;

-- ---------------------------------------------------------------- the team adds a file itself, sorts and adds orders
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.incoming_pos (id, source, files)
values ('30000000-0000-0000-0000-000000000001', 'upload', '[{"path":"x/y.pdf","name":"po.pdf"}]');
do $$ begin
  if (select status || created_by from public.incoming_pos where id = '30000000-0000-0000-0000-000000000001')
     <> 'reading00000000-0000-0000-0000-00000000000b' then
    raise exception 'uploaded PO not waiting to be read by its uploader';
  end if;
  insert into public.incoming_pos (source) values ('email');
  raise exception 'staff could add an email PO';
exception when insufficient_privilege or check_violation then null;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  insert into public.incoming_pos (source) values ('upload');
  raise exception 'Quality could add a PO';
exception when insufficient_privilege or check_violation then null;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_incoming_po_status(:'e4', 'to_check');
select public.set_incoming_po_status(:'e4', 'not_po');
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH08'), '[{"style":"K-2","qty":"50"}]'::jsonb) as afh08 \gset
select public.link_incoming_po(:'e1', :'afh08');
do $$ begin
  if (select status from public.incoming_pos where id = (select id from public.incoming_pos where email_id = 'm1' and part = 1)) <> 'added' then raise exception 'PO not marked added'; end if;
  perform public.link_incoming_po((select id from public.incoming_pos where email_id = 'm1' and part = 1), (select id from public.orders limit 1));
  raise exception 'a PO was added twice';
exception when raise_exception then
  if sqlerrm not like 'This incoming PO is not waiting%' then raise; end if;
end $$;
do $$ begin
  perform public.set_incoming_po_status((select id from public.incoming_pos where email_id = 'm1' and part = 1), 'not_po');
  raise exception 'an added PO was set aside';
exception when raise_exception then
  if sqlerrm <> 'This PO is already added as an order.' then raise; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
do $$ begin
  perform public.set_incoming_po_status((select id from public.incoming_pos where email_id = 'm4'), 'to_check');
  raise exception 'Quality could sort POs';
exception when raise_exception then
  if sqlerrm <> 'Only the orders team can sort incoming POs.' then raise; end if;
end $$;
