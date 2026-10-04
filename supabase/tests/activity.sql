-- Activity log tests. Run after rules.sql on the same database.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create function pg_temp.act_as(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = p_email), ''), false);
end $$;

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%" from: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'wrong error for %: %', p_sql, sqlerrm; end if;
end $$;

-- Every table has exactly one activity_log trigger and no leftover audit_* ones.
do $$ declare v text; begin
  select string_agg(c.relname, ', ') into v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
     and (select count(*) from pg_trigger t where t.tgrelid = c.oid and t.tgfoid = 'write_audit'::regproc and t.tgname = 'activity_log' and t.tgenabled <> 'D') <> 1
      or exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgfoid = 'write_audit'::regproc and t.tgname <> 'activity_log');
  if v is not null then raise exception 'tables without exactly one activity_log trigger: %', v; end if;
end $$;

-- A table created later is watched straight away, even if its migration adds
-- an old-style audit trigger too; drop and disable don't stick.
create table later_things (id text primary key, so_id text references sales_orders(id) on delete cascade, note text);
create trigger audit_later_things after insert or update or delete on later_things for each row execute function write_audit();
do $$ begin
  if (select array_agg(tgname::text) from pg_trigger where tgrelid = 'later_things'::regclass and tgfoid = 'write_audit'::regproc)
     is distinct from array['activity_log'] then raise exception 'new table not watched exactly once'; end if;
end $$;
select pg_temp.expect_error($$drop trigger activity_log on later_things$$, '%permanent%');
alter table later_things disable trigger activity_log;
do $$ begin
  if (select tgenabled from pg_trigger where tgrelid = 'later_things'::regclass and tgname = 'activity_log') = 'D' then
    raise exception 'disabled activity trigger stayed disabled';
  end if;
end $$;

-- The log can't be changed, emptied, altered or dropped.
select pg_temp.expect_error($$update audit_log set action = 'X'$$, '%permanent%');
select pg_temp.expect_error($$delete from audit_log$$, '%permanent%');
select pg_temp.expect_error($$truncate audit_log$$, '%permanent%');
select pg_temp.expect_error($$alter table audit_log disable trigger activity_log_no_change$$, '%permanent%');
select pg_temp.expect_error($$drop trigger activity_log_no_change on audit_log$$, '%permanent%');
select pg_temp.expect_error($$drop table audit_log cascade$$, '%permanent%');
select pg_temp.expect_error($$drop function write_audit() cascade$$, '%permanent%');

-- Dropping a business table is itself recorded.
create table scratch_table (id int primary key);
drop table scratch_table;
do $$ begin
  if not exists (select 1 from audit_log where action = 'DROP TABLE' and table_name = 'scratch_table' and source = 'database') then
    raise exception 'table drop not recorded';
  end if;
end $$;

-- An edit records who, the changed fields, before and after; a save that
-- changes nothing writes nothing.
select pg_temp.act_as('merch@t');
set role authenticated;
update sales_orders set remarks = 'Fabric delayed' where id = 'SO-000001';
update sales_orders set remarks = 'Fabric delayed' where id = 'SO-000001';
reset role;
do $$ declare a audit_log; n int; begin
  select count(*) into n from audit_log where table_name = 'sales_orders' and row_id = 'SO-000001' and new_data ->> 'remarks' = 'Fabric delayed';
  if n <> 1 then raise exception 'expected one entry for the remarks edit, got %', n; end if;
  select * into a from audit_log where table_name = 'sales_orders' and row_id = 'SO-000001' order by id desc limit 1;
  if a.changed is distinct from array['remarks'] or a.source <> 'app' or a.actor_role <> 'merchandiser'
     or a.actor is distinct from (select id from auth.users where email = 'merch@t') or a.old_data ->> 'remarks' is not null then
    raise exception 'edit entry incomplete: %', row_to_json(a);
  end if;
  if not a.refs @> array['sales_orders:SO-000001', 'buyers:' || (a.new_data ->> 'buyer_id')] then raise exception 'refs missing: %', a.refs; end if;
end $$;

-- Direct database work is labelled, and scripts can name themselves.
select set_config('request.jwt.claim.sub', '', false);
begin;
select set_config('sourcingo.source', 'email pickup', true);
insert into later_things (id, so_id, note) values ('L1', 'SO-000001', 'from email');
commit;
insert into later_things (id, so_id, note) values ('L2', 'SO-000001', 'by hand');
do $$ begin
  if (select source from audit_log where table_name = 'later_things' and row_id = 'L1') <> 'email pickup'
     or (select source from audit_log where table_name = 'later_things' and row_id = 'L2') <> 'database' then
    raise exception 'sources wrong';
  end if;
  if (select owners from audit_log where table_name = 'later_things' and row_id = 'L1') <> array['sales_orders:SO-000001'] then
    raise exception 'owner key missing';
  end if;
end $$;

-- Secrets are masked.
create table later_keys (id int primary key, api_key text, label text);
insert into later_keys values (1, 'sk-very-secret', 'x');
do $$ begin
  if (select new_data ->> 'api_key' from audit_log where table_name = 'later_keys') <> '[hidden]' then raise exception 'secret not masked'; end if;
end $$;

-- An order's history includes its styles, their checkpoints and its children.
insert into so_styles (so_id, name) values ('SO-000001', 'History tee');
insert into tna_checkpoints (style_id, name) select id, 'Fabric in' from so_styles where name = 'History tee';
delete from so_styles where name = 'History tee';
select pg_temp.act_as('merch@t');
set role authenticated;
do $$ declare v text[]; begin
  select array_agg(distinct table_name || '.' || action) into v from record_history('sales_orders', 'SO-000001');
  if not v @> array['sales_orders.UPDATE', 'so_styles.INSERT', 'so_styles.DELETE', 'tna_checkpoints.INSERT', 'tna_checkpoints.DELETE', 'later_things.INSERT'] then
    raise exception 'order history incomplete: %', v;
  end if;
end $$;

-- Staff never see buyer real names or sign-ins, and only read the history of
-- records they can open; buyers and factories see nothing.
reset role;
insert into buyer_registry (buyer_id, real_name) select id, 'Real Buyer Pvt Ltd' from buyers where code = 'BYR-AH-0001';
alter table auth.users add column last_sign_in_at timestamptz;
select activity_watch_sign_ins();
update auth.users set last_sign_in_at = now() where email = 'merch@t';
do $$ begin
  if not exists (select 1 from audit_log where action = 'SIGN_IN' and actor = (select id from auth.users where email = 'merch@t')) then
    raise exception 'sign-in not recorded';
  end if;
end $$;
set role authenticated;
do $$ begin
  if exists (select 1 from audit_log where table_name = 'buyer_registry' or action in ('SIGN_IN', 'DROP TABLE'))
     or exists (select 1 from audit_log where new_data::text like '%Real Buyer%') then
    raise exception 'merchandiser saw private activity';
  end if;
  if not exists (select 1 from audit_log where table_name = 'sales_orders') then raise exception 'merchandiser saw no order history'; end if;
  if exists (select 1 from audit_log where table_name in ('invoices', 'cheques', 'cheque_allocations')) then raise exception 'merchandiser saw payment history'; end if;
end $$;
select pg_temp.act_as('accounts@t');
do $$ begin
  if exists (select 1 from audit_log where table_name in ('inquiries', 'received_pos')) then raise exception 'accounts saw inquiry history'; end if;
  if not exists (select 1 from audit_log where table_name = 'cheques') then raise exception 'accounts missed cheque history'; end if;
end $$;
select pg_temp.act_as('buyer@t');
do $$ begin if exists (select 1 from audit_log) then raise exception 'buyer read the activity log'; end if; end $$;
select pg_temp.act_as('factory@t');
do $$ begin if exists (select 1 from audit_log) then raise exception 'factory read the activity log'; end if; end $$;
select pg_temp.expect_error($$insert into audit_log (table_name, action) values ('x', 'INSERT')$$, '%permission denied%');

-- The owner sees everything, and exports are logged.
reset role;
select pg_temp.act_as((select email from profiles where role = 'owner' and active order by email limit 1));
set role authenticated;
do $$ begin
  if not exists (select 1 from audit_log where table_name = 'buyer_registry') or not exists (select 1 from audit_log where action = 'SIGN_IN') then
    raise exception 'owner missed entries';
  end if;
  perform log_activity('EXPORT', 'reports', 'sales-orders');
  if not exists (select 1 from audit_log where action = 'EXPORT' and row_id = 'sales-orders' and actor_role = 'owner') then raise exception 'export not logged'; end if;
end $$;
select pg_temp.expect_error($$select log_activity('DELETE', 'reports')$$, 'Unknown activity%');
select pg_temp.act_as('');
select pg_temp.expect_error($$select log_activity('EXPORT', 'reports')$$, 'Sign in first%');
reset role;

\o
\echo 'All activity log tests passed.'
