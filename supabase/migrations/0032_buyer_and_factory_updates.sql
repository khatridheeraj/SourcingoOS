-- Buyers and factories post and follow progress themselves (Dheeraj, 18 Oct 2026: "Build both").
--  * A buyer login: a member with the buyer role, tied to one buyer. It sees nothing through the usual rules;
--    its page reads only its own orders through buyer_orders(): styles, steps, ship dates and final QC, with
--    no factories and no prices.
--  * A factory marks a step done from its phone with photos. The update waits for the orders team (or Quality)
--    to confirm it; confirming enters the done date as if they had typed it.

-- ---------------------------------------------------------------- the buyer role
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality', 'factory', 'buyer'));
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('owner', 'manager', 'merchandiser', 'accounts', 'quality', 'factory', 'buyer'));
alter table public.members add column buyer_id uuid,
  add constraint members_buyer_fk foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  add constraint members_buyer_set check (role <> 'buyer' or buyer_id is not null);
alter table public.invites add column buyer_id uuid,
  add constraint invites_buyer_fk foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  add constraint invites_buyer_set check (role <> 'buyer' or buyer_id is not null);

-- Company members are the staff; factory and buyer logins are not.
create or replace function public.is_member(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select coalesce(public.my_role(p_company) not in ('factory', 'buyer'), false) $$;

-- The buyer the signed-in buyer login belongs to.
create function public.my_buyer() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.buyer_id from public.members m
  where m.company_id = public.current_company() and m.user_id = auth.uid() and m.active and m.role = 'buyer'
$$;
revoke execute on function public.my_buyer() from public, anon;
grant execute on function public.my_buyer() to authenticated;

create or replace function public.accept_invites(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (company_id, user_id, role, factory_id, buyer_id)
  select i.company_id, p_user, i.role, i.factory_id, i.buyer_id from public.invites i where i.email = lower(btrim(p_email)) and i.closed_at is null
  on conflict (company_id, user_id) do nothing;
  update public.invites set closed_at = now() where email = lower(btrim(p_email)) and closed_at is null;
  update public.profiles set current_company_id = (
    select company_id from public.members where user_id = p_user and active order by created_at limit 1)
  where id = p_user and current_company_id is null;
end $$;

-- The owner adds a buyer login by email, for one of the company's buyers.
create function public.add_buyer_member(p_email text, p_buyer uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if not public.is_owner(v_company) then
    raise exception 'Only the owner can add people.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.';
  end if;
  if not exists (select 1 from public.buyers where id = p_buyer and company_id = v_company) then
    raise exception 'Pick one of your buyers.';
  end if;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is null then
    insert into public.invites (company_id, email, role, buyer_id, created_by) values (v_company, v_email, 'buyer', p_buyer, auth.uid())
    on conflict (company_id, email) do update set role = 'buyer', factory_id = null, buyer_id = excluded.buyer_id, created_by = excluded.created_by, closed_at = null;
    return 'invited';
  end if;
  if exists (select 1 from public.members where company_id = v_company and user_id = v_user and role <> 'buyer') then
    raise exception 'That person already has another login here. Use a separate email for the buyer login.';
  end if;
  insert into public.members (company_id, user_id, role, buyer_id) values (v_company, v_user, 'buyer', p_buyer)
  on conflict (company_id, user_id) do update set buyer_id = excluded.buyer_id, active = true;
  update public.profiles set current_company_id = v_company where id = v_user and current_company_id is null;
  return 'added';
end $$;
revoke execute on function public.add_buyer_member(text, uuid) from public, anon;
grant execute on function public.add_buyer_member(text, uuid) to authenticated;

-- Factory and buyer logins stay what they are; staff roles switch only among staff roles.
create or replace function public.check_member_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role is distinct from new.role and (old.role in ('factory', 'buyer') or new.role in ('factory', 'buyer')) then
    raise exception 'A % login stays a % login. Add the person again with the right role.',
      case when 'buyer' in (old.role, new.role) then 'buyer' else 'factory' end, case when 'buyer' in (old.role, new.role) then 'buyer' else 'factory' end;
  end if;
  return new;
end $$;

-- A buyer login sees its own orders' styles (style_steps follows this).
create or replace function public.can_see_line(p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.order_lines l where l.id = p_line
                 and (public.is_member(l.company_id)
                      or (l.company_id = public.current_company() and l.factory_id = public.my_factory())
                      or (l.company_id = public.current_company() and exists (
                            select 1 from public.orders o where o.id = l.order_id and o.buyer_id = public.my_buyer()))))
$$;

-- Everything a buyer login shows: its open and recently shipped orders, each style's steps and its latest final QC
-- with photos. No factories, no prices, no factory dates, no notes from inside the team.
create function public.buyer_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return jsonb_build_object(
    'buyer', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = v_buyer), (select code from public.buyers where id = v_buyer)),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'po_date', o.po_date, 'status', o.status,
        'ship_date', o.ship_date, 'revised_ship_date', o.revised_ship_date,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'style', l.style, 'colour', l.colour, 'description', l.description, 'qty', l.qty, 'photo_path', l.photo_path,
            'steps', (select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'label', s.label, 'planned_on', s.planned_on, 'done_on', s.done_on)
                        order by s.pos), '[]'::jsonb) from public.style_steps(l.id) s),
            'final_qc', (select jsonb_build_object('result', q.result, 'checked_on', q.checked_on, 'pieces_checked', q.pieces_checked,
                           'photos', (select coalesce(jsonb_agg(p.path order by p.created_at), '[]'::jsonb) from public.qc_photos p
                                      where p.qc_id = q.id and p.kind = 'photo' and p.removed_at is null))
                         from public.qc_checks q where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                         order by q.checked_on desc, q.created_at desc limit 1))
          order by l.position), '[]'::jsonb)
          from public.order_lines l where l.order_id = o.id and l.removed_at is null))
        order by o.status <> 'open', coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
      from public.orders o
      where o.company_id = public.current_company() and o.buyer_id = v_buyer
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
    ), '[]'::jsonb));
end $$;
revoke execute on function public.buyer_orders() from public, anon;
grant execute on function public.buyer_orders() to authenticated;

-- ---------------------------------------------------------------- step updates from factories
create table public.step_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  factory_id uuid not null,
  stage text not null,
  done_on date not null,
  note text check (length(note) <= 500),
  photos text[] not null default '{}' check (cardinality(photos) between 1 and 10),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 300),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
-- One open update per step of a style: sending again replaces the waiting one.
create unique index step_updates_pending_key on public.step_updates (line_id, stage) where status = 'pending';
create index step_updates_order_idx on public.step_updates (order_id, created_at desc);
alter table public.step_updates enable row level security;
-- The team reads them; nobody writes them directly (only through the functions below).
create policy step_updates_read on public.step_updates for select to authenticated using (public.is_member(company_id));
grant select on public.step_updates to authenticated;

-- A factory's photo for a step goes under <company>/<order>/factory/<line>/ and only for its own released styles.
create function public.factory_owns_line(p_company uuid, p_order uuid, p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.order_lines l
    join public.orders o on o.id = l.order_id and o.status = 'open'
    join public.factory_pos f on f.order_id = l.order_id and f.factory_id = l.factory_id and f.released_at is not null
    where l.id = p_line and l.order_id = p_order and l.company_id = p_company and l.removed_at is null
      and l.company_id = public.current_company() and l.factory_id = public.my_factory())
$$;
revoke execute on function public.factory_owns_line(uuid, uuid, uuid) from public, anon;
grant execute on function public.factory_owns_line(uuid, uuid, uuid) to authenticated;

create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
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

-- A buyer login may open the style photos and QC photos of its own orders (the paths buyer_orders gives it).
create function public.buyer_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null or v_parts[3] not in ('qc', 'styles') then
    return false;
  end if;
  return exists (select 1 from public.orders o where o.id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
                 and o.company_id = public.current_company() and o.buyer_id = v_buyer);
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.buyer_can_read_photo(text) from public, anon;
grant execute on function public.buyer_can_read_photo(text) to authenticated;

-- A factory login may open the photos it sent for its own styles (<company>/<order>/factory/<line>/...).
create function public.factory_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if v_parts[3] <> 'factory' or public.my_factory() is null then
    return false;
  end if;
  return exists (select 1 from public.order_lines l where l.id = v_parts[4]::uuid and l.order_id = v_parts[2]::uuid
                 and l.company_id = v_parts[1]::uuid and l.company_id = public.current_company() and l.factory_id = public.my_factory());
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.factory_can_read_photo(text) from public, anon;
grant execute on function public.factory_can_read_photo(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$create policy "order photos buyer read" on storage.objects for select to authenticated
      using (bucket_id = 'order-photos' and public.buyer_can_read_photo(name))$p$;
    execute $p$create policy "order photos factory read" on storage.objects for select to authenticated
      using (bucket_id = 'order-photos' and public.factory_can_read_photo(name))$p$;
  end if;
end $$;

-- The factory says a step is done, with photos. It waits for the team to confirm.
create function public.post_step_update(p_line uuid, p_stage text, p_done_on date, p_note text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_line public.order_lines%rowtype;
  v_id uuid;
begin
  select * into v_line from public.order_lines where id = p_line;
  if v_line.id is null or not public.factory_owns_line(v_line.company_id, v_line.order_id, p_line) then
    raise exception 'You can update only your own styles on a released PO.';
  end if;
  if not exists (select 1 from public.style_steps(p_line) s where s.stage = p_stage) then
    raise exception 'That step is not on this style.';
  end if;
  if exists (select 1 from public.line_stages s where s.line_id = p_line and s.stage = p_stage and s.done_on is not null) then
    raise exception 'That step is already marked done.';
  end if;
  if p_done_on is null or p_done_on > public.india_today() or p_done_on < public.india_today() - 30 then
    raise exception 'Give the date the step was done: today or in the last 30 days.';
  end if;
  if coalesce(cardinality(p_photos), 0) = 0 then
    raise exception 'Add at least one photo of the work.';
  end if;
  if cardinality(p_photos) > 10 then
    raise exception 'Send at most 10 photos.';
  end if;
  if exists (select 1 from unnest(p_photos) p where p not like v_line.company_id || '/' || v_line.order_id || '/factory/' || p_line || '/%') then
    raise exception 'Those photos are not from this style.';
  end if;
  update public.step_updates set done_on = p_done_on, note = nullif(btrim(p_note), ''), photos = p_photos, created_by = auth.uid(), created_at = now()
  where line_id = p_line and stage = p_stage and status = 'pending'
  returning id into v_id;
  if v_id is null then
    insert into public.step_updates (company_id, order_id, line_id, factory_id, stage, done_on, note, photos)
    values (v_line.company_id, v_line.order_id, p_line, v_line.factory_id, p_stage, p_done_on, nullif(btrim(p_note), ''), p_photos)
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.post_step_update(uuid, text, date, text, text[]) from public, anon;
grant execute on function public.post_step_update(uuid, text, date, text, text[]) to authenticated;

-- The factory's own updates of the last 60 days, for its panel.
create function public.factory_step_updates() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'order_id', u.order_id, 'line_id', u.line_id, 'stage', u.stage, 'done_on', u.done_on,
      'status', u.status, 'review_note', u.review_note, 'photos', cardinality(u.photos), 'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
  from public.step_updates u
  where u.company_id = public.current_company() and u.factory_id = public.my_factory() and u.created_at > now() - interval '60 days'
$$;
revoke execute on function public.factory_step_updates() from public, anon;
grant execute on function public.factory_step_updates() to authenticated;

-- The orders team or Quality confirms an update (the step's done date is entered) or sends it back with a reason.
-- The step's own rules on done dates still check the person confirming (they follow the signed-in person).
create function public.review_step_update(p_id uuid, p_confirm boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_u public.step_updates%rowtype;
begin
  select * into v_u from public.step_updates where id = p_id for update;
  if v_u.id is null or not (public.can_edit_orders(v_u.company_id) or public.is_quality(v_u.company_id)) then
    raise exception 'Only the orders team and Quality confirm factory updates.';
  end if;
  if v_u.status <> 'pending' then
    raise exception 'This update was already answered. Reload the page.';
  end if;
  if p_confirm then
    update public.line_stages set done_on = v_u.done_on where line_id = v_u.line_id and stage = v_u.stage and done_on is null;
    if not found then
      insert into public.line_stages (company_id, order_id, line_id, stage, done_on)
      select v_u.company_id, v_u.order_id, v_u.line_id, v_u.stage, v_u.done_on
      where not exists (select 1 from public.line_stages where line_id = v_u.line_id and stage = v_u.stage);
    end if;
  elsif nullif(btrim(p_note), '') is null then
    raise exception 'Say why, so the factory knows what to fix.';
  end if;
  update public.step_updates set status = case when p_confirm then 'confirmed' else 'declined' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_id;
end $$;
revoke execute on function public.review_step_update(uuid, boolean, text) from public, anon;
grant execute on function public.review_step_update(uuid, boolean, text) to authenticated;
