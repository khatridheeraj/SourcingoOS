-- Nightly backup (0119): the log is the owner's alone, the reader functions are for the backup job only.
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
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

-- What the job writes (as the database owner here; the service role on Supabase).
insert into public.backups (company_id, finished_at, file, bytes, tables, rows)
select id, now() - interval '3 hours', '2026-11-28-1.ndjson.gz', 1234, 70, 9000 from public.companies;
select pg_temp.expect((select count(*) from public.backup_tables() t where t = 'orders') = 1, 'the job copies orders');
select pg_temp.expect((select count(*) from public.backup_tables() t where t = 'backups') = 0, 'the log is not copied into itself');
select pg_temp.expect((select count(*) from public.backup_page('companies', 0, 10)) = 1, 'a page of rows comes back as JSON');
select pg_temp.expect_error($$select public.backup_page('pg_authid', 0, 1)$$, 'Unknown table%');
select pg_temp.expect(not public.backup_key_ok('guess'), 'a made-up key is refused');
select pg_temp.expect((public.system_health() ->> 'backup_hours')::numeric between 2.9 and 3.1, 'health reports hours since the last good backup');

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.backup_list() where file is not null) = 1, 'the owner sees the night''s file');
select pg_temp.expect_error($$select public.backup_tables()$$, 'permission denied%');
select pg_temp.expect_error($$select public.backup_page('orders', 0, 1)$$, 'permission denied%');
select pg_temp.expect_error($$select public.backup_key_ok('x')$$, 'permission denied%');
select pg_temp.expect_error($$insert into public.backups (company_id) select id from public.companies$$, 'permission denied%');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select pg_temp.expect((select count(*) from public.backup_list()) = 0, 'Accounts does not see backups');
select pg_temp.expect((select count(*) from public.backups) = 0, 'Accounts cannot read the log');
reset role;
