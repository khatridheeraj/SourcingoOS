-- The AI key that reads buyer POs. The owner pastes it once on the Incoming POs page; it is kept out of
-- every table the app can read, and only the PO reader (running on Supabase with the service role) can fetch it.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.ai_keys (
  company_id uuid primary key references public.companies (id),
  api_key text not null,
  set_by uuid references public.profiles (id),
  set_at timestamptz not null default now()
);
revoke all on private.ai_keys from public, anon, authenticated;

-- The owner sets or replaces the key. A blank key is refused; a wrong one shows up as a failed reading.
create function public.set_ai_key(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.is_owner(v_company) then raise exception 'Only the owner can set the AI key.'; end if;
  if v_key !~ '^sk-ant-[A-Za-z0-9_-]{20,}$' then raise exception 'That doesn''t look like an AI key. It starts with sk-ant-.'; end if;
  insert into private.ai_keys (company_id, api_key, set_by) values (v_company, v_key, auth.uid())
  on conflict (company_id) do update set api_key = excluded.api_key, set_by = excluded.set_by, set_at = now();
end $$;

-- Whether the key is in, for the orders team. Never the key itself: only its last 4 characters.
create function public.ai_key_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.can_edit_orders(public.current_company()) then
    coalesce((select jsonb_build_object('set', true, 'last4', right(api_key, 4), 'set_at', set_at)
              from private.ai_keys where company_id = public.current_company()), jsonb_build_object('set', false))
  end;
$$;

-- For the PO reader only.
create function public.get_ai_key(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select api_key from private.ai_keys where company_id = p_company;
$$;

revoke execute on function public.set_ai_key(text), public.ai_key_status(), public.get_ai_key(uuid) from public, anon, authenticated;
grant execute on function public.set_ai_key(text), public.ai_key_status() to authenticated;
grant execute on function public.get_ai_key(uuid) to service_role;
