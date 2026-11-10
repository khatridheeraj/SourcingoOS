-- Factory claims (0083): Accounts raises a debit note against a factory bill; numbers run CL-0001 on; only the owner
-- and Accounts see or raise them; a wrong one is cancelled with a reason, never deleted.
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
  ('00000000-0000-0000-0000-0000000000a5', 'accounts@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a5'::uuid, 'accounts')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, bills)
select c.id, 'pur-1', 'Purchase', 'purchase', 'KK/101', current_date - 20, 'KKORA (PURCHASE)', 50000, '[{"name":"KK/101","amount":50000}]'::jsonb from public.companies c;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select pg_temp.expect(public.raise_factory_claim('KKORA (PURCHASE)', 'KK/101', null, current_date, 'short', 20, 4000, ' 20 pcs short ') = 'CL-0001', 'first claim is CL-0001');
select pg_temp.expect(public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date - 1, 'late', null, 1500.50, 'Late by 9 days') = 'CL-0002', 'numbers run on');
select pg_temp.expect((select note from public.factory_claims where claim_no = 'CL-0001') = '20 pcs short', 'note is trimmed');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', 'KK/999', null, current_date, 'short', null, 10, 'x')$$, '%bill isn''t in Tally%');
select pg_temp.expect_error($$select public.raise_factory_claim('NOBODY', null, null, current_date, 'short', null, 10, 'x')$$, '%supplier isn''t in Tally%');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date + 1, 'short', null, 10, 'x')$$, '%future%');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date, 'bad', null, 10, 'x')$$, '%what went wrong%');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date, 'short', null, 0, 'x')$$, '%amount%');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date, 'short', null, 10.555, 'x')$$, '%two decimals%');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date, 'short', null, 10, '  ')$$, '%Say what happened%');
select pg_temp.expect_error($$insert into public.factory_claims (company_id, claim_no, ledger, claim_date, reason, amount, note) select id, 'X', 'L', current_date, 'short', 1, 'n' from public.companies$$, '%permission denied%');
select pg_temp.expect_error($$delete from public.factory_claims$$, '%permission denied%');

-- The merchandiser neither sees nor raises claims, nor their history.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.factory_claims) = 0, 'merchandiser sees no claims');
select pg_temp.expect((select count(*) from public.history where table_name = 'factory_claims') = 0, 'merchandiser sees no claim history');
select pg_temp.expect_error($$select public.raise_factory_claim('KKORA (PURCHASE)', null, null, current_date, 'short', null, 10, 'x')$$, '%Only Accounts and the owner%');

-- Cancelling needs a reason and keeps the claim.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select id as cl from public.factory_claims where claim_no = 'CL-0002' \gset
select pg_temp.expect_error(format($$select public.cancel_factory_claim(%L, ' ')$$, :'cl'), '%Say why%');
select public.cancel_factory_claim(:'cl', 'Raised twice');
select pg_temp.expect((select cancelled_at is not null and cancel_reason = 'Raised twice' from public.factory_claims where id = :'cl'), 'cancelled with reason');
select pg_temp.expect((select count(*) from public.factory_claims) = 2, 'cancelled claim is kept');
select pg_temp.expect(public.raise_factory_claim('KKORA (PURCHASE)', 'KK/101', null, current_date, 'quality', 10, 2450, 'Shade fail') = 'CL-0003', 'a cancelled number is not reused');
select pg_temp.expect((select count(*) from public.history where table_name = 'factory_claims') >= 3, 'owner sees claim history');
reset role;
