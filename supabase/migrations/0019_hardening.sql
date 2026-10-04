-- Housekeeping from the database advisor:
--  1. every foreign key gets an index, so joins and cascading deletes stay fast
--     as orders pile up;
--  2. the two functions without a fixed search_path get one;
--  3. signed-out visitors (anon) can't call any of the app's functions.

-- 1. An index for each single-column foreign key that doesn't lead an index yet.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col, cl.relname as tname
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and n.nspname = 'public' and array_length(c.conkey, 1) = 1
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s (%I)', left(r.tname || '_' || r.col || '_fk', 63), r.tbl, r.col);
  end loop;
end $$;

-- 2. Fixed search paths.
alter function touch_updated_at() set search_path = public;
do $$ begin
  if to_regprocedure('sample_rank(sample_status)') is not null then
    alter function sample_rank(sample_status) set search_path = public;
  end if;
end $$;

-- 3. Only signed-in users run app functions. Whatever a signed-in user could
--    run before stays runnable; anon loses everything except the Tally bridge,
--    which signs in with its own key.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if has_function_privilege('authenticated', r.fn, 'execute') then
      execute format('grant execute on function %s to authenticated', r.fn);
    end if;
    if r.proname not like 'tally\_bridge\_%' then
      execute format('revoke execute on function %s from public, anon', r.fn);
    end if;
  end loop;
end $$;

-- Functions created later are not open to anon by default.
alter default privileges in schema public revoke execute on functions from public, anon;
