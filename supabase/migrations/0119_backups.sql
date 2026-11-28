-- Nightly backup: every public table as one gzipped file in a private "backups" bucket, kept 14 nights.
-- The `backup` edge function writes the file (it has the service role, so no key lives in GitHub or the app);
-- pg_cron starts it at 2:20 am India time. The owner downloads a night's file from Team > Data.

-- ---------------------------------------------------------------- the log
create table public.backups (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  file text,                 -- path in the backups bucket
  bytes bigint,
  tables int,
  rows bigint,
  error text,
  removed_at timestamptz     -- the file was cleared after 14 nights
);
-- A nightly log line is not something anyone did: keep it out of the activity log.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'backups_history') then
    alter table public.backups disable trigger backups_history;
  end if;
end $$;
alter table public.backups enable row level security;
create policy "owner reads backups" on public.backups for select to authenticated using (public.is_owner(company_id));
revoke all on public.backups from anon, authenticated;
grant select on public.backups to authenticated;

-- ---------------------------------------------------------------- what the function reads
-- The tables to copy, in an order that can be loaded back (parents first is not needed for NDJSON, but it is tidy).
create function public.backup_tables() returns setof text
language sql stable security definer set search_path = '' as $$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'backups'
  order by c.relname;
$$;
revoke execute on function public.backup_tables() from public, anon, authenticated;

-- One table, a page at a time, as JSON rows. Reads every column, including the rate columns the app can't see.
create function public.backup_page(p_table text, p_offset int, p_limit int) returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.backup_tables() t where t = p_table) then raise exception 'Unknown table %', p_table; end if;
  return query execute format('select to_jsonb(t) from public.%I t order by ctid offset $1 limit $2', p_table) using p_offset, p_limit;
end $$;
revoke execute on function public.backup_page(text, int, int) from public, anon, authenticated;

-- The function proves the call came from the nightly job with a key kept in the vault.
create function public.backup_key_ok(p_key text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return false; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''backup_key''' into v;
  return v is not null and p_key = v;
end $$;
revoke execute on function public.backup_key_ok(text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.backup_tables(), public.backup_page(text, int, int), public.backup_key_ok(text) to service_role;
    grant select, insert, update on public.backups to service_role;
  end if;
end $$;

-- For the owner's page: the newest nights first.
create function public.backup_list() returns table (id bigint, started_at timestamptz, file text, bytes bigint, tables int, rows bigint, error text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.started_at, case when b.removed_at is null then b.file end, b.bytes, b.tables, b.rows, b.error
  from public.backups b where public.is_owner(b.company_id)
  order by b.started_at desc limit 20;
$$;
revoke execute on function public.backup_list() from public, anon;
grant execute on function public.backup_list() to authenticated;

-- ---------------------------------------------------------------- health: hours since the last good backup
create or replace function public.system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_storage numeric;
begin
  if auth.uid() is not null and not public.is_member(public.current_company()) then
    raise exception 'The health report is for the Sourcingo team.';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select round(coalesce(sum((metadata ->> ''size'')::bigint), 0) / 1048576.0) from storage.objects' into v_storage;
  end if;
  return jsonb_build_object(
    'tally_enabled', coalesce((select bool_or(enabled) from public.tally_settings), false),
    'tally_seen_hours', (select round(extract(epoch from now() - max(agent_seen_at)) / 3600, 1) from public.tally_settings where enabled),
    'tally_read_hours', (select round(extract(epoch from now() - max(snapshot_at)) / 3600, 1) from public.tally_settings where enabled),
    'email_hours', (select round(extract(epoch from now() - max(created_at)) / 3600, 1) from public.incoming_pos where source = 'email'),
    'failed_reads_24h', (select count(*) from public.incoming_pos where status = 'failed' and created_at > now() - interval '24 hours'),
    'db_mb', (select pg_database_size(current_database()) / 1048576),
    'storage_mb', v_storage,
    'backup_hours', (select round(extract(epoch from now() - max(finished_at)) / 3600, 1) from public.backups where error is null and finished_at is not null),
    'backup_error', (select b.error from public.backups b order by b.started_at desc limit 1));
end $$;

-- ---------------------------------------------------------------- the bucket (only on Supabase)
-- Nobody signed in can list or change it; the owner gets a short-lived link through the app's server.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('backups', 'backups', false, 104857600)
    on conflict (id) do nothing;
    execute $p$create policy "owner reads backups" on storage.objects for select to authenticated
      using (bucket_id = 'backups' and exists (select 1 from public.members m where m.user_id = auth.uid() and m.role = 'owner' and m.active))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- the nightly start (only on Supabase)
-- A random key in the vault, and a pg_cron job at 20:50 UTC (2:20 am India time) that calls the function with it.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net')
     and to_regclass('vault.secrets') is not null then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    if not exists (select 1 from vault.secrets where name = 'backup_key') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'backup_key', 'Key the nightly backup job sends to the backup function');
    end if;
    perform cron.schedule('nightly-backup', '50 20 * * *', $c$
      select net.http_post(
        url := 'https://zwqoogevoxpafzbdnptz.supabase.co/functions/v1/backup',
        headers := jsonb_build_object('content-type', 'application/json',
          'x-backup-key', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_key')),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000)
    $c$);
  end if;
end $$;
