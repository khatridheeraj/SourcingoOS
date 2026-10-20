-- Help and team notes (0044).
-- Everyone who uses the app (staff, factory and buyer logins) has a Help button. It answers "how do I…" from the
-- written guide in the app, for free, and logs each question so the guide can learn what it couldn't answer.
-- Anyone can also send the owner a note: something not working, wrong data, an idea, or a question the guide
-- couldn't answer. The owner decides on each one (do it, later, no, done) and replies; the sender sees the answer.
-- Claude reviews new notes every morning and writes a suggested fix on each one for the owner.
-- Nothing here is ever deleted.

-- ---------------------------------------------------------------- notes to the owner
create table public.team_notes (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity,
  company_id uuid not null references public.companies (id),
  created_by uuid not null references public.profiles (id),
  kind text not null check (kind in ('problem', 'wrong_data', 'idea', 'question')),
  body text not null check (length(btrim(body)) between 2 and 4000),
  page text check (length(page) <= 300),
  page_title text check (length(page_title) <= 120),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  status text not null default 'new' check (status in ('new', 'planned', 'later', 'done', 'declined')),
  reply text check (length(reply) <= 4000),
  replied_by text check (length(replied_by) <= 80),
  replied_at timestamptz,
  -- Claude's suggested fix, for the owner only.
  suggestion text check (length(suggestion) <= 4000),
  suggested_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  -- false while the sender hasn't seen the latest reply or decision.
  seen boolean not null default true,
  created_at timestamptz not null default now()
);
-- Notes are between one person and the owner. The activity log is open to the whole team, so they stay out of it.
alter table public.team_notes disable trigger team_notes_history;
create index team_notes_company on public.team_notes (company_id, created_at desc);
create index team_notes_mine on public.team_notes (created_by, created_at desc);
alter table public.team_notes enable row level security;
revoke all on public.team_notes from public, anon, authenticated;

-- ---------------------------------------------------------------- questions asked in Help
-- One row per question typed into Help, with the guide answer it got and whether it helped.
create table public.help_asks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  asked_by uuid not null references public.profiles (id),
  question text not null check (length(btrim(question)) between 1 and 500),
  page text check (length(page) <= 300),
  topic text check (length(topic) <= 80),
  helpful boolean,
  created_at timestamptz not null default now()
);
alter table public.help_asks disable trigger help_asks_history;
create index help_asks_company on public.help_asks (company_id, created_at desc);
alter table public.help_asks enable row level security;
revoke all on public.help_asks from public, anon, authenticated;

-- The name the owner sees for a person.
create function public.person_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from public.profiles p where p.id = p_user
$$;
revoke execute on function public.person_name(uuid) from public, anon, authenticated;

-- Who is writing: any active login of the company, staff or partner, with a factory's name when it is one.
create function public.help_sender_label(p_company uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case m.role
    when 'factory' then coalesce((select f.name from public.factories f where f.id = m.factory_id), 'Factory')
    when 'buyer' then coalesce((select coalesce(n.real_name, b.code) from public.buyers b left join public.buyer_names n on n.buyer_id = b.id
                                where b.id = m.buyer_id), 'Buyer')
    else public.person_name(p_user) end
  from public.members m where m.company_id = p_company and m.user_id = p_user
$$;
revoke execute on function public.help_sender_label(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- send a note
create function public.send_team_note(p_kind text, p_body text, p_page text, p_page_title text, p_photos text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_row public.team_notes%rowtype;
  v_photos text[] := coalesce(p_photos, '{}');
begin
  if v_company is null or public.my_role(v_company) is null then
    raise exception 'Sign in to send a note.';
  end if;
  if p_kind is null or p_kind not in ('problem', 'wrong_data', 'idea', 'question') then
    raise exception 'Pick what kind of note this is.';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 2 then
    raise exception 'Write a few words about it.';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Keep it under 4000 letters.';
  end if;
  if cardinality(v_photos) > 4 then
    raise exception 'Add at most 4 photos.';
  end if;
  if exists (select 1 from unnest(v_photos) p where p not like v_company || '/help/' || auth.uid() || '/%') then
    raise exception 'Those photos are not yours.';
  end if;
  if (select count(*) from public.team_notes where created_by = auth.uid() and created_at > now() - interval '1 day') >= 40 then
    raise exception 'That''s a lot of notes today. Send the rest tomorrow, or message Dheeraj.';
  end if;
  insert into public.team_notes (company_id, created_by, kind, body, page, page_title, photos)
  values (v_company, auth.uid(), p_kind, btrim(p_body), left(nullif(btrim(p_page), ''), 300), left(nullif(btrim(p_page_title), ''), 120), v_photos)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'no', v_row.no);
end $$;
revoke execute on function public.send_team_note(text, text, text, text, text[]) from public, anon;
grant execute on function public.send_team_note(text, text, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------- read notes
-- The owner reads every note of the company with Claude's suggestion; everyone else reads their own, without it.
create function public.team_notes_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select n.id, n.no, n.kind, n.body, n.page, n.page_title, n.photos, n.status, n.reply, n.replied_by, n.replied_at,
           n.decided_at, n.seen, n.created_at, n.created_by = auth.uid() as mine,
           case when public.is_owner(n.company_id) then n.suggestion end as suggestion,
           case when public.is_owner(n.company_id) then public.help_sender_label(n.company_id, n.created_by) end as sender,
           case when public.is_owner(n.company_id) then (select m.role from public.members m where m.company_id = n.company_id and m.user_id = n.created_by) end as sender_role
    from public.team_notes n
    where n.company_id = public.current_company()
      and (n.created_by = auth.uid() or public.is_owner(n.company_id))
    order by n.created_at desc
    limit 400
  ) x
$$;
revoke execute on function public.team_notes_list() from public, anon;
grant execute on function public.team_notes_list() to authenticated;

-- Small counts for the Help button and the owner's menu, and the owner's first name for Help to say who reads the notes.
create function public.help_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owner', (select split_part(public.person_name(m.user_id), ' ', 1) from public.members m
              where m.company_id = public.current_company() and m.role = 'owner' and m.active order by m.created_at limit 1),
    'unseen', (select count(*) from public.team_notes n where n.created_by = auth.uid() and n.company_id = public.current_company() and not n.seen),
    'new', case when public.is_owner(public.current_company()) then
      (select count(*) from public.team_notes n where n.company_id = public.current_company() and n.status = 'new') end)
$$;
revoke execute on function public.help_counts() from public, anon;
grant execute on function public.help_counts() to authenticated;

-- The sender has read the replies on their notes.
create function public.mark_team_notes_seen() returns void
language sql security definer set search_path = '' as $$
  update public.team_notes set seen = true where created_by = auth.uid() and not seen
$$;
revoke execute on function public.mark_team_notes_seen() from public, anon;
grant execute on function public.mark_team_notes_seen() to authenticated;

-- ---------------------------------------------------------------- the owner decides
-- Sets the outcome and, optionally, a reply the sender sees. A blank reply keeps the one already there.
create function public.decide_team_note(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note public.team_notes%rowtype;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  select * into v_note from public.team_notes where id = p_id;
  if v_note.id is null or v_note.company_id is distinct from public.current_company() or not public.is_owner(v_note.company_id) then
    raise exception 'Only the owner can answer team notes.';
  end if;
  if p_status is null or p_status not in ('new', 'planned', 'later', 'done', 'declined') then
    raise exception 'Pick an outcome.';
  end if;
  if length(v_reply) > 4000 then
    raise exception 'Keep the reply under 4000 letters.';
  end if;
  update public.team_notes set
    status = p_status,
    decided_by = case when p_status = 'new' then null else auth.uid() end,
    decided_at = case when p_status = 'new' then null else now() end,
    reply = coalesce(v_reply, reply),
    replied_by = case when v_reply is not null then public.person_name(auth.uid()) else replied_by end,
    replied_at = case when v_reply is not null then now() else replied_at end,
    -- The sender's own notes never wait on themselves.
    seen = (created_by = auth.uid()) or (seen and v_reply is null and p_status = status)
  where id = p_id;
end $$;
revoke execute on function public.decide_team_note(uuid, text, text) from public, anon;
grant execute on function public.decide_team_note(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- questions asked
create function public.log_help_ask(p_question text, p_page text, p_topic text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_id uuid;
begin
  if v_company is null or public.my_role(v_company) is null then
    raise exception 'Sign in to use Help.';
  end if;
  if length(btrim(coalesce(p_question, ''))) = 0 then
    return null;
  end if;
  if (select count(*) from public.help_asks where asked_by = auth.uid() and created_at > now() - interval '1 day') >= 300 then
    return null;
  end if;
  insert into public.help_asks (company_id, asked_by, question, page, topic)
  values (v_company, auth.uid(), left(btrim(p_question), 500), left(nullif(btrim(p_page), ''), 300), left(nullif(btrim(p_topic), ''), 80))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.log_help_ask(text, text, text) from public, anon;
grant execute on function public.log_help_ask(text, text, text) to authenticated;

create function public.rate_help_ask(p_id uuid, p_helpful boolean) returns void
language sql security definer set search_path = '' as $$
  update public.help_asks set helpful = p_helpful where id = p_id and asked_by = auth.uid()
$$;
revoke execute on function public.rate_help_ask(uuid, boolean) from public, anon;
grant execute on function public.rate_help_ask(uuid, boolean) to authenticated;

-- Questions of the last 30 days, for the owner: what people look for, and what the guide didn't answer.
create function public.help_asks_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_owner(public.current_company()) then coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select a.id, a.question, a.page, a.topic, a.helpful, a.created_at, public.help_sender_label(a.company_id, a.asked_by) as sender
      from public.help_asks a
      where a.company_id = public.current_company() and a.created_at > now() - interval '30 days'
      order by a.created_at desc limit 300) x), '[]'::jsonb) end
$$;
revoke execute on function public.help_asks_list() from public, anon;
grant execute on function public.help_asks_list() to authenticated;

-- ---------------------------------------------------------------- screenshots
-- A note's photos live at <company>/help/<sender>/<file>.jpg. The sender uploads into their own folder;
-- only the sender and the owner can open them (the "order photos read" rule uses can_read_order_file).
-- Factory and buyer logins may upload and read their own here too.
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[2] = 'help' then
    return array_length(v_parts, 1) = 4 and v_parts[3] = auth.uid()::text and public.my_role(v_company) is not null;
  end if;
  if v_parts[3] = 'qc' then
    return public.is_quality(v_company);
  end if;
  if v_parts[3] = 'factory' then
    return array_length(v_parts, 1) = 5 and public.factory_owns_line(v_company, v_parts[2]::uuid, v_parts[4]::uuid);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;

create or replace function public.can_read_order_file(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if v_parts[2] = 'help' then
    return public.my_role(v_parts[1]::uuid) is not null and (v_parts[3] = auth.uid()::text or public.is_owner(v_parts[1]::uuid));
  end if;
  if not public.is_member(v_parts[1]::uuid) then
    return false;
  end if;
  return v_parts[3] is distinct from 'dispatch' or public.can_edit_orders(v_parts[1]::uuid);
exception when invalid_text_representation then
  return false;
end $$;

-- ---------------------------------------------------------------- morning brief
-- The owner's brief lists notes still waiting for a decision. The brief itself stays in brief_data_base
-- (0033, changed in 0039); brief_data_for adds the notes on top, so brief_data() and the 9 am email get them too.
alter function public.brief_data_for(uuid) rename to brief_data_base;

create function public.brief_data_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_base jsonb := public.brief_data_base(p_user);
begin
  select p.current_company_id into v_company from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is distinct from 'owner' then
    return v_base;
  end if;
  return v_base || jsonb_build_object('team_notes', coalesce((
    select jsonb_agg(jsonb_build_object('no', n.no, 'kind', n.kind, 'body', left(n.body, 160), 'by', public.help_sender_label(n.company_id, n.created_by),
                                        'at', n.created_at, 'suggestion', left(n.suggestion, 200)) order by n.created_at)
    from public.team_notes n where n.company_id = v_company and n.status = 'new'), '[]'::jsonb));
end $$;
revoke execute on function public.brief_data_for(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_for(uuid) to service_role;
revoke execute on function public.brief_data_base(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_base(uuid) to service_role;
