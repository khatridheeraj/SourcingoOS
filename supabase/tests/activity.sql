-- Activity log rules. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000fa', 'factory@knits.in');
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Shree Knits' from public.companies;
insert into public.members (company_id, user_id, role, factory_id)
select c.id, u.id, u.role, u.factory from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner', null::uuid),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser', null),
          ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts', null),
          ('00000000-0000-0000-0000-0000000000fa'::uuid, 'factory', '20000000-0000-0000-0000-000000000001'::uuid)) u (id, role, factory);
update public.profiles set current_company_id = (select id from public.companies);

-- Work done straight in the database is recorded as such.
do $$ begin
  if not exists (select 1 from public.history where table_name = 'factories' and source = 'database' and actor is null) then
    raise exception 'database change not recorded as database work';
  end if;
  if not exists (select 1 from public.history where table_name = 'companies' and action = 'insert') then
    raise exception 'companies not recorded';
  end if;
end $$;

-- ---------------------------------------------------------------- the app
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
insert into public.buyers (id, code) values ('10000000-0000-0000-0000-000000000001', 'BYR-OZ');
insert into public.buyer_names (buyer_id, real_name) values ('10000000-0000-0000-0000-000000000001', 'Ozia Fashions');
select public.set_ai_key('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
update public.profiles set full_name = 'Dheeraj' where id = '00000000-0000-0000-0000-00000000000a';
reset role;

do $$
declare
  h record;
begin
  select * into h from public.history where table_name = 'buyers' and action = 'insert';
  if h.source <> 'app' or h.actor <> '00000000-0000-0000-0000-00000000000a' then raise exception 'app change not credited to the owner: %', h; end if;
  select * into h from public.history where table_name = 'ai_keys' order by id desc limit 1;
  if h is null then raise exception 'AI key change not recorded'; end if;
  if h.after::text like '%sk-ant%' or h.after ->> 'api_key' not like 'hidden %' then raise exception 'AI key leaked into history: %', h.after; end if;
  if not exists (select 1 from public.history where table_name = 'profiles' and action = 'update' and after ->> 'full_name' = 'Dheeraj') then
    raise exception 'name change not recorded';
  end if;
end $$;

-- A save that only bumps bookkeeping columns is not a change.
do $$
declare
  n bigint := (select count(*) from public.history);
begin
  insert into public.tally_settings (company_id) select id from public.companies;
  update public.tally_settings set agent_seen_at = now(), agent_info = '{"v":1}';
  if (select count(*) from public.history) <> n + 1 then raise exception 'heartbeat recorded as a change'; end if;
end $$;

-- Records without an id are keyed by their primary key.
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount)
select id, 'g-1', 'Sales', 'sales', 'S/1', current_date, 'Ozia', 100 from public.companies;
do $$ begin
  if (select row_id from public.history where table_name = 'tally_vouchers') <> (select id::text from public.companies) || ':g-1' then
    raise exception 'composite key wrong: %', (select row_id from public.history where table_name = 'tally_vouchers');
  end if;
end $$;

-- Labelled jobs and keys.
begin;
select set_config('sourcingo.source', 'email pickup', true);
insert into public.factories (company_id, name) select id, 'Labelled' from public.companies;
commit;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'anon', false);
insert into public.factories (company_id, name) select id, 'By key' from public.companies;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into public.factories (company_id, name) select id, 'By server' from public.companies;
select set_config('request.jwt.claim.role', '', false);
do $$ begin
  if (select source from public.history where after ->> 'name' = 'Labelled') <> 'email pickup' then raise exception 'job label ignored'; end if;
  if (select source from public.history where after ->> 'name' = 'By key') <> 'key' then raise exception 'key source wrong'; end if;
  if (select source from public.history where after ->> 'name' = 'By server') <> 'server' then raise exception 'server source wrong'; end if;
end $$;

-- ---------------------------------------------------------------- new tables are recorded on their own
create table public.later_things (id uuid primary key default gen_random_uuid(), company_id uuid not null, name text);
insert into public.later_things (company_id, name) select id, 'x' from public.companies;
create table public.later_no_company (id int primary key);
do $$ begin
  if not exists (select 1 from public.history where table_name = 'later_things') then raise exception 'new table not recorded'; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.later_no_company'::regclass and not tgisinternal) then
    raise exception 'recorder attached to a table without company_id';
  end if;
end $$;
-- A migration that adds its own recorder keeps just one.
create table public.later_own (id uuid primary key, company_id uuid);
do $$ begin
  if (select count(*) from pg_trigger where tgrelid = 'public.later_own'::regclass and tgname = 'later_own_history') <> 1 then
    raise exception 'auto recorder not named <table>_history';
  end if;
end $$;

-- ---------------------------------------------------------------- permanent, even for the admin
do $$ begin
  update public.history set source = 'x';
  raise exception 'history entry edited';
exception when raise_exception then
  if sqlerrm not like 'The activity history is permanent%' then raise; end if;
end $$;
do $$ begin
  delete from public.history;
  raise exception 'history entry deleted';
exception when raise_exception then
  if sqlerrm not like 'The activity history is permanent%' then raise; end if;
end $$;
do $$ begin
  truncate public.history;
  raise exception 'history truncated';
exception when raise_exception then
  if sqlerrm not like 'The activity history is permanent%' then raise; end if;
end $$;
do $$ begin
  delete from public.companies;
  raise exception 'deleting the company wiped its history';
exception when raise_exception or foreign_key_violation then null;
end $$;

-- ---------------------------------------------------------------- who reads what
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if not exists (select 1 from public.history where table_name = 'buyers') then raise exception 'merchandiser cannot see buyer changes'; end if;
  if exists (select 1 from public.history where table_name in ('buyer_names', 'ai_keys', 'tally_vouchers', 'tally_settings')) then
    raise exception 'merchandiser sees owner or money history';
  end if;
  insert into public.history (company_id, table_name, row_id, action, source) select id, 'x', 'x', 'insert', 'app' from public.companies;
  raise exception 'merchandiser wrote to history';
exception when insufficient_privilege then null;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ac', false);
do $$ begin
  if not exists (select 1 from public.history where table_name = 'tally_vouchers') then raise exception 'accounts cannot see Tally changes'; end if;
  if exists (select 1 from public.history where table_name in ('buyer_names', 'ai_keys')) then raise exception 'accounts sees owner-only history'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000fa', false);
do $$ begin
  if exists (select 1 from public.history) then raise exception 'factory login can read the history'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if not exists (select 1 from public.history where table_name = 'buyer_names') then raise exception 'owner cannot see everything'; end if;
end $$;
reset role;
