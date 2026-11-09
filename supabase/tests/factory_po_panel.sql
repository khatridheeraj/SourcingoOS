-- Factory POs in the factory's panel (0076): the factory sees the POs sent to it and accepts one in the panel.
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji Arts' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'SO/172/2026', 'ship_date', (current_date + 40)::text),
  '[{"style":"AV-142","qty":500,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"AV-129","qty":500,"factory_id":"20000000-0000-0000-0000-000000000002"}]') as o1 \gset
select public.factory_link('20000000-0000-0000-0000-000000000001') as k_secret \gset
select public.factory_link('20000000-0000-0000-0000-000000000002') as s_secret \gset
reset role;
insert into public.factory_pos (company_id, order_id, factory_id)
select company_id, :'o1', f from public.orders, unnest(array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[]) f where id = :'o1';
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as shreeji from public.members where factory_id = '20000000-0000-0000-0000-000000000002' \gset
set role authenticated;

-- Nothing shows, and nothing can be accepted, until the PO has been released and sent.
select pg_temp.as_user(:'kkora');
select pg_temp.expect(public.factory_po_list() = '[]'::jsonb, 'an unsent PO shows in the panel');
select pg_temp.expect_error(format('select public.factory_accept_po(%L)', :'o1'), 'This PO has not been sent to you yet.');
reset role;
update public.factory_pos set released_at = now() where order_id = :'o1';
update public.factory_pos set mailed_at = now() - interval '1 day' where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001';
set role authenticated;

-- Kkora sees its sent PO with its number, link and style count; Shreeji's PO, still unsent, stays hidden.
select pg_temp.as_user(:'kkora');
select pg_temp.expect(jsonb_array_length(public.factory_po_list()) = 1, 'Kkora sees one PO');
select pg_temp.expect((public.factory_po_list()->0->>'po_no') = 'SO/172/2026-1' and (public.factory_po_list()->0->>'styles')::int = 1
  and public.factory_po_list()->0->>'accepted_at' is null, 'PO number, style count or status wrong');
select pg_temp.as_user(:'shreeji');
select pg_temp.expect(public.factory_po_list() = '[]'::jsonb, 'Shreeji sees a PO not sent to it');
select pg_temp.expect_error(format('select public.factory_accept_po(%L)', :'o1'), 'This PO has not been sent to you yet.');

-- The owner previewing Kkora's panel sees the PO but cannot accept it for them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_config('request.headers', '{"x-preview-factory":"20000000-0000-0000-0000-000000000001"}', false);
select pg_temp.expect(jsonb_array_length(public.factory_po_list()) = 1, 'preview does not show the PO');
select pg_temp.expect_error(format('select public.factory_accept_po(%L)', :'o1'), 'This login is not set up for a factory.');
select set_config('request.headers', '{}', false);

-- Kkora accepts in the panel: accepted on the link, so reminders stop; accepting again changes nothing.
select pg_temp.as_user(:'kkora');
select public.factory_accept_po(:'o1');
reset role;
select pg_temp.expect((select accepted_at is not null and accepted_via = 'link' and accept_note = 'Accepted in the factory panel'
  from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001'), 'not accepted');
select pg_temp.expect((select accepted_at is null from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000002'), 'accepted the other factory''s PO');
select accepted_at as first_at from public.factory_pos where order_id = :'o1' and factory_id = '20000000-0000-0000-0000-000000000001' \gset
select pg_temp.expect(not exists (select 1 from jsonb_array_elements(public.po_mail_due()) d where d->>'order_id' = :'o1' and d->>'factory_id' = '20000000-0000-0000-0000-000000000001'), 'reminders still due after acceptance');
set role authenticated;
select pg_temp.as_user(:'kkora');
select public.factory_accept_po(:'o1');
select pg_temp.expect((public.factory_po_list()->0->>'accepted_at')::timestamptz = :'first_at'::timestamptz, 'accepting again changed the time');

reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.factory_po_list()', 'execute')
  and not has_function_privilege('anon', 'public.factory_accept_po(uuid)', 'execute'), 'signed-out visitors can call the PO functions');
