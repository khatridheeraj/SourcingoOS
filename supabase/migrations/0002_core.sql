-- Version 1 of the fresh app: companies, people, buyers, factories and orders,
-- with a permanent history of every change. Nothing else.
-- Nothing is ever deleted: orders are cancelled, buyers and factories switched off,
-- removed styles and used invites are marked, and the history keeps every step.
-- (On the live database this file was applied in parts: 0002a to 0002d.)

-- ---------------------------------------------------------------- companies and people
-- Every record belongs to a company, so one system can serve more than one business.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  next_order_no integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  current_company_id uuid references public.companies (id),
  created_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

create table public.members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'merchandiser', 'accounts')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index members_user_idx on public.members (user_id);

-- People the owner has added by email. An invite is closed once it is used or cancelled.
create table public.invites (
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null check (role in ('owner', 'manager', 'merchandiser', 'accounts')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  primary key (company_id, email)
);

-- The company the signed-in person is working in.
create function public.current_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.current_company_id from public.profiles p
  join public.members m on m.company_id = p.current_company_id and m.user_id = p.id and m.active
  where p.id = auth.uid()
$$;

-- The signed-in person's role in a company, or null when they are not an active member.
create function public.my_role(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.members where company_id = p_company and user_id = auth.uid() and active
$$;

create function public.is_member(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select public.my_role(p_company) is not null $$;

create function public.is_owner(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select public.my_role(p_company) = 'owner' $$;

-- Turns waiting invites for this person's email into memberships.
create function public.accept_invites(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (company_id, user_id, role)
  select i.company_id, p_user, i.role from public.invites i where i.email = lower(btrim(p_email)) and i.closed_at is null
  on conflict (company_id, user_id) do nothing;
  update public.invites set closed_at = now() where email = lower(btrim(p_email)) and closed_at is null;
  update public.profiles set current_company_id = (
    select company_id from public.members where user_id = p_user and active order by created_at limit 1)
  where id = p_user and current_company_id is null;
end $$;

-- Everyone who signs in gets a profile; if the owner already added their email, they are in.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  perform public.accept_invites(new.id, coalesce(new.email, ''));
  return new;
end $$;

create or replace trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- The owner adds someone by email. If they have signed in before they are in at once; otherwise on first sign-in.
create function public.add_member(p_email text, p_role text) returns text
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
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is null then
    insert into public.invites (company_id, email, role, created_by) values (v_company, v_email, p_role, auth.uid())
    on conflict (company_id, email) do update set role = excluded.role, created_by = excluded.created_by, closed_at = null;
    return 'invited';
  end if;
  insert into public.members (company_id, user_id, role) values (v_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role, active = true;
  update public.profiles set current_company_id = v_company where id = v_user and current_company_id is null;
  return 'added';
end $$;

-- A company always keeps at least one active owner.
create function public.protect_last_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or not (new.role = 'owner' and new.active))
     and not exists (select 1 from public.members
                     where company_id = old.company_id and user_id <> old.user_id and role = 'owner' and active) then
    raise exception 'There must always be one active owner.';
  end if;
  return coalesce(new, old);
end $$;

create trigger members_protect_last_owner before update or delete on public.members
  for each row execute function public.protect_last_owner();

-- ---------------------------------------------------------------- buyers
-- Staff only ever see the buyer's code. The real name lives in buyer_names, which only the owner can read.
create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  code text not null check (code ~ '^[A-Z0-9-]{2,20}$'),
  city text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index buyers_code_key on public.buyers (company_id, code);
create unique index buyers_company_id_key on public.buyers (company_id, id);

create table public.buyer_names (
  buyer_id uuid primary key references public.buyers (id) on delete cascade,
  company_id uuid not null default public.current_company() references public.companies (id),
  real_name text not null check (btrim(real_name) <> ''),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
create unique index buyer_names_name_key on public.buyer_names (company_id, lower(btrim(real_name)));

-- ---------------------------------------------------------------- factories
create table public.factories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  name text not null check (btrim(name) <> ''),
  city text,
  contact_name text,
  phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index factories_name_key on public.factories (company_id, lower(btrim(name)));
create unique index factories_company_id_key on public.factories (company_id, id);

-- ---------------------------------------------------------------- orders
-- One order per buyer PO. Each line is one style (and colour) with its own factory,
-- so a PO split across factories is still one order, never a copy.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_no text not null,
  buyer_id uuid not null,
  buyer_po text not null check (btrim(buyer_po) <> ''),
  po_date date,
  ship_date date,
  status text not null default 'open' check (status in ('open', 'shipped', 'cancelled')),
  merchandiser_id uuid references public.profiles (id),
  notes text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
create unique index orders_order_no_key on public.orders (company_id, order_no);
create unique index orders_buyer_po_key on public.orders (company_id, buyer_id, lower(btrim(buyer_po)));
create unique index orders_company_id_key on public.orders (company_id, id);
create index orders_status_idx on public.orders (company_id, status, ship_date);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  position integer not null default 1,
  style text not null check (btrim(style) <> ''),
  description text,
  colour text,
  qty integer not null check (qty > 0),
  buyer_rate numeric(12, 2) check (buyer_rate >= 0),
  factory_id uuid,
  factory_rate numeric(12, 2) check (factory_rate >= 0),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  foreign key (company_id, order_id) references public.orders (company_id, id) on delete cascade,
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create unique index order_lines_style_key on public.order_lines (order_id, lower(btrim(style)), lower(btrim(coalesce(colour, ''))))
  where removed_at is null;
create index order_lines_order_idx on public.order_lines (order_id, position);
create index order_lines_factory_idx on public.order_lines (factory_id);

-- Order numbers run per company: SO-0001, SO-0002, ...
create function public.number_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.companies set next_order_no = next_order_no + 1 where id = new.company_id
  returning next_order_no - 1 into v_n;
  new.order_no := 'SO-' || lpad(v_n::text, 4, '0');
  return new;
end $$;

create trigger orders_number before insert on public.orders
  for each row when (new.order_no is null) execute function public.number_order();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- history
-- Every add, change and delete, with who and when and the values before and after. Nobody can edit it.
create table public.history (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor uuid default auth.uid(),
  at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
create index history_row_idx on public.history (company_id, table_name, row_id, at desc);

create function public.record_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return new;
  end if;
  insert into public.history (company_id, table_name, row_id, action, before, after)
  values (
    (v_row ->> 'company_id')::uuid, tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'buyer_id', v_row ->> 'user_id', v_row ->> 'email'),
    lower(tg_op), v_old, v_new);
  return coalesce(new, old);
end $$;

create trigger buyers_history after insert or update or delete on public.buyers for each row execute function public.record_history();
create trigger buyer_names_history after insert or update or delete on public.buyer_names for each row execute function public.record_history();
create trigger factories_history after insert or update or delete on public.factories for each row execute function public.record_history();
create trigger orders_history after insert or update or delete on public.orders for each row execute function public.record_history();
create trigger order_lines_history after insert or update or delete on public.order_lines for each row execute function public.record_history();
create trigger members_history after insert or update or delete on public.members for each row execute function public.record_history();
create trigger invites_history after insert or update or delete on public.invites for each row execute function public.record_history();

-- ---------------------------------------------------------------- saving an order
-- Saves an order and all of its lines in one step, so an order is never left half-saved.
-- p_order: {id?, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes}
-- p_lines: [{id?, style, description, colour, qty, buyer_rate, factory_id, factory_rate}, ...] in display order.
-- Lines with an id are updated, new ones added, and lines left out marked removed.
-- Runs with the caller's own rights, so the access rules below still apply.
create function public.save_order(p_order jsonb, p_lines jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
  v_n integer;
  l record;
begin
  if not public.is_member(public.current_company()) then
    raise exception 'Your account is not switched on yet.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one style.';
  end if;

  if v_id is null then
    insert into public.orders (buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes)
    values (
      (p_order ->> 'buyer_id')::uuid, btrim(p_order ->> 'buyer_po'),
      nullif(p_order ->> 'po_date', '')::date, nullif(p_order ->> 'ship_date', '')::date,
      coalesce(nullif(p_order ->> 'status', ''), 'open'),
      nullif(p_order ->> 'merchandiser_id', '')::uuid, nullif(btrim(p_order ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.orders set
      buyer_id = (p_order ->> 'buyer_id')::uuid,
      buyer_po = btrim(p_order ->> 'buyer_po'),
      po_date = nullif(p_order ->> 'po_date', '')::date,
      ship_date = nullif(p_order ->> 'ship_date', '')::date,
      status = coalesce(nullif(p_order ->> 'status', ''), 'open'),
      merchandiser_id = nullif(p_order ->> 'merchandiser_id', '')::uuid,
      notes = nullif(btrim(p_order ->> 'notes'), '')
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'That order no longer exists.';
    end if;
    update public.order_lines set removed_at = now()
    where order_id = v_id and removed_at is null
      and id::text not in (select coalesce(x ->> 'id', '') from jsonb_array_elements(p_lines) x);
  end if;

  for l in select t.j, t.n from jsonb_array_elements(p_lines) with ordinality as t (j, n) loop
    if nullif(l.j ->> 'id', '') is not null then
      update public.order_lines set
        position = l.n, style = btrim(l.j ->> 'style'), description = nullif(btrim(l.j ->> 'description'), ''),
        colour = nullif(btrim(l.j ->> 'colour'), ''), qty = (l.j ->> 'qty')::integer,
        buyer_rate = nullif(l.j ->> 'buyer_rate', '')::numeric, factory_id = nullif(l.j ->> 'factory_id', '')::uuid,
        factory_rate = nullif(l.j ->> 'factory_rate', '')::numeric
      where id = (l.j ->> 'id')::uuid and order_id = v_id and removed_at is null;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'A style on this order was changed by someone else. Reload the page and try again.';
      end if;
    else
      insert into public.order_lines (order_id, position, style, description, colour, qty, buyer_rate, factory_id, factory_rate)
      values (v_id, l.n, btrim(l.j ->> 'style'), nullif(btrim(l.j ->> 'description'), ''), nullif(btrim(l.j ->> 'colour'), ''),
              (l.j ->> 'qty')::integer, nullif(l.j ->> 'buyer_rate', '')::numeric,
              nullif(l.j ->> 'factory_id', '')::uuid, nullif(l.j ->> 'factory_rate', '')::numeric);
    end if;
  end loop;

  return v_id;
end $$;

-- ---------------------------------------------------------------- saving a buyer
-- Saves the buyer's code and real name together, so a buyer is never left without its name.
-- p: {id?, code, real_name, city, notes, active}
create function public.save_buyer(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_n integer;
begin
  if v_id is null then
    insert into public.buyers (code, city, notes, active)
    values (p ->> 'code', nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'notes'), ''), coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update public.buyers set
      code = p ->> 'code', city = nullif(btrim(p ->> 'city'), ''), notes = nullif(btrim(p ->> 'notes'), ''),
      active = coalesce((p ->> 'active')::boolean, true)
    where id = v_id and company_id = public.current_company();
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'That buyer no longer exists.';
    end if;
  end if;
  insert into public.buyer_names (buyer_id, real_name) values (v_id, btrim(p ->> 'real_name'))
  on conflict (buyer_id) do update set real_name = excluded.real_name;
  return v_id;
end $$;

-- ---------------------------------------------------------------- access
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.buyers enable row level security;
alter table public.buyer_names enable row level security;
alter table public.factories enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.history enable row level security;

revoke all on public.companies, public.profiles, public.members, public.invites, public.buyers, public.buyer_names,
  public.factories, public.orders, public.order_lines, public.history from anon, authenticated;
grant select on public.companies, public.history to authenticated;
grant select on public.profiles, public.members to authenticated;
grant update (full_name, current_company_id) on public.profiles to authenticated;
grant update (role, active) on public.members to authenticated;
grant select on public.invites to authenticated;
grant update (closed_at) on public.invites to authenticated;
grant select, insert, update on public.buyers, public.buyer_names, public.factories, public.orders, public.order_lines to authenticated;

create policy companies_read on public.companies for select to authenticated using (public.is_member(id));

-- People: you see yourself and the people in your companies; you can rename yourself and switch company.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.members m where m.user_id = profiles.id and public.is_member(m.company_id)));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (current_company_id is null or public.is_member(current_company_id)));

create policy members_read on public.members for select to authenticated using (user_id = auth.uid() or public.is_member(company_id));
create policy members_owner_update on public.members for update to authenticated
  using (public.is_owner(company_id)) with check (public.is_owner(company_id));
create policy invites_owner on public.invites for select to authenticated using (public.is_owner(company_id));
create policy invites_owner_close on public.invites for update to authenticated
  using (public.is_owner(company_id)) with check (public.is_owner(company_id));

-- Buyers: members read codes; only the owner adds or changes buyers and sees real names.
create policy buyers_read on public.buyers for select to authenticated using (public.is_member(company_id));
create policy buyers_owner_insert on public.buyers for insert to authenticated with check (public.is_owner(company_id));
create policy buyers_owner_update on public.buyers for update to authenticated using (public.is_owner(company_id)) with check (public.is_owner(company_id));
create policy buyer_names_owner_read on public.buyer_names for select to authenticated using (public.is_owner(company_id));
create policy buyer_names_owner_insert on public.buyer_names for insert to authenticated with check (public.is_owner(company_id));
create policy buyer_names_owner_update on public.buyer_names for update to authenticated
  using (public.is_owner(company_id)) with check (public.is_owner(company_id));

-- Factories, orders and lines: members read, add and edit. Nobody deletes.
create policy factories_read on public.factories for select to authenticated using (public.is_member(company_id));
create policy factories_insert on public.factories for insert to authenticated with check (public.is_member(company_id));
create policy factories_update on public.factories for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

create policy orders_read on public.orders for select to authenticated using (public.is_member(company_id));
create policy orders_insert on public.orders for insert to authenticated with check (public.is_member(company_id));
create policy orders_update on public.orders for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

create policy order_lines_read on public.order_lines for select to authenticated using (public.is_member(company_id));
create policy order_lines_insert on public.order_lines for insert to authenticated with check (public.is_member(company_id));
create policy order_lines_update on public.order_lines for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));

-- History: the owner reads everything; others read everything except buyers' real names.
create policy history_read on public.history for select to authenticated
  using (public.is_owner(company_id) or (public.is_member(company_id) and table_name <> 'buyer_names'));

revoke execute on function public.handle_new_user(), public.accept_invites(uuid, text), public.number_order(),
  public.record_history(), public.protect_last_owner(), public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.save_order(jsonb, jsonb), public.save_buyer(jsonb), public.add_member(text, text) from public, anon;
grant execute on function public.save_order(jsonb, jsonb), public.save_buyer(jsonb), public.add_member(text, text) to authenticated;
revoke execute on function public.current_company(), public.my_role(uuid), public.is_member(uuid), public.is_owner(uuid) from public, anon;
grant execute on function public.current_company(), public.my_role(uuid), public.is_member(uuid), public.is_owner(uuid) to authenticated;

-- ---------------------------------------------------------------- Sourcingo
-- The first company. Whoever was the owner in the old app is its owner.
do $$
declare
  v_company uuid;
begin
  insert into public.companies (name) values ('Sourcingo') returning id into v_company;

  insert into public.profiles (id, email)
  select u.id, coalesce(u.email, '') from auth.users u
  on conflict (id) do nothing;

  if to_regclass('old_app.profiles') is not null then
    update public.profiles p set full_name = o.full_name from old_app.profiles o where o.id = p.id;
    insert into public.members (company_id, user_id, role)
    select v_company, o.id, 'owner' from old_app.profiles o where o.role::text = 'owner' and o.active;
    update public.profiles set current_company_id = v_company
    where id in (select user_id from public.members where company_id = v_company);
  end if;
end $$;
