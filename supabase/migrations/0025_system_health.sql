-- A small health report for the scheduled check (.github/workflows/health.yml), so a stopped Tally
-- reader, a stopped email pickup or POs that can't be read reach the owner by email instead of going
-- unnoticed. It returns only times and counts, never business data, so the public key may call it.
create function public.system_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tally_enabled', coalesce((select bool_or(enabled) from public.tally_settings), false),
    'tally_seen_hours', (select round(extract(epoch from now() - max(agent_seen_at)) / 3600, 1) from public.tally_settings where enabled),
    'email_hours', (select round(extract(epoch from now() - max(created_at)) / 3600, 1) from public.incoming_pos where source = 'email'),
    'failed_reads_24h', (select count(*) from public.incoming_pos where status = 'failed' and created_at > now() - interval '24 hours'),
    'db_mb', (select pg_database_size(current_database()) / 1048576))
$$;
revoke execute on function public.system_health() from public;
grant execute on function public.system_health() to anon, authenticated;
