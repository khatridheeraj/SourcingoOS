-- The team talks about an order inside the app (Dheeraj, 10 Nov 2026: "complete the team panels").
-- Anyone on the team writes a note on an order, tags colleagues and adds photos. A tagged person sees the note
-- on Home until they reply on that order or tap Done. Notes are never changed or deleted: a newer note says what changed.

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  body text not null check (btrim(body) <> '' and length(body) <= 2000),
  -- The people tagged in the note.
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  -- Tagged people who have dealt with it (replied on the order or tapped Done).
  done_by uuid[] not null default '{}',
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index order_notes_order_idx on public.order_notes (order_id, created_at);
create index order_notes_mentions_idx on public.order_notes using gin (mentions);

alter table public.order_notes enable row level security;
revoke all on public.order_notes from anon, authenticated;
-- The team reads them; they are written only through post_order_note and clear_mentions below.
grant select on public.order_notes to authenticated;
create policy order_notes_read on public.order_notes for select to authenticated using (public.is_member(company_id));

-- Writes one note. Tagged people must be active team members (not factory or buyer logins); photos must sit in the
-- order's own notes folder. Writing on an order also clears the writer's own open tags there: replying is dealing with it.
create or replace function public.post_order_note(p_id uuid, p_order uuid, p_body text, p_mentions uuid[], p_photos text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_body text := btrim(coalesce(p_body, ''));
  v_mentions uuid[] := array(select distinct m from unnest(coalesce(p_mentions, '{}')) m where m is distinct from auth.uid());
  v_photos text[] := coalesce(p_photos, '{}');
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null or not public.is_member(v_company) then
    raise exception 'Only the team can write notes on an order.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company and removed_at is null) then
    raise exception 'That order is not here any more. Reload the page.';
  end if;
  if v_body = '' then
    raise exception 'Write the note first.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Keep the note under 2,000 characters.';
  end if;
  if exists (select 1 from unnest(v_mentions) m where not exists (
      select 1 from public.members x where x.company_id = v_company and x.user_id = m and x.active and x.role not in ('factory', 'buyer'))) then
    raise exception 'You can only tag people on the team.';
  end if;
  if exists (select 1 from unnest(v_photos) p where p not like v_company::text || '/' || p_order::text || '/notes/' || v_id::text || '/%') then
    raise exception 'Those photos belong to another note. Pick them again.';
  end if;
  insert into public.order_notes (id, company_id, order_id, body, mentions, photos)
  values (v_id, v_company, p_order, v_body, v_mentions, v_photos);
  update public.order_notes set done_by = done_by || auth.uid()
  where order_id = p_order and id <> v_id and auth.uid() = any (mentions) and not (auth.uid() = any (done_by));
  return v_id;
end $$;
revoke execute on function public.post_order_note(uuid, uuid, text, uuid[], text[]) from public, anon;
grant execute on function public.post_order_note(uuid, uuid, text, uuid[], text[]) to authenticated;

-- Marks the signed-in person's tags as dealt with: one note, or every note on an order.
create or replace function public.clear_mentions(p_order uuid, p_note uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not public.is_member(public.current_company()) then
    raise exception 'Only the team can do that.';
  end if;
  update public.order_notes set done_by = done_by || auth.uid()
  where company_id = public.current_company() and order_id = p_order and (p_note is null or id = p_note)
    and auth.uid() = any (mentions) and not (auth.uid() = any (done_by));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.clear_mentions(uuid, uuid) from public, anon;
grant execute on function public.clear_mentions(uuid, uuid) to authenticated;

-- Photos on a note: <company>/<order>/notes/<note>/<photo>, uploaded by anyone on the team (Quality too).
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
  if v_parts[3] = 'visits' then
    return array_length(v_parts, 1) = 5 and (public.is_quality(v_company) or public.can_edit_orders(v_company));
  end if;
  if v_parts[3] = 'factory' then
    return array_length(v_parts, 1) = 5 and public.factory_owns_line(v_company, v_parts[2]::uuid, v_parts[4]::uuid);
  end if;
  if v_parts[3] = 'samples' then
    return array_length(v_parts, 1) = 5 and (public.can_edit_orders(v_company) or public.buyer_owns_order(v_company, v_parts[2]::uuid));
  end if;
  if v_parts[3] = 'notes' then
    return array_length(v_parts, 1) = 5 and public.is_member(v_company);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;
