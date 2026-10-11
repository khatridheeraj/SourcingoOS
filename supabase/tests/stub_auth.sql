-- Minimal stand-in for the parts of Supabase the migrations rely on, so they
-- can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth, public to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema auth, public to service_role;
