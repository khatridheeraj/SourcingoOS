-- The weekly buyer update (0099, Dheeraj, 28 Nov 2026). Every week the orders team sends each buyer with an open
-- order one short update: what moved on its POs, approved photos, final QC, shipments and money due. The update is
-- worked out in the app from what the buyer's own page shows; this table only remembers that it went, when and how,
-- so Home can say who is still waiting for this week's. Nothing here is ever deleted.

create table public.buyer_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  buyer_id uuid not null,
  -- The Monday of the week the update was for (India time).
  week_of date not null,
  via text not null check (via in ('whatsapp', 'email', 'copy')),
  sent_by uuid default auth.uid() references public.profiles (id),
  sent_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  unique (company_id, buyer_id, week_of)
);
alter table public.buyer_updates enable row level security;
revoke all on public.buyer_updates from public, anon, authenticated;
grant select on public.buyer_updates to authenticated;
create policy buyer_updates_read on public.buyer_updates for select to authenticated using (public.can_edit_orders(company_id));

-- Marks this week's update to a buyer as sent. Sending again the same week keeps one row and records the latest way.
create function public.mark_buyer_update_sent(p_buyer uuid, p_via text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_week date := v_today - ((extract(isodow from v_today)::int) - 1);
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send buyer updates.';
  end if;
  if p_via is null or p_via not in ('whatsapp', 'email', 'copy') then
    raise exception 'Say how the update was sent.';
  end if;
  if not exists (select 1 from public.buyers b where b.id = p_buyer and b.company_id = v_company) then
    raise exception 'Pick one of your buyers.';
  end if;
  insert into public.buyer_updates (company_id, buyer_id, week_of, via)
  values (v_company, p_buyer, v_week, p_via)
  on conflict (company_id, buyer_id, week_of)
  do update set via = excluded.via, sent_by = auth.uid(), sent_at = now();
end $$;
revoke execute on function public.mark_buyer_update_sent(uuid, text) from public, anon;
grant execute on function public.mark_buyer_update_sent(uuid, text) to authenticated;
