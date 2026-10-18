-- Minimal stand-in for the parts of Supabase the migrations rely on, so they
-- can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
  instance_id uuid, aud text, role text, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text, email_change text
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users (id),
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), not_after timestamptz);
create table auth.refresh_tokens (id bigserial primary key, user_id varchar(255), session_id uuid, revoked boolean);
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create function auth.uid() returns uuid language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant usage on schema auth, public to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema auth, public to service_role;
