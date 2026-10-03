-- Sourcingo OS: core schema, role-based access and business rules.
-- Target: Supabase (Postgres 15+). Apply with `supabase db push` or the SQL editor.
--
-- Principles
--   * One row per real-world thing; documents get human ids (SO-000001, GRN-000001).
--   * Buyer real names live only in buyer_registry (owner-only).
--   * Factories and buyers never read base tables; they read portal_* views
--     that expose only their own rows and only permitted columns.
--   * A locked TNA can't be restructured. Factories change checkpoint status
--     only through set_checkpoint_status().
--   * Every change to business tables is written to audit_log (append-only).

-- ───────────────────────── enums ─────────────────────────
create type user_role       as enum ('owner','merchandiser','manager','qc','accounts','factory','buyer');
create type inquiry_status  as enum ('new','quoted','converted','lost');
create type so_status       as enum ('draft','tna_review','locked','shipped');
create type order_type      as enum ('garment','fabric');
create type tna_status      as enum ('pending','in_progress','completed','delayed');
create type grn_status      as enum ('draft','pending_approval','approved','rejected');
create type dc_status       as enum ('draft','dispatched');
create type goods_condition as enum ('good','damaged','short');
create type file_category   as enum ('inquiry_image','tech_pack','cutting_program','style_photo','grn_photo','qc_report','other');

create sequence inquiry_seq; create sequence so_seq; create sequence grn_seq; create sequence dc_seq; create sequence buyer_seq;

-- ───────────────────────── people & masters ─────────────────────────
create table factories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  city        text,
  contact     text,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table buyers (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,              -- BYR-AH-0001
  default_payment_terms text,
  default_address       text,
  created_at            timestamptz not null default now()
);

create table buyer_registry (                               -- owner-only: real names
  buyer_id   uuid primary key references buyers(id) on delete cascade,
  real_name  text not null unique
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        user_role,                                    -- null until the owner assigns one
  factory_id  uuid references factories(id),
  buyer_id    uuid references buyers(id),
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint factory_users_have_factory check (role is distinct from 'factory' or factory_id is not null),
  constraint buyer_users_have_buyer     check (role is distinct from 'buyer'   or buyer_id   is not null)
);

-- ───────────────────────── role helpers ─────────────────────────
create function my_role() returns user_role
  language sql stable security definer set search_path = public
  as $$ select role from profiles where id = auth.uid() and active $$;

create function is_owner() returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce(my_role() = 'owner', false) $$;

create function is_ops() returns boolean                    -- people who run orders
  language sql stable security definer set search_path = public
  as $$ select coalesce(my_role() in ('owner','merchandiser','manager','qc'), false) $$;

create function is_internal() returns boolean               -- ops + accounts
  language sql stable security definer set search_path = public
  as $$ select coalesce(my_role() in ('owner','merchandiser','manager','qc','accounts'), false) $$;

create function my_factory_id() returns uuid
  language sql stable security definer set search_path = public
  as $$ select factory_id from profiles where id = auth.uid() and active and role = 'factory' $$;

create function my_buyer_id() returns uuid
  language sql stable security definer set search_path = public
  as $$ select buyer_id from profiles where id = auth.uid() and active and role = 'buyer' $$;

-- ───────────────────────── sales ─────────────────────────
create table inquiries (
  id              text primary key default 'INQ-' || lpad(nextval('inquiry_seq')::text, 6, '0'),
  buyer_id        uuid not null references buyers(id),
  contact_person  text not null,
  contact_email   text not null,
  product_type    text not null,
  est_qty         numeric check (est_qty is null or est_qty >= 0),
  unit            text not null default 'pcs' check (unit in ('pcs','m')),
  budget_inr      numeric check (budget_inr is null or budget_inr >= 0),
  merchandiser_id uuid references profiles(id),
  status          inquiry_status not null default 'new',
  next_follow_up  date,
  notes           text,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table inquiry_followups (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  text not null references inquiries(id) on delete cascade,
  note        text not null,
  created_by  uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table sales_orders (
  id               text primary key default 'SO-' || lpad(nextval('so_seq')::text, 6, '0'),
  inquiry_id       text references inquiries(id),
  buyer_id         uuid not null references buyers(id),
  buyer_po_number  text not null,
  order_type       order_type not null default 'garment',
  currency         text not null default 'INR' check (currency in ('INR','USD','EUR','GBP')),
  so_date          date not null default current_date,
  order_source     text,
  tags             text[] not null default '{}',
  factory_id       uuid references factories(id),
  payment_terms    text,
  delivery_address text,
  merchandiser_id  uuid references profiles(id),
  manager_id       uuid references profiles(id),
  fabric_poc_id    uuid references profiles(id),
  quality_poc_id   uuid references profiles(id),
  buyer_date       date,
  factory_date     date,
  merch_date       date,
  remarks          text,
  terms            text,
  status           so_status not null default 'draft',
  locked_at        timestamptz,
  locked_by        uuid references profiles(id),
  created_by       uuid references profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint buyer_po_unique unique (buyer_id, buyer_po_number),
  constraint factory_before_buyer check (factory_date is null or buyer_date is null or factory_date <= buyer_date)
);
alter table inquiries add column so_id text references sales_orders(id);

create table so_styles (
  id            uuid primary key default gen_random_uuid(),
  so_id         text not null references sales_orders(id) on delete cascade,
  position      int  not null default 0,
  name          text not null default '',
  code          text not null default '',
  fabric        text not null default '',
  colour        text not null default '',
  use_sizes     boolean not null default true,
  sizes         jsonb not null default '{}'::jsonb,          -- {"S":120,"M":240,...}
  qty           numeric not null default 0 check (qty >= 0), -- total; equals sum(sizes) when use_sizes
  buyer_rate    numeric not null default 0 check (buyer_rate >= 0),   -- what the buyer pays Sourcingo
  factory_rate  numeric check (factory_rate is null or factory_rate >= 0), -- what Sourcingo pays the factory
  internal_note text
);

create table tna_checkpoints (
  id                uuid primary key default gen_random_uuid(),
  style_id          uuid not null references so_styles(id) on delete cascade,
  position          int  not null default 0,
  name              text not null,
  due_date          date,
  status            tna_status not null default 'pending',
  status_updated_at timestamptz,
  status_updated_by uuid references profiles(id)
);

create table tna_status_history (
  id             bigint generated always as identity primary key,
  checkpoint_id  uuid not null references tna_checkpoints(id) on delete cascade,
  from_status    tna_status,
  to_status      tna_status not null,
  changed_by     uuid references profiles(id),
  changed_at     timestamptz not null default now()
);

-- ───────────────────────── warehouse ─────────────────────────
create table grns (
  id           text primary key default 'GRN-' || lpad(nextval('grn_seq')::text, 6, '0'),
  so_id        text not null references sales_orders(id),
  received_at  timestamptz not null default now(),
  received_by  uuid references profiles(id),
  qc_checked   boolean not null default false,
  qc_note      text,
  notes        text,
  status       grn_status not null default 'draft',
  approved_by  uuid references profiles(id),
  approved_at  timestamptz,
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint received_not_future check (received_at <= now() + interval '5 minutes')
);

create table grn_lines (
  id         uuid primary key default gen_random_uuid(),
  grn_id     text not null references grns(id) on delete cascade,
  style_id   uuid not null references so_styles(id),
  qty        numeric not null check (qty > 0),
  condition  goods_condition not null default 'good',
  unique (grn_id, style_id)
);

create table delivery_challans (
  id             text primary key default 'DC-' || lpad(nextval('dc_seq')::text, 6, '0'),
  grn_id         text not null references grns(id),
  so_id          text not null references sales_orders(id),
  courier        text,
  tracking       text,
  address        text,
  invoice_no     text,
  invoice_date   date,
  status         dc_status not null default 'draft',
  dispatched_at  timestamptz,
  created_by     uuid references profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint dispatch_needs_details check (
    status = 'draft' or (courier <> '' and tracking <> '' and address <> '' and invoice_no <> '' and invoice_date is not null and dispatched_at is not null))
);

create table dc_lines (
  id        uuid primary key default gen_random_uuid(),
  dc_id     text not null references delivery_challans(id) on delete cascade,
  style_id  uuid not null references so_styles(id),
  qty       numeric not null check (qty > 0),
  unique (dc_id, style_id)
);

-- Files live in Supabase Storage; this table indexes them.
create table files (
  id            uuid primary key default gen_random_uuid(),
  category      file_category not null,
  inquiry_id    text references inquiries(id) on delete cascade,
  style_id      uuid references so_styles(id) on delete cascade,
  grn_id        text references grns(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null check (mime_type in ('image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes    bigint not null check (size_bytes <= 10 * 1024 * 1024),
  uploaded_by   uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint one_owner check (num_nonnulls(inquiry_id, style_id, grn_id) = 1)
);

-- ───────────────────────── audit trail (append-only) ─────────────────────────
create table audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  actor       uuid default auth.uid(),
  at          timestamptz not null default now()
);

create function write_audit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, row_id, action, old_data, new_data)
  values (tg_table_name,
          case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id') else (to_jsonb(new) ->> 'id') end,
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['factories','buyers','profiles','inquiries','sales_orders','so_styles','tna_checkpoints',
                           'grns','grn_lines','delivery_challans','dc_lines','files']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function write_audit()', t);
  end loop;
end $$;

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_inquiries    before update on inquiries    for each row execute function touch_updated_at();
create trigger touch_sales_orders before update on sales_orders for each row execute function touch_updated_at();

-- ───────────────────────── business rules ─────────────────────────
-- Sales order: once locked, only merch_date, remarks and status may change,
-- and only the owner moves status to/from locked.
create function guard_sales_order() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if (new.status = 'locked' or old.status = 'locked') and not is_owner() and new.status <> 'shipped' then
      raise exception 'Only the owner can lock or unlock a TNA.';
    end if;
    if old.status = 'locked' and new.status = 'tna_review'
       and exists (select 1 from grns where so_id = old.id and status <> 'rejected') then
      raise exception 'Goods have already been received on %, so its TNA cannot be unlocked.', old.id;
    end if;
  end if;
  if old.status in ('locked','shipped') and new.status in ('locked','shipped') then
    if (new.buyer_id, new.buyer_po_number, new.order_type, new.currency, new.factory_id, new.payment_terms,
        new.buyer_date, new.factory_date, new.inquiry_id)
       is distinct from
       (old.buyer_id, old.buyer_po_number, old.order_type, old.currency, old.factory_id, old.payment_terms,
        old.buyer_date, old.factory_date, old.inquiry_id) then
      raise exception 'Sales order % is locked. Ask the owner to unlock it first.', old.id;
    end if;
  end if;
  return new;
end $$;
create trigger guard_sales_order before update on sales_orders for each row execute function guard_sales_order();

create function so_is_locked(p_so text) returns boolean
  language sql stable set search_path = public
  as $$ select exists (select 1 from sales_orders where id = p_so and status in ('locked','shipped')) $$;

-- Styles: no add/remove/edit on a locked order, except the internal note.
create function guard_style() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and so_is_locked(new.so_id) then
    raise exception 'Sales order % is locked. Styles cannot be added.', new.so_id;
  elsif tg_op = 'DELETE' and so_is_locked(old.so_id) then
    raise exception 'Sales order % is locked. Styles cannot be removed.', old.so_id;
  elsif tg_op = 'UPDATE' and so_is_locked(old.so_id) and
        (new.so_id, new.position, new.name, new.code, new.fabric, new.colour, new.use_sizes, new.sizes, new.qty, new.buyer_rate, new.factory_rate)
        is distinct from
        (old.so_id, old.position, old.name, old.code, old.fabric, old.colour, old.use_sizes, old.sizes, old.qty, old.buyer_rate, old.factory_rate) then
    raise exception 'Sales order % is locked. Only the internal note can change.', old.so_id;
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_style before insert or update or delete on so_styles for each row execute function guard_style();

-- Checkpoints: structure frozen after lock; status changes go through set_checkpoint_status().
create function guard_checkpoint() returns trigger
  language plpgsql set search_path = public as $$
declare v_so text;
begin
  select so_id into v_so from so_styles where id = coalesce(new.style_id, old.style_id);
  if so_is_locked(v_so) then
    if tg_op <> 'UPDATE' or (new.style_id, new.position, new.name, new.due_date)
                            is distinct from (old.style_id, old.position, old.name, old.due_date) then
      raise exception 'The TNA for % is locked. Dates and checkpoints cannot change.', v_so;
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_checkpoint before insert or update or delete on tna_checkpoints for each row execute function guard_checkpoint();

-- Status updates by ops or by the order's own factory (after lock), with history.
create function set_checkpoint_status(p_checkpoint uuid, p_status tna_status) returns void
  language plpgsql security definer set search_path = public as $$
declare v_old tna_status; v_so text; v_factory uuid; v_so_status so_status;
begin
  select c.status, s.so_id, o.factory_id, o.status into v_old, v_so, v_factory, v_so_status
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where c.id = p_checkpoint;
  if not found then raise exception 'Checkpoint not found.'; end if;
  if v_so_status <> 'locked' then raise exception 'Status can only be updated after the TNA is locked.'; end if;
  if not (is_ops() or (my_role() = 'factory' and my_factory_id() = v_factory)) then
    raise exception 'You do not have access to this order.';
  end if;
  if v_old = p_status then return; end if;
  update tna_checkpoints set status = p_status, status_updated_at = now(), status_updated_by = auth.uid() where id = p_checkpoint;
  insert into tna_status_history (checkpoint_id, from_status, to_status, changed_by) values (p_checkpoint, v_old, p_status, auth.uid());
end $$;

-- Lock: owner only, full validation in one place.
create function lock_sales_order(p_so text) returns void
  language plpgsql security definer set search_path = public as $$
declare o sales_orders; v_bad text;
begin
  if not is_owner() then raise exception 'Only the owner can lock a TNA.'; end if;
  select * into o from sales_orders where id = p_so for update;
  if not found then raise exception 'Sales order % not found.', p_so; end if;
  if o.status <> 'tna_review' and o.status <> 'draft' then raise exception '% is already %.', p_so, o.status; end if;
  if o.factory_id is null or o.payment_terms is null or o.payment_terms = '' or o.merchandiser_id is null or o.manager_id is null
     or o.buyer_date is null or o.factory_date is null or o.merch_date is null then
    raise exception 'Fill in factory, payment terms, merchandiser, manager and all three dates before locking.';
  end if;
  if o.buyer_date <= current_date then raise exception 'Buyer delivery date must be in the future.'; end if;
  if not exists (select 1 from so_styles where so_id = p_so) then raise exception 'Add at least one style.'; end if;
  select s.name into v_bad from so_styles s where s.so_id = p_so
     and (s.name = '' or s.code = '' or s.fabric = '' or s.colour = '' or s.qty <= 0 or s.buyer_rate <= 0
          or not exists (select 1 from tna_checkpoints c where c.style_id = s.id)) limit 1;
  if found then raise exception 'Style "%" is incomplete: name, code, fabric, colour, quantity, rate and at least one checkpoint are required.', v_bad; end if;
  select s.name into v_bad from so_styles s join tna_checkpoints c on c.style_id = s.id
   where s.so_id = p_so and (c.due_date is null or c.name = '') limit 1;
  if found then raise exception 'Style "%" has a checkpoint without a name or date.', v_bad; end if;
  select s.name into v_bad from so_styles s join lateral (
           select due_date, lag(due_date) over (order by position) as prev from tna_checkpoints where style_id = s.id) c on true
   where s.so_id = p_so and c.prev is not null and c.due_date < c.prev limit 1;
  if found then raise exception 'Style "%" has checkpoint dates out of order.', v_bad; end if;
  update sales_orders set status = 'locked', locked_at = now(), locked_by = auth.uid() where id = p_so;
end $$;

-- GRN: no overshipping against the ordered quantity.
create function guard_grn_line() returns trigger
  language plpgsql set search_path = public as $$
declare v_ordered numeric; v_received numeric; v_so text;
begin
  select st.qty, st.so_id into v_ordered, v_so from so_styles st where st.id = new.style_id;
  if v_so is distinct from (select so_id from grns where id = new.grn_id) then
    raise exception 'That style does not belong to this GRN''s sales order.';
  end if;
  if not so_is_locked(v_so) then raise exception 'Goods can only be received on a locked sales order.'; end if;
  select coalesce(sum(l.qty), 0) into v_received from grn_lines l join grns g on g.id = l.grn_id
   where l.style_id = new.style_id and g.status <> 'rejected' and l.id <> new.id;
  if v_received + new.qty > v_ordered then
    raise exception 'Receiving % would make % in total, more than the % ordered. Overshipping is not allowed.', new.qty, v_received + new.qty, v_ordered;
  end if;
  return new;
end $$;
create trigger guard_grn_line before insert or update on grn_lines for each row execute function guard_grn_line();

-- DC: can't dispatch more than the GRN holds.
create function guard_dc_line() returns trigger
  language plpgsql set search_path = public as $$
declare v_grn text; v_in numeric; v_out numeric;
begin
  select grn_id into v_grn from delivery_challans where id = new.dc_id;
  if exists (select 1 from grns where id = v_grn and status = 'rejected') then raise exception 'This GRN was rejected.'; end if;
  select coalesce(sum(qty), 0) into v_in from grn_lines where grn_id = v_grn and style_id = new.style_id;
  select coalesce(sum(l.qty), 0) into v_out from dc_lines l join delivery_challans d on d.id = l.dc_id
   where d.grn_id = v_grn and l.style_id = new.style_id and l.id <> new.id;
  if v_out + new.qty > v_in then
    raise exception 'Only % available on % for this style.', v_in - v_out, v_grn;
  end if;
  return new;
end $$;
create trigger guard_dc_line before insert or update on dc_lines for each row execute function guard_dc_line();

-- Mark the order shipped once everything ordered has been dispatched.
create function mark_shipped() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'dispatched' and
     (select coalesce(sum(qty),0) from so_styles where so_id = new.so_id) <=
     (select coalesce(sum(l.qty),0) from dc_lines l join delivery_challans d on d.id = l.dc_id where d.so_id = new.so_id and d.status = 'dispatched') then
    update sales_orders set status = 'shipped' where id = new.so_id and status = 'locked';
  end if;
  return new;
end $$;
create trigger mark_shipped after update of status on delivery_challans for each row execute function mark_shipped();

-- Goods still at Sourcingo, with hours held (drives the 24-hour alert).
create view goods_held as
  select g.id as grn_id, g.so_id, g.received_at,
         round(extract(epoch from now() - g.received_at) / 3600, 1) as hours_held,
         sum(l.qty) - coalesce((select sum(dl.qty) from dc_lines dl join delivery_challans d on d.id = dl.dc_id
                                 where d.grn_id = g.id and d.status = 'dispatched'), 0) as units_held
    from grns g join grn_lines l on l.grn_id = g.id
   where g.status <> 'rejected'
   group by g.id;
alter view goods_held set (security_invoker = true);

-- New sign-ups get an inactive profile; the owner assigns the role.
create function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name) values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ───────────────────────── row-level security ─────────────────────────
alter table factories          enable row level security;
alter table buyers             enable row level security;
alter table buyer_registry     enable row level security;
alter table profiles           enable row level security;
alter table inquiries          enable row level security;
alter table inquiry_followups  enable row level security;
alter table sales_orders       enable row level security;
alter table so_styles          enable row level security;
alter table tna_checkpoints    enable row level security;
alter table tna_status_history enable row level security;
alter table grns               enable row level security;
alter table grn_lines          enable row level security;
alter table delivery_challans  enable row level security;
alter table dc_lines           enable row level security;
alter table files              enable row level security;
alter table audit_log          enable row level security;

create policy "internal read factories"  on factories for select using ((select is_internal()));
create policy "ops manage factories"     on factories for all    using ((select is_owner()) or (select my_role()) = 'manager') with check ((select is_owner()) or (select my_role()) = 'manager');

create policy "internal read buyers"     on buyers for select using ((select is_internal()));
create policy "owner manages buyers"     on buyers for all    using ((select is_owner())) with check ((select is_owner()));
create policy "owner only registry"      on buyer_registry for all using ((select is_owner())) with check ((select is_owner()));

create policy "read own profile"         on profiles for select using (id = auth.uid() or (select is_internal()));
create policy "owner manages profiles"   on profiles for update using ((select is_owner())) with check ((select is_owner()));

create policy "ops inquiries"            on inquiries         for all using ((select is_ops())) with check ((select is_ops()));
create policy "ops followups"            on inquiry_followups for all using ((select is_ops())) with check ((select is_ops()));
create policy "ops sales orders"         on sales_orders      for all using ((select is_ops())) with check ((select is_ops()));
create policy "ops styles"               on so_styles         for all using ((select is_ops())) with check ((select is_ops()));
create policy "ops checkpoints"          on tna_checkpoints   for all using ((select is_ops())) with check ((select is_ops()));
create policy "ops checkpoint history"   on tna_status_history for select using ((select is_ops()));

create policy "internal read grns"       on grns      for select using ((select is_internal()));
create policy "ops write grns"           on grns      for insert with check ((select is_ops()));
create policy "ops update grns"          on grns      for update using ((select is_ops()) and (status in ('draft') or (select is_owner()))) with check ((select is_ops()));
create policy "internal read grn lines"  on grn_lines for select using ((select is_internal()));
create policy "ops write grn lines"      on grn_lines for all    using ((select is_ops())) with check ((select is_ops()));
create policy "internal read dcs"        on delivery_challans for select using ((select is_internal()));
create policy "ops write dcs"            on delivery_challans for all    using ((select is_ops()) and status = 'draft') with check ((select is_ops()));
create policy "internal read dc lines"   on dc_lines for select using ((select is_internal()));
create policy "ops write dc lines"       on dc_lines for all    using ((select is_ops())) with check ((select is_ops()));
create policy "ops files"                on files    for all    using ((select is_ops())) with check ((select is_ops()));
create policy "owner reads audit"        on audit_log for select using ((select is_owner()));

-- GRN approval is the owner's call.
create function guard_grn_approval() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.status in ('approved','rejected') and new.status is distinct from old.status then
    if not is_owner() then raise exception 'Only the owner can approve or reject a GRN.'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger guard_grn_approval before update on grns for each row execute function guard_grn_approval();

-- ───────────────────────── portals (factory & buyer) ─────────────────────────
-- Views run as their owner, so each filters to the signed-in factory/buyer
-- and lists only the columns that side may see.

create view portal_factory_orders as
  select o.id, b.code as buyer_code, o.order_type, o.so_date, o.factory_date, o.status, o.locked_at, o.terms
    from sales_orders o join buyers b on b.id = o.buyer_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');

create view portal_factory_styles as
  select s.id, s.so_id, s.position, s.name, s.code, s.fabric, s.colour, s.use_sizes, s.sizes, s.qty, s.factory_rate
    from so_styles s join sales_orders o on o.id = s.so_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');

create view portal_factory_checkpoints as
  select c.id, c.style_id, s.so_id, c.position, c.name, c.due_date, c.status, c.status_updated_at
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');

create view portal_buyer_orders as
  select o.id, o.buyer_po_number, o.so_date, o.buyer_date, o.currency,
         case
           when o.status = 'shipped' then 'Shipped'
           when o.status <> 'locked' then 'Order confirmed'
           else coalesce((
             select case when c.name ~* 'qc|inspect|quality' then 'QC'
                         when c.name ~* 'pack' then 'Packing'
                         when c.name ~* 'dispatch|ship' then 'Ready to ship'
                         else 'Production' end
               from tna_checkpoints c join so_styles s on s.id = c.style_id
              where s.so_id = o.id and c.status <> 'completed'
              order by c.due_date nulls last, c.position limit 1), 'Ready to ship')
         end as milestone
    from sales_orders o
   where o.buyer_id = my_buyer_id();

create view portal_buyer_styles as
  select s.id, s.so_id, s.name, s.code, s.colour, s.qty, s.buyer_rate
    from so_styles s join sales_orders o on o.id = s.so_id
   where o.buyer_id = my_buyer_id();

create view portal_buyer_dispatches as
  select d.id, d.so_id, d.dispatched_at, d.courier, d.tracking, d.invoice_no, d.invoice_date
    from delivery_challans d join sales_orders o on o.id = d.so_id
   where o.buyer_id = my_buyer_id() and d.status = 'dispatched';

revoke all on portal_factory_orders, portal_factory_styles, portal_factory_checkpoints,
              portal_buyer_orders, portal_buyer_styles, portal_buyer_dispatches from anon;
grant select on portal_factory_orders, portal_factory_styles, portal_factory_checkpoints,
               portal_buyer_orders, portal_buyer_styles, portal_buyer_dispatches to authenticated;
grant execute on function set_checkpoint_status(uuid, tna_status), lock_sales_order(text) to authenticated;

-- ───────────────────────── seed: buyer codes ─────────────────────────
insert into buyers (code, default_payment_terms) values
  ('BYR-AH-0001',  'PDC after 40 days'),
  ('BYR-OR-0002',  '45 days'),
  ('BYR-SDR-0003', '45 days post-receipt'),
  ('BYR-KR-0004',  null);
-- Real names are added by the owner in the app (buyer_registry), never in source control.
