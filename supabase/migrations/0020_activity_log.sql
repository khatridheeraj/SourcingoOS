-- Activity log: a permanent record of every change made in Sourcingo OS.
--
--   * Every table in the public schema is watched by one trigger, activity_log,
--     including tables added later: a DDL hook attaches it automatically, and
--     re-attaches it if someone drops or disables it.
--   * Each entry says who (name and role at the time), when, from where (the
--     app, the Tally bridge or another API key, server jobs, or direct database
--     work such as imports), which record, what happened, which fields changed,
--     and the full row before and after. Secret columns are masked.
--   * Sign-ins and report exports are logged too.
--   * The log is append-only and kept forever: nobody can edit, delete or
--     truncate entries, and dropping the log or its triggers is blocked.
--   * Staff read the history of records they can already see. Buyer real names
--     (buyer_registry), secrets and sign-ins stay owner-only.
--
-- Scripts that write directly (imports, email pickup, Tally) can label their
-- entries:  select set_config('sourcingo.source', 'email pickup', true);

-- ───────────────────────── richer entries ─────────────────────────
alter table audit_log
  add column source      text,                       -- app | api | server | database | a label set by a script
  add column actor_name  text,                       -- name and role as they were at the time
  add column actor_role  text,
  add column changed     text[],                     -- fields an UPDATE changed
  add column refs        text[] not null default '{}', -- 'table:id' of this row and every record it points to
  add column owners      text[] not null default '{}', -- the subset it belongs to (deleted along with them)
  add column txid        bigint;                     -- entries written by one save share this

create index audit_log_at_idx     on audit_log (at desc, id desc);
create index audit_log_table_idx  on audit_log (table_name, at desc);
create index audit_log_actor_idx  on audit_log (actor, at desc);
create index audit_log_row_idx    on audit_log (table_name, row_id, id desc);
create index audit_log_refs_idx   on audit_log using gin (refs);
create index audit_log_owners_idx on audit_log using gin (owners);

-- Tables only the owner may read history for.
create function activity_private_tables() returns text[]
  language sql immutable as $$ select array['buyer_registry','tally_secret','audit_log'] $$;

-- Masks values of columns that hold secrets.
create function activity_redact(j jsonb) returns jsonb
  language sql immutable as $$
  select case when j is null then null else coalesce((
    select jsonb_object_agg(k, case when k ~* '(secret|password|token|hash|api_?key)' and v <> 'null'::jsonb
                                    then to_jsonb('[hidden]'::text) else v end)
      from jsonb_each(j) e(k, v)), '{}'::jsonb) end
$$;

-- What a table's trigger needs to know: its primary key columns, then each
-- single-column foreign key as 'column=table' ('column=table!' when the row is
-- deleted along with its parent). Links to people (profiles) are left out.
create function activity_config(p_table regclass) returns text[]
  language sql stable set search_path = public, pg_catalog as $$
  select array[coalesce((
           select string_agg(a.attname, ',' order by k.ord)
             from pg_index i
             cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where i.indrelid = p_table and i.indisprimary), '')]
      || coalesce((
           select array_agg(a.attname || '=' || f.relname || case when c.confdeltype = 'c' then '!' else '' end
                            order by a.attname, f.relname)
             from pg_constraint c
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
             join pg_class f on f.oid = c.confrelid
             join pg_namespace n on n.oid = f.relnamespace
            where c.conrelid = p_table and c.contype = 'f' and cardinality(c.conkey) = 1
              and n.nspname = 'public' and f.relname <> 'profiles'), '{}')
$$;

-- The row id and the record keys an entry is filed under.
create function activity_keys(p_table text, p_row jsonb, p_other jsonb, p_cfg text[],
                              out row_id text, out refs text[], out owners text[])
  language plpgsql immutable as $$
declare
  v_pk text[] := string_to_array(nullif(p_cfg[array_lower(p_cfg, 1)], ''), ',');
  v_arg text; v_col text; v_tab text; v_val text; v_owned boolean; i int;
begin
  if v_pk is not null then
    select string_agg(p_row ->> c, '/') into row_id from unnest(v_pk) c;
  end if;
  refs := case when row_id is null then '{}' else array[p_table || ':' || row_id] end;
  owners := '{}';
  for i in array_lower(p_cfg, 1) + 1 .. coalesce(array_upper(p_cfg, 1), 0) loop
    v_arg := p_cfg[i];
    v_owned := right(v_arg, 1) = '!';
    v_col := split_part(rtrim(v_arg, '!'), '=', 1);
    v_tab := split_part(rtrim(v_arg, '!'), '=', 2);
    foreach v_val in array array[p_row ->> v_col, p_other ->> v_col] loop
      continue when v_val is null or (v_tab || ':' || v_val) = any(refs);
      refs := refs || (v_tab || ':' || v_val);
      if v_owned then owners := owners || (v_tab || ':' || v_val); end if;
    end loop;
  end loop;
end $$;

-- Owners are kept transitively: a TNA checkpoint belongs to its style and to
-- the style's order, so the order's history finds it even after both the
-- checkpoint and the style are deleted.
create function activity_inherit(p_owners text[]) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x order by x), '{}') from (
    select unnest(p_owners) x
    union
    select unnest(a.owners) from unnest(p_owners) k
     cross join lateral (select owners from audit_log
                          where table_name = split_part(k, ':', 1) and row_id = substr(k, length(split_part(k, ':', 1)) + 2)
                          order by id desc limit 1) a
  ) s
$$;

-- Where a change came from.
create function activity_source() returns text
  language sql stable as $$
  select coalesce(
    nullif(current_setting('sourcingo.source', true), ''),
    case
      when auth.uid() is not null then 'app'
      when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    nullif(current_setting('request.jwt.claim.role', true), '')) = 'service_role' then 'server'
      when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    nullif(current_setting('request.jwt.claim.role', true), '')) = 'anon' then 'api'
      else 'database'
    end)
$$;

-- ───────────────────────── the trigger ─────────────────────────
create or replace function write_audit() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_cfg text[] := case when tg_nargs > 0 then tg_argv else activity_config(tg_relid) end;
  v_changed text[];
  k record;
  p record;
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_new) n(key, value)
     where value is distinct from v_old -> key and key <> 'updated_at';
    if v_changed is null then return new; end if;   -- nothing really changed
  end if;
  select * into k from activity_keys(tg_table_name, coalesce(v_new, v_old), case when tg_op = 'UPDATE' then v_old end, v_cfg);
  if k.owners <> '{}' then
    k.owners := activity_inherit(k.owners);
    k.refs := k.refs || array(select unnest(k.owners) except select unnest(k.refs));
  end if;
  select coalesce(nullif(full_name, ''), email) as name, role::text as role into p from profiles where id = auth.uid();
  insert into audit_log (table_name, row_id, action, old_data, new_data, source, actor_name, actor_role, changed, refs, owners, txid)
  values (tg_table_name, k.row_id, tg_op, activity_redact(v_old), activity_redact(v_new), activity_source(),
          p.name, p.role, v_changed, k.refs, k.owners, txid_current());
  return coalesce(new, old);
end $$;

-- Puts exactly one up-to-date activity_log trigger on every public table and
-- removes older audit_* duplicates. Safe to run any time.
create function activity_watch_all() returns void
  language plpgsql security definer set search_path = public as $$
declare t record; tr record; v_cfg text[]; v_args text;
begin
  perform set_config('sourcingo.activity_ddl', 'on', true);
  for t in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition and c.relname <> 'audit_log'
  loop
    for tr in select tgname from pg_trigger
               where tgrelid = t.oid and tgfoid = 'write_audit'::regproc and tgname <> 'activity_log' loop
      execute format('drop trigger %I on public.%I', tr.tgname, t.relname);
    end loop;
    v_cfg := activity_config(t.oid);
    v_args := (select string_agg(quote_literal(a), ', ') from unnest(v_cfg) a);
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = t.oid and g.tgname = 'activity_log' and g.tgenabled <> 'D'
                      and obj_description(g.oid, 'pg_trigger') = v_args) then
      if exists (select 1 from pg_trigger where tgrelid = t.oid and tgname = 'activity_log') then
        execute format('drop trigger activity_log on public.%I', t.relname);
      end if;
      execute format('create trigger activity_log after insert or update or delete on public.%I for each row execute function write_audit(%s)',
                     t.relname, v_args);
      execute format('comment on trigger activity_log on public.%I is %L', t.relname, v_args);
    end if;
  end loop;
  perform set_config('sourcingo.activity_ddl', '', true);
end $$;

-- ───────────────────────── fill in older entries ─────────────────────────
-- Entries written before this migration get the same record keys, changed
-- fields and names, so their history reads like new entries.
update audit_log a
   set refs = k.refs, owners = k.owners,
       changed = case when a.action = 'UPDATE' then (
         select array_agg(key order by key) from jsonb_each(a.new_data) n(key, value)
          where value is distinct from a.old_data -> key and key <> 'updated_at') end,
       source = case when a.actor is not null then 'app' else 'database' end,
       actor_name = (select coalesce(nullif(full_name, ''), email) from profiles where id = a.actor),
       actor_role = (select role::text from profiles where id = a.actor)
  from (select o.id, (activity_keys(o.table_name, coalesce(o.new_data, o.old_data),
                        case when o.action = 'UPDATE' then o.old_data end,
                        case when to_regclass('public.' || quote_ident(o.table_name)) is null then array['id']
                             else activity_config(to_regclass('public.' || quote_ident(o.table_name))) end)).*
          from audit_log o where o.source is null) k
 where k.id = a.id;

-- Parents are always logged before their children, so one pass in order
-- carries owners down the chain.
do $$ declare r record; v text[]; begin
  for r in select id, refs, owners from audit_log where owners <> '{}' order by id loop
    v := activity_inherit(r.owners);
    if v <> r.owners then
      update audit_log set owners = v, refs = refs || array(select unnest(v) except select unnest(refs)) where id = r.id;
    end if;
  end loop;
end $$;

-- ───────────────────────── permanent ─────────────────────────
create function activity_log_is_permanent() returns trigger
  language plpgsql as $$
begin
  raise exception 'The activity log is permanent. Entries cannot be changed or deleted.';
end $$;
create trigger activity_log_no_change   before update or delete on audit_log for each row       execute function activity_log_is_permanent();
create trigger activity_log_no_truncate before truncate          on audit_log for each statement execute function activity_log_is_permanent();

revoke insert, update, delete, truncate, references, trigger on audit_log from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke insert, update, delete, truncate, references, trigger on audit_log from service_role';
  end if;
end $$;
grant select on audit_log to authenticated;

-- New and changed tables get their trigger as soon as they are created or
-- altered; the log itself can't be altered, disabled or dropped. A later
-- migration that must change audit_log runs
--   select set_config('sourcingo.activity_ddl', 'on', true);
-- first, in the same transaction.
create function activity_ddl_watch() returns event_trigger
  language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if current_setting('sourcingo.activity_ddl', true) = 'on' then return; end if;
  for r in select * from pg_event_trigger_ddl_commands() loop
    if (r.classid = 'pg_class'::regclass and r.objid = 'public.audit_log'::regclass)
       or (r.object_type = 'trigger' and r.object_identity like '% on public.audit_log') then
      raise exception 'The activity log is permanent and cannot be altered.';
    end if;
  end loop;
  perform activity_watch_all();
end $$;

create function activity_drop_watch() returns event_trigger
  language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if current_setting('sourcingo.activity_ddl', true) = 'on' then return; end if;
  for r in select * from pg_event_trigger_dropped_objects() loop
    if (r.object_type = 'table' and r.object_identity = 'public.audit_log')
       or (r.object_type = 'trigger' and r.original
           and (r.object_identity like 'activity_log on public.%' or r.object_identity like '% on public.audit_log'))
       or (r.object_type = 'function' and r.object_identity in ('public.write_audit()', 'public.activity_log_is_permanent()')) then
      raise exception 'The activity log is permanent: % cannot be dropped.', r.object_identity;
    end if;
    if r.object_type = 'table' and r.original and r.schema_name = 'public' then
      insert into audit_log (table_name, action, source, actor_name, actor_role, txid)
      select r.object_name, 'DROP TABLE', activity_source(), coalesce(nullif(full_name, ''), email), role::text, txid_current()
        from (select 1) one left join profiles on profiles.id = auth.uid();
    end if;
  end loop;
end $$;

create event trigger activity_ddl_watch on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE', 'CREATE TRIGGER', 'ALTER TRIGGER')
  execute function activity_ddl_watch();
create event trigger activity_drop_watch on sql_drop execute function activity_drop_watch();

do $$ begin perform activity_watch_all(); end $$;

-- ───────────────────────── sign-ins and exports ─────────────────────────
create function activity_sign_in() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into audit_log (table_name, row_id, action, actor, source, actor_name, actor_role, refs, txid)
    select 'profiles', new.id::text, 'SIGN_IN', new.id, 'app', coalesce(nullif(p.full_name, ''), p.email, new.email), p.role::text,
           array['profiles:' || new.id], txid_current()
      from (select 1) one left join profiles p on p.id = new.id;
  exception when others then null;   -- never block a sign-in
  end;
  return new;
end $$;

-- Hooked up only where auth.users records sign-ins (Supabase does).
create function activity_watch_sign_ins() returns void
  language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at') then
    perform set_config('sourcingo.activity_ddl', 'on', true);
    if exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'activity_sign_in') then
      drop trigger activity_sign_in on auth.users;
    end if;
    create trigger activity_sign_in after update of last_sign_in_at on auth.users
      for each row when (new.last_sign_in_at is distinct from old.last_sign_in_at) execute function activity_sign_in();
    perform set_config('sourcingo.activity_ddl', '', true);
  end if;
end $$;
do $$ begin perform activity_watch_sign_ins(); end $$;

-- Things people do that change nothing but still matter: downloading exports.
create function log_activity(p_action text, p_table text, p_row text default null, p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = auth.uid() and active and role is not null;
  if not found then raise exception 'Sign in first.'; end if;
  if p_action not in ('EXPORT','DOWNLOAD','PRINT') then raise exception 'Unknown activity %.', p_action; end if;
  insert into audit_log (table_name, row_id, action, new_data, source, actor_name, actor_role, refs, txid)
  values (left(p_table, 60), left(p_row, 200), p_action, case when p_note is not null then jsonb_build_object('note', left(p_note, 500)) end,
          'app', coalesce(nullif(p.full_name, ''), p.email), p.role::text,
          case when p_row is not null then array[left(p_table, 60) || ':' || left(p_row, 200)] else '{}' end, txid_current());
end $$;
revoke execute on function log_activity(text, text, text, text) from public, anon;
grant execute on function log_activity(text, text, text, text) to authenticated;

-- ───────────────────────── who can read what ─────────────────────────
-- Runs as the reader, so a record counts as visible only if their own access
-- rules let them see it (or the record it belongs to).
create function activity_visible(p_table text, p_row text, p_action text, p_owners text[]) returns boolean
  language plpgsql stable set search_path = public as $$
declare k text; v_tab text; v_id text; v_pk text; v_ok boolean;
begin
  if p_action in ('SIGN_IN','DROP TABLE') or p_table = any(activity_private_tables()) then return false; end if;
  foreach k in array (case when p_row is null then '{}'::text[] else array[p_table || ':' || p_row] end) || p_owners loop
    v_tab := split_part(k, ':', 1);
    v_id := substr(k, length(v_tab) + 2);
    continue when v_tab = any(activity_private_tables()) or to_regclass('public.' || quote_ident(v_tab)) is null;
    v_pk := (activity_config(to_regclass('public.' || quote_ident(v_tab))))[1];
    continue when v_pk = '' or v_pk like '%,%';
    execute format('select exists (select 1 from public.%I where %I::text = $1)', v_tab, v_pk) into v_ok using v_id;
    if v_ok then return true; end if;
  end loop;
  return false;
end $$;

drop policy "owner reads audit" on audit_log;
create policy "read activity" on audit_log for select using (
  (select is_owner()) or ((select is_internal()) and activity_visible(table_name, row_id, action, owners)));

-- Everything that happened to one record and the records that belong to it
-- (an order's styles, their TNA checkpoints and files, its GRNs, challans,
-- invoices...), newest first. Runs as the reader, so their access applies.
create function record_history(p_table text, p_id text, p_limit int default 500) returns setof audit_log
  language sql stable set search_path = public as $$
  with keys as (
    select p_table || ':' || p_id as k
    union
    select a.table_name || ':' || a.row_id from audit_log a where a.owners @> array[p_table || ':' || p_id] and a.row_id is not null
  )
  select a.* from audit_log a
   where a.refs && (select array_agg(k) from keys)
   order by a.at desc, a.id desc
   limit least(greatest(p_limit, 1), 2000)
$$;
grant execute on function record_history(text, text, int) to authenticated;
