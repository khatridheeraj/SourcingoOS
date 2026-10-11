-- Activity log: every change, from every route into the app, kept forever.
-- Builds on public.history (0002). This migration:
--   * notes where each change came from (the app, a server job, the Tally reader or PO pickup key, or direct database work);
--   * records the tables that weren't recorded yet, with secret keys hidden;
--   * records any table added later automatically, so nothing new slips through;
--   * makes the history permanent: nobody, including the owner and the database admin, can change or delete an entry;
--   * keeps factory logins out of the history and buyer emails and keys to the owner.

-- ---------------------------------------------------------------- where a change came from
alter table public.history add column source text not null default 'database';
update public.history set source = 'app' where actor is not null;
create index history_at_idx on public.history (company_id, at desc, id desc);
create index history_actor_idx on public.history (company_id, actor, at desc);

-- Scripts and jobs can label their changes: select set_config('sourcingo.source', 'email pickup', true);
create function public.history_source() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('sourcingo.source', true), ''),
    case
      when auth.uid() is not null then 'app'
      when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    nullif(current_setting('request.jwt.claim.role', true), '')) = 'service_role' then 'server'
      when coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                    nullif(current_setting('request.jwt.claim.role', true), '')) = 'anon' then 'key'
      else 'database'
    end)
$$;

-- Secret values never enter the history; a short fingerprint shows that they changed.
create function public.history_hide_secrets(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p is null then null else p || coalesce((
    select jsonb_object_agg(k, 'hidden ' || left(md5(p ->> k), 6))
    from unnest(array['api_key', 'key_hash']) k
    where p ? k and p ->> k is not null), '{}'::jsonb) end
$$;

-- The record's key: the id where there is one (as before), else its primary key columns joined by ':'.
create function public.history_row_id(p_table regclass, p jsonb) returns text
language sql stable set search_path = '' as $$
  select coalesce(p ->> 'id', p ->> 'buyer_id', p ->> 'user_id', p ->> 'email', (
    select string_agg(p ->> a.attname, ':' order by array_position(i.indkey::int2[], a.attnum))
    from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = p_table and i.indisprimary), '?')
$$;

create or replace function public.record_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Bookkeeping columns that change on every sync or save; a save that only touches these isn't a change.
  v_noise text[] := array['updated_at', 'seen_at', 'agent_seen_at', 'agent_info', 'snapshot_at', 'snapshot_counts'];
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_companies uuid[];
begin
  if tg_op = 'UPDATE' and v_old - v_noise = v_new - v_noise then
    return new;
  end if;
  if v_row ? 'company_id' then
    v_companies := array[(v_row ->> 'company_id')::uuid];
  elsif tg_table_name = 'companies' then
    v_companies := array[(v_row ->> 'id')::uuid];
  elsif tg_table_name = 'profiles' then
    select array_agg(m.company_id) into v_companies from public.members m where m.user_id = (v_row ->> 'id')::uuid;
  end if;
  insert into public.history (company_id, table_name, row_id, action, before, after, source)
  select c, tg_table_name, public.history_row_id(tg_relid, v_row), lower(tg_op),
         public.history_hide_secrets(v_old), public.history_hide_secrets(v_new), public.history_source()
  from unnest(coalesce(v_companies, '{}')) c
  where c is not null;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------- tables not recorded until now
-- Tally's stock items and ledger balances are a read-only copy of Tally, which keeps their history itself.
create trigger companies_history after insert or update or delete on public.companies for each row execute function public.record_history();
create trigger profiles_history after insert or update or delete on public.profiles for each row execute function public.record_history();
create trigger dispatch_lines_history after insert or update or delete on public.dispatch_lines for each row execute function public.record_history();
create trigger dispatch_photos_history after insert or update or delete on public.dispatch_photos for each row execute function public.record_history();
create trigger incoming_pos_history after insert or update or delete on public.incoming_pos for each row execute function public.record_history();
create trigger inbound_keys_history after insert or update or delete on public.inbound_keys for each row execute function public.record_history();
create trigger tally_settings_history after insert or update or delete on public.tally_settings for each row execute function public.record_history();
create trigger tally_vouchers_history after insert or update or delete on public.tally_vouchers for each row execute function public.record_history();
create trigger ai_keys_history after insert or update or delete on private.ai_keys for each row execute function public.record_history();

-- What those tables held when recording began, so every later change has a starting point.
insert into public.history (company_id, table_name, row_id, action, after, source, at)
select company_id, table_name, public.history_row_id(tbl, r), 'insert', public.history_hide_secrets(r), 'database',
       coalesce((r ->> 'created_at')::timestamptz, now())
from (
  select id as company_id, 'companies' as table_name, 'public.companies'::regclass as tbl, to_jsonb(t) as r from public.companies t
  union all select m.company_id, 'profiles', 'public.profiles'::regclass, to_jsonb(t) from public.profiles t join public.members m on m.user_id = t.id
  union all select company_id, 'dispatch_lines', 'public.dispatch_lines'::regclass, to_jsonb(t) from public.dispatch_lines t
  union all select company_id, 'dispatch_photos', 'public.dispatch_photos'::regclass, to_jsonb(t) from public.dispatch_photos t
  union all select company_id, 'incoming_pos', 'public.incoming_pos'::regclass, to_jsonb(t) from public.incoming_pos t
  union all select company_id, 'inbound_keys', 'public.inbound_keys'::regclass, to_jsonb(t) from public.inbound_keys t
  union all select company_id, 'tally_settings', 'public.tally_settings'::regclass, to_jsonb(t) from public.tally_settings t
  union all select company_id, 'tally_vouchers', 'public.tally_vouchers'::regclass, to_jsonb(t) from public.tally_vouchers t
  union all select company_id, 'ai_keys', 'private.ai_keys'::regclass, to_jsonb(t) from private.ai_keys t
) s;

-- ---------------------------------------------------------------- new tables are recorded automatically
-- Any table created later in public with a company_id gets the recorder, unless a migration adds its own.
create function public.history_attach() returns event_trigger
language plpgsql set search_path = '' as $$
declare
  c record;
begin
  for c in
    select e.objid::regclass as tbl, cl.relname
    from pg_catalog.pg_event_trigger_ddl_commands() e
    join pg_catalog.pg_class cl on cl.oid = e.objid
    join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
    where e.classid = 'pg_catalog.pg_class'::regclass and e.command_tag = 'CREATE TABLE'
      and n.nspname = 'public' and cl.relkind in ('r', 'p') and cl.relname <> 'history'
  loop
    if exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = c.tbl and a.attname = 'company_id')
       and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = c.tbl and t.tgfoid = 'public.record_history()'::regprocedure) then
      execute format('create trigger %I after insert or update or delete on %s for each row execute function public.record_history()',
                     c.relname || '_history', c.tbl);
    end if;
  end loop;
end $$;

create event trigger history_attach on ddl_command_end when tag in ('CREATE TABLE')
  execute function public.history_attach();

-- ---------------------------------------------------------------- permanent
create function public.history_is_permanent() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The activity history is permanent: entries can''t be changed or deleted';
end $$;

create trigger history_permanent before update or delete on public.history
  for each row execute function public.history_is_permanent();
create trigger history_no_truncate before truncate on public.history
  for each statement execute function public.history_is_permanent();
revoke insert, update, delete, truncate on public.history from anon, authenticated, service_role;

-- ---------------------------------------------------------------- who reads what
-- Owner: everything. Accounts: also money and Tally. Office staff: the rest. Factory logins: none of it.
-- Buyer real names, buyer emails, and keys stay with the owner.
alter policy history_read on public.history using (
  public.is_owner(company_id)
  or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
    public.is_finance(company_id)
    or (public.my_role(company_id) in ('manager', 'merchandiser', 'quality')
        and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers')))));

revoke execute on function public.history_source(), public.history_hide_secrets(jsonb), public.history_row_id(regclass, jsonb),
  public.history_is_permanent() from public, anon, authenticated;
