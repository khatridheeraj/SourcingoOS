-- The weekly buyer update (0099): the orders team marks each buyer's update as sent, once per week.
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
grant execute on function pg_temp.expect(boolean, text), pg_temp.expect_error(text, text), pg_temp.as_user(uuid) to anon, authenticated;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'), ('00000000-0000-0000-0000-00000000000c', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000a', 'owner' from public.companies;
insert into public.members (company_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'quality' from public.companies;
update public.profiles set current_company_id = (select id from public.companies);
insert into public.buyers (id, company_id, code) select '10000000-0000-0000-0000-000000000001', id, 'BYR-OZ' from public.companies;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.mark_buyer_update_sent('10000000-0000-0000-0000-000000000001', 'whatsapp');
select public.mark_buyer_update_sent('10000000-0000-0000-0000-000000000001', 'copy');
select pg_temp.expect((select count(*) = 1 and bool_and(via = 'copy') and bool_and(extract(isodow from week_of) = 1) from public.buyer_updates), 'one row per buyer per week, latest way kept, week starts Monday');
select pg_temp.expect_error($$select public.mark_buyer_update_sent('10000000-0000-0000-0000-000000000001', 'fax')$$, 'Say how the update was sent.');
select pg_temp.expect_error($$select public.mark_buyer_update_sent('10000000-0000-0000-0000-0000000000ff', 'email')$$, 'Pick one of your buyers.');
select pg_temp.expect_error($$insert into public.buyer_updates (buyer_id, week_of, via) values ('10000000-0000-0000-0000-000000000001', '2026-11-30', 'email')$$, 'permission denied%');

-- Quality neither sends nor reads them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select public.mark_buyer_update_sent('10000000-0000-0000-0000-000000000001', 'email')$$, 'Only the orders team can send buyer updates.');
select pg_temp.expect((select count(*) = 0 from public.buyer_updates), 'quality reads buyer updates');

-- A visitor gets nothing.
set role anon;
select pg_temp.as_user(null);
select pg_temp.expect_error($$select count(*) from public.buyer_updates$$, 'permission denied%');
