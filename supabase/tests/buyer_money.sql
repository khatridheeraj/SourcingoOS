-- The buyer's invoices and balance on its page (0082): its own invoices only, what is left as in Payments, no notes or cheques.
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
select id as co from public.companies \gset
-- Loaded as the database owner, not as a signed-in person.
select set_config('request.jwt.claim.sub', '', false);
insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes) values
  (:'co', 'INV-1', :'ah', current_date - 50, 120000, current_date - 20, :'o1', 'Chase hard'),
  (:'co', 'INV-2', :'ah', current_date - 5, 86400, current_date + 25, null, null),
  (:'co', 'INV-3', :'ah', current_date - 70, 64000, current_date - 40, null, null),
  (:'co', 'INV-4', :'ah', current_date - 200, 10000, current_date - 170, null, null),
  (:'co', 'INV-9', :'oz', current_date - 10, 50000, current_date + 20, null, null);
insert into public.cheques (company_id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on) values
  (:'co', :'ah', '220188', 'HDFC Bank', current_date - 12, 50000, 'cleared', current_date - 12, current_date - 12, current_date - 10),
  (:'co', :'ah', '220101', 'HDFC Bank', current_date - 45, 74000, 'cleared', current_date - 45, current_date - 45, current_date - 43),
  (:'co', :'ah', '220300', 'HDFC Bank', current_date + 10, 86400, 'in_hand', current_date - 1, null, null);
insert into public.cheque_allocations (company_id, cheque_id, invoice_id, amount)
select :'co', q.id, i.id, v.amount from (values ('220188', 'INV-1', 50000), ('220101', 'INV-3', 64000), ('220101', 'INV-4', 10000), ('220300', 'INV-2', 86400)) v (chq, inv, amount)
join public.cheques q on q.cheque_no = v.chq join public.invoices i on i.invoice_no = v.inv;
set role authenticated;

-- Areeba sees INV-1 (70,000 left, past due) and INV-2 (a cheque in hand is not paid yet) to pay, INV-3 paid recently;
-- not INV-4 (paid long ago), not Ozia's invoice, not the team's note or any cheque number.
select pg_temp.as_user(:'ah_user');
select public.buyer_money() as m \gset
select pg_temp.expect(jsonb_array_length(:'m'::jsonb -> 'invoices') = 3, 'wrong number of invoices');
select pg_temp.expect((:'m'::jsonb -> 'invoices' -> 0 ->> 'invoice_no') = 'INV-1' and (:'m'::jsonb -> 'invoices' -> 0 ->> 'left')::numeric = 70000
  and (:'m'::jsonb -> 'invoices' -> 0 ->> 'po') = 'AH-2201', 'part-paid invoice wrong');
select pg_temp.expect((:'m'::jsonb -> 'invoices' -> 1 ->> 'invoice_no') = 'INV-2' and (:'m'::jsonb -> 'invoices' -> 1 ->> 'left')::numeric = 86400, 'unpaid invoice wrong');
select pg_temp.expect((:'m'::jsonb -> 'invoices' -> 2 ->> 'invoice_no') = 'INV-3' and (:'m'::jsonb -> 'invoices' -> 2 ->> 'left')::numeric = 0, 'paid invoice wrong');
select pg_temp.expect(:'m'::text not like '%INV-4%' and :'m'::text not like '%INV-9%' and :'m'::text not like '%Chase%' and :'m'::text not like '%2201%88%', 'something leaks');

-- Ozia sees only its own; a team member needs a preview, and the preview shows Areeba's.
select pg_temp.as_user(:'oz_user');
select pg_temp.expect(jsonb_array_length(public.buyer_money() -> 'invoices') = 1, 'Ozia sees the wrong invoices');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error('select public.buyer_money()', 'This login is not set up for a buyer.');
select pg_temp.headers(jsonb_build_object('x-preview-buyer', :'ah'));
select pg_temp.expect(jsonb_array_length(public.buyer_money() -> 'invoices') = 3, 'preview does not show the buyer''s invoices');
select pg_temp.headers('{}');

reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.buyer_money()', 'execute'), 'signed-out visitors can read buyer money');
