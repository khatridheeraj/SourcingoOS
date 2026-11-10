-- A factory's bills and payments in its panel (0078): its own ledger only, no due dates, holds or notes.
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
insert into public.factories (id, company_id, name, tally_ledger) select '20000000-0000-0000-0000-000000000001', id, 'Kkora', 'Kkora Fashions LLP' from public.companies;
insert into public.factories (id, company_id, name, tally_ledger) select '20000000-0000-0000-0000-000000000002', id, 'Shreeji', 'Shreeji Arts' from public.companies;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000003', id, 'No ledger' from public.companies;
insert into public.tally_ledgers (company_id, name, parent, balance)
select c.id, v.name, 'Sundry Creditors', v.balance from public.companies c, (values ('Kkora Fashions LLP', -150000), ('Shreeji Arts', -50000)) v (name, balance);
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, bills)
select c.id, v.guid, v.vtype, v.kind, v.number, current_date - v.ago, v.party, v.amount, v.bills::jsonb from public.companies c,
  (values ('p1', 'Purchase', 'purchase', 'KK-1', 90, 'Kkora Fashions LLP', 100000, '[{"name":"KK-1","amount":100000}]'),
          ('p2', 'Purchase', 'purchase', 'KK-2', 10, 'Kkora Fashions LLP', 80000, '[{"name":"KK-2","amount":80000}]'),
          ('y1', 'Payment', 'payment', 'NEFT', 5, 'Kkora Fashions LLP', 25000, '[{"name":"KK-1","amount":25000}]'),
          ('d1', 'Debit Note', 'debit_note', 'DN/7', 3, 'Kkora Fashions LLP', 5000, '[{"name":"KK-1","amount":5000}]'),
          ('y0', 'Payment', 'payment', 'NEFT', 200, 'Kkora Fashions LLP', 9999, '[]'),
          ('p3', 'Purchase', 'purchase', 'SA-1', 20, 'Shreeji Arts', 50000, '[{"name":"SA-1","amount":50000}]')) v (guid, vtype, kind, number, ago, party, amount, bills);
insert into public.bill_notes (company_id, ledger, bill, hold, note) select id, 'Kkora Fashions LLP', 'KK-2', true, 'Short by 40 pcs' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.factory_link('20000000-0000-0000-0000-000000000001') as s1 \gset
select public.factory_link('20000000-0000-0000-0000-000000000003') as s3 \gset
reset role;
select user_id as kkora from public.members where factory_id = '20000000-0000-0000-0000-000000000001' \gset
select user_id as noledger from public.members where factory_id = '20000000-0000-0000-0000-000000000003' \gset
set role authenticated;

-- Kkora sees its own two bills with what is left, recent payment and debit note, and nothing of Shreeji's.
select pg_temp.as_user(:'kkora');
select public.factory_money() as m \gset
select pg_temp.expect((:'m'::jsonb ->> 'linked')::boolean, 'not linked');
select pg_temp.expect(jsonb_array_length(:'m'::jsonb -> 'bills') = 2, 'wrong number of bills');
select pg_temp.expect((select sum((b ->> 'open')::numeric) = 150000 from jsonb_array_elements(:'m'::jsonb -> 'bills') b), 'open does not match the ledger');
select pg_temp.expect(:'m'::text not like '%SA-1%', 'another factory''s bill shows');
select pg_temp.expect(:'m'::text not like '%Short by%' and :'m'::text not like '%due%' and :'m'::text not like '%hold%', 'notes, holds or due dates leak');
select pg_temp.expect(jsonb_array_length(:'m'::jsonb -> 'paid') = 2, 'payments older than 4 months show, or recent ones are missing');
select pg_temp.expect((:'m'::jsonb -> 'paid' -> 0 ->> 'kind') = 'debit_note' and (:'m'::jsonb -> 'paid' -> 0 ->> 'number') = 'DN/7'
  and (:'m'::jsonb -> 'paid' -> 1 ->> 'number') is null and (:'m'::jsonb -> 'paid' -> 1 -> 'bills' ->> 0) = 'KK-1', 'payment rows wrong');

-- A factory with no Tally ledger sees nothing; a team member without a preview has no money page.
select pg_temp.as_user(:'noledger');
select pg_temp.expect(not (public.factory_money() ->> 'linked')::boolean, 'unlinked factory shows money');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error('select public.factory_money()', 'This login is not set up for a factory.');

reset role;
select pg_temp.expect(not has_function_privilege('anon', 'public.factory_money()', 'execute'), 'signed-out visitors can read factory money');
