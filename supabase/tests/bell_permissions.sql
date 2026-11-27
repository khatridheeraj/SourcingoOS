-- One bell, per-person switches and the evening email (0118).
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
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
grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'), ('00000000-0000-0000-0000-00000000000c'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia"}') as oz \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/001', 'buyer_id', :'oz', 'invoice_date', '2026-06-01', 'amount', 100000));
select public.save_order(jsonb_build_object('buyer_id', :'oz', 'buyer_po', 'OZ-1', 'ship_date', (current_date + 40)::text), '[{"style":"OZ-DRESS","qty":600}]') as o1 \gset

-- ---------------------------------------------------------------- Money follows the person's switch
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.invoices) = 0, 'a merchandiser sees no invoices by default');
select pg_temp.expect(not public.my_perm((select id from public.companies), 'export'), 'no downloads by default for a merchandiser');
select pg_temp.expect_error($$select public.set_member_perms('00000000-0000-0000-0000-00000000000b', '{"money":true}')$$, 'Only the owner%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_member_perms('00000000-0000-0000-0000-00000000000b', '{"money":true,"export":true}');
select public.set_member_perms('00000000-0000-0000-0000-0000000000ac', '{"money":false}');
select pg_temp.expect_error($$select public.set_member_perms('00000000-0000-0000-0000-00000000000a', '{"money":false}')$$, 'The owner sees everything%');
select pg_temp.expect_error($$select public.set_member_perms('00000000-0000-0000-0000-00000000000b', '{"prices":false}')$$, 'Unknown switch%');
select pg_temp.expect_error($$select public.set_member_perms('00000000-0000-0000-0000-00000000000b', '{"money":"yes"}')$$, 'Switches are on or off%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.invoices) = 1, 'the merchandiser given Money sees invoices');
select pg_temp.expect(public.my_perm((select id from public.companies), 'export'), 'and may download');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect((select count(*) from public.invoices) = 0, 'Accounts with Money switched off sees no invoices');
select pg_temp.expect_error(format($$select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/002', 'buyer_id', %L, 'invoice_date', '2026-06-02', 'amount', 5))$$, :'oz'), '%');

-- Back to what the role gets: a null clears the switch.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_member_perms('00000000-0000-0000-0000-0000000000ac', '{"money":null}');
select pg_temp.expect((select perms from public.members where user_id = '00000000-0000-0000-0000-0000000000ac') = '{}'::jsonb, 'null clears the switch');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect((select count(*) from public.invoices) = 1, 'Accounts sees money again');
-- Nobody edits their own switches directly.
select pg_temp.expect_error($$update public.members set perms = '{"money":true}' where user_id = auth.uid()$$, 'permission denied%');

-- ---------------------------------------------------------------- the bell
reset role;
insert into public.buyer_messages (company_id, order_id, body, from_buyer) select company_id, id, 'Can we ship a week early?', true from public.orders where id = :'o1';
insert into public.order_notes (company_id, order_id, body, mentions, created_by)
  select company_id, id, '@Merch please check the trims', array['00000000-0000-0000-0000-00000000000b'::uuid], '00000000-0000-0000-0000-00000000000a'
  from public.orders where id = :'o1';
set role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.bell() where kind = 'buyer_message' and order_no is not null and who = 'Ozia') = 1, 'the merchandiser hears the buyer');
select pg_temp.expect((select count(*) from public.bell() where kind = 'tagged') = 1, 'and that they were tagged');
select pg_temp.expect(public.bell_count() = 2, 'two new');
select public.bell_seen();
select pg_temp.expect(public.bell_count() = 0, 'opening Notifications clears the dot');
select pg_temp.expect((select count(*) from public.bell() where not fresh) = 2, 'what was seen stays on the list');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.bell() where kind = 'tagged') = 0, 'nobody hears their own note');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) from public.bell() where kind = 'buyer_message') = 0, 'Quality does not get buyer messages');
select pg_temp.expect_error($$select * from public.bell_for('00000000-0000-0000-0000-00000000000b', now() - interval '1 day')$$, 'permission denied%');
select pg_temp.expect_error($$select public.evening_data_for_email('merch@sourcingo.in')$$, 'permission denied%');

-- ---------------------------------------------------------------- the evening email
reset role;
select pg_temp.expect((public.evening_data_for_email('MERCH@sourcingo.in') -> 'items' -> 0 ->> 'kind') in ('tagged', 'buyer_message'), 'the email carries today''s news');
select pg_temp.expect(public.evening_data_for_email('nobody@sourcingo.in') is null, 'no email for a stranger');
select pg_temp.expect((select count(*) from public.evening_recipients()) = 4, 'the whole team is on the list');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_evening_email(false);
reset role;
select pg_temp.expect(public.evening_data_for_email('merch@sourcingo.in') is null, 'switched off means no email');
