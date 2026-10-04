-- Fresh start (2026-10-04).
-- Moves everything the first version of the app created in "public" into a
-- private "old_app" schema. Nothing is deleted: the old orders, payments,
-- samples and the rest stay readable there and can be copied back later.
-- The app cannot reach "old_app" (it is not exposed through the API).
-- Runs only when the old app's tables are present, so it is a no-op on a new database.
do $$
declare
  r record;
begin
  if to_regclass('public.so_styles') is null then
    return;
  end if;

  create schema if not exists old_app;
  revoke all on schema old_app from public;

  -- Tables, views and materialized views (owned sequences, indexes and triggers move with them).
  for r in
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('alter %s public.%I set schema old_app',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.relname);
  end loop;

  -- Stand-alone sequences.
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('alter sequence public.%I set schema old_app', r.relname);
  end loop;

  -- Functions and procedures.
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter routine public.%I(%s) set schema old_app', r.proname, r.args);
  end loop;

  -- Enum and domain types.
  for r in
    select t.typname, t.typtype
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('alter %s public.%I set schema old_app',
      case r.typtype when 'e' then 'type' else 'domain' end, r.typname);
  end loop;
end $$;
