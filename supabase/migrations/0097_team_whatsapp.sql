-- The morning update ask (0097, Dheeraj, 27 Nov 2026). Every morning the owner sends one WhatsApp message to the
-- team group that tags each person and lists what the app shows for them. A tag needs the person's WhatsApp number,
-- so the owner keeps it on the Team page. Digits only, with the country code (91 for India), as WhatsApp writes it.
-- Sourcingo sends nothing itself: the owner taps Send on WhatsApp and picks the group.
-- The numbers sit in their own table so factory and buyer logins, who can read the members list, never see them.
-- Only the owner and managers (who send the ask) read them; only the owner changes them. Nothing is ever deleted:
-- clearing a number saves it empty.

create table public.team_whatsapp (
  company_id uuid not null references public.companies (id),
  user_id uuid not null references public.profiles (id),
  number text check (number ~ '^[1-9][0-9]{9,14}$'),
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id) references public.members (company_id, user_id)
);

alter table public.team_whatsapp enable row level security;

create policy team_whatsapp_read on public.team_whatsapp for select to authenticated
  using (public.my_role(company_id) in ('owner', 'manager'));
create policy team_whatsapp_add on public.team_whatsapp for insert to authenticated
  with check (public.is_owner(company_id));
create policy team_whatsapp_change on public.team_whatsapp for update to authenticated
  using (public.is_owner(company_id)) with check (public.is_owner(company_id));

grant select, insert, update (number, updated_by, updated_at) on public.team_whatsapp to authenticated;

-- Changes land in the activity log by themselves (the history_attach event trigger from 0020).
