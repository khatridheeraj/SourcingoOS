-- Master data for printed documents (company letterhead, factory and buyer
-- details), personal preferences, TNA templates, and the tools that let the
-- team finish orders that arrived from email: plan a TNA on a running order,
-- fill in a missing factory, date or rate, and close an order shipped before
-- the app existed. Delay reasons travel with every "Delayed" step.

-- ───────────────────────── company (letterhead) ─────────────────────────
create table company_profile (
  id           boolean primary key default true check (id),
  legal_name   text not null default 'Sourcingo Private Limited' check (btrim(legal_name) <> ''),
  trade_name   text not null default 'Sourcingo' check (btrim(trade_name) <> ''),
  address      text,
  gstin        text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan          text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  phone        text,
  email        text,
  website      text,
  bank_name    text,
  bank_account text,
  bank_ifsc    text,
  po_terms     text,
  so_terms     text,
  updated_at   timestamptz not null default now()
);
insert into company_profile (po_terms) values (
  E'1. Deliver to Sourcingo on or before the delivery date. Tell us at once if any step will be late.\n'
  '2. Sourcingo inspects goods before acceptance (AQL 2.5 major, 4.0 minor, 0 critical). Failed lots are returned for rework.\n'
  '3. Quantities, colours and sizes as listed. Extra pieces are not accepted.\n'
  '4. Quote this PO number on your invoice and delivery challan.');
create trigger touch_company_profile before update on company_profile for each row execute function touch_updated_at();
create trigger audit_company_profile after insert or update or delete on company_profile for each row execute function write_audit();
alter table company_profile enable row level security;
-- Every signed-in, approved person (portals too) sees the letterhead; the owner edits it.
create policy "active read company" on company_profile for select using ((select my_role()) is not null);
create policy "owner edits company" on company_profile for update using ((select is_owner())) with check ((select is_owner()));

-- ───────────────────────── factories ─────────────────────────
-- gstin and state may already exist (the Tally sync adds them too).
alter table factories
  add column if not exists gstin text,
  add column if not exists state text,
  add column phone text,
  add column email text check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column pan text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add column bank_name text,
  add column bank_account text,
  add column bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  add column default_payment_terms text,
  add column categories text[] not null default '{}',
  add column capacity_per_month int check (capacity_per_month is null or capacity_per_month >= 0),
  add column notes text check (length(notes) <= 2000);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'factories_gstin_format') then
    alter table factories add constraint factories_gstin_format check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
  end if;
end $$;

-- ───────────────────────── buyers ─────────────────────────
-- Staff see only the code. Anything that identifies the buyer (contacts,
-- billing address) sits with the real name in the owner-only registry.
alter table buyers
  add column if not exists gstin text,
  add column if not exists state text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'buyers_gstin_format') then
    alter table buyers add constraint buyers_gstin_format check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
  end if;
end $$;
alter table buyer_registry
  add column billing_address text,
  add column contact_name text,
  add column contact_email text check (contact_email is null or contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column contact_phone text,
  add column notes text check (length(notes) <= 2000);

-- ───────────────────────── people: preferences ─────────────────────────
alter table profiles
  add column language text not null default 'en' check (language in ('en','hi')),
  add column digest boolean not null default true,
  add column phone text check (phone is null or length(phone) <= 30);

-- Everyone changes their own language, morning email and phone; nothing else.
create function set_my_preferences(p_language text default null, p_digest boolean default null, p_phone text default null)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_language is not null and p_language not in ('en','hi') then raise exception 'Unknown language.'; end if;
  update profiles set language = coalesce(p_language, language), digest = coalesce(p_digest, digest),
                      phone = case when p_phone is null then phone else nullif(btrim(p_phone), '') end
   where id = auth.uid();
end $$;
grant execute on function set_my_preferences(text, boolean, text) to authenticated;

-- ───────────────────────── TNA templates ─────────────────────────
-- steps: [{"name": "Cutting", "days": 18}], days = days before the factory
-- delivery date. Later steps sit closer to delivery.
create table tna_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (btrim(name) <> '' and length(name) <= 80),
  order_type  order_type not null default 'garment',
  steps       jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 30),
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index tna_templates_one_default on tna_templates (order_type) where is_default;

create function guard_tna_template() returns trigger
  language plpgsql set search_path = public as $$
declare s jsonb; v_prev int;
begin
  new.name := btrim(new.name);
  for s in select * from jsonb_array_elements(new.steps) loop
    if nullif(btrim(s->>'name'), '') is null then raise exception 'Every step in a template needs a name.'; end if;
    if (s->>'days') is null or (s->>'days') !~ '^\d+$' or (s->>'days')::int > 365 then
      raise exception 'Step "%": days before delivery must be a whole number from 0 to 365.', s->>'name';
    end if;
    if v_prev is not null and (s->>'days')::int > v_prev then
      raise exception 'Step "%" is planned before the step above it. List steps in the order they happen.', s->>'name';
    end if;
    v_prev := (s->>'days')::int;
  end loop;
  if new.is_default then
    update tna_templates set is_default = false where order_type = new.order_type and is_default and id <> new.id;
  end if;
  return new;
end $$;
create trigger guard_tna_template before insert or update on tna_templates for each row execute function guard_tna_template();
create trigger touch_tna_templates before update on tna_templates for each row execute function touch_updated_at();
create trigger audit_tna_templates after insert or update or delete on tna_templates for each row execute function write_audit();
alter table tna_templates enable row level security;
create policy "internal read templates" on tna_templates for select using ((select is_internal()));
create policy "managers edit templates" on tna_templates for all
  using ((select is_owner()) or (select my_role()) = 'manager') with check ((select is_owner()) or (select my_role()) = 'manager');

insert into tna_templates (name, order_type, is_default, steps) values
  ('Standard garment (5 weeks)', 'garment', true,
   '[{"name":"Fabric Sourcing","days":28},{"name":"Cutting","days":18},{"name":"Sewing","days":10},{"name":"QC","days":4},{"name":"Packing","days":2},{"name":"Ready for Dispatch","days":0}]'),
  ('With lab dips and PP sample (7 weeks)', 'garment', false,
   '[{"name":"Lab dip approval","days":42},{"name":"Fabric Sourcing","days":32},{"name":"PP sample approval","days":24},{"name":"Cutting","days":18},{"name":"Sewing","days":10},{"name":"Inline inspection","days":7},{"name":"Final QC","days":3},{"name":"Packing","days":1},{"name":"Ready for Dispatch","days":0}]'),
  ('Repeat order (3 weeks)', 'garment', false,
   '[{"name":"Fabric Sourcing","days":18},{"name":"Cutting","days":12},{"name":"Sewing","days":6},{"name":"QC","days":3},{"name":"Packing","days":1},{"name":"Ready for Dispatch","days":0}]'),
  ('Fabric order (5 weeks)', 'fabric', true,
   '[{"name":"Yarn / greige booking","days":30},{"name":"Dyeing / printing","days":15},{"name":"Finishing","days":8},{"name":"Fabric inspection","days":3},{"name":"Packing","days":1},{"name":"Ready for Dispatch","days":0}]');

-- ───────────────────────── fill in what's missing on locked orders ─────────────────────────
-- A locked order's commercial terms never change, but a factory, payment
-- terms, a delivery date or a factory rate that was never recorded can be
-- filled in once (orders imported from email arrived without them).
create or replace function guard_sales_order() returns trigger
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
    if (new.buyer_id, new.buyer_po_number, new.order_type, new.currency, new.inquiry_id)
         is distinct from (old.buyer_id, old.buyer_po_number, old.order_type, old.currency, old.inquiry_id)
       or (old.factory_id    is not null and new.factory_id    is distinct from old.factory_id)
       or (old.payment_terms is not null and new.payment_terms is distinct from old.payment_terms)
       or (old.buyer_date    is not null and new.buyer_date    is distinct from old.buyer_date)
       or (old.factory_date  is not null and new.factory_date  is distinct from old.factory_date) then
      raise exception 'Sales order % is locked. Ask the owner to unlock it first.', old.id;
    end if;
  end if;
  return new;
end $$;

create or replace function guard_style() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and so_is_locked(new.so_id) then
    raise exception 'Sales order % is locked. Styles cannot be added.', new.so_id;
  elsif tg_op = 'DELETE' and so_is_locked(old.so_id) then
    raise exception 'Sales order % is locked. Styles cannot be removed.', old.so_id;
  elsif tg_op = 'UPDATE' and so_is_locked(old.so_id) and (
        (new.so_id, new.position, new.name, new.code, new.fabric, new.colour, new.use_sizes, new.sizes, new.qty, new.buyer_rate)
        is distinct from
        (old.so_id, old.position, old.name, old.code, old.fabric, old.colour, old.use_sizes, old.sizes, old.qty, old.buyer_rate)
        or (old.factory_rate is not null and new.factory_rate is distinct from old.factory_rate)) then
    raise exception 'Sales order % is locked. Only the internal note (or a missing factory rate) can change.', old.so_id;
  end if;
  return coalesce(new, old);
end $$;

-- Checkpoints stay frozen after the lock, except when add_running_tna() plans
-- a TNA for styles that never had one.
create or replace function guard_checkpoint() returns trigger
  language plpgsql set search_path = public as $$
declare v_so text;
begin
  select so_id into v_so from so_styles where id = coalesce(new.style_id, old.style_id);
  if so_is_locked(v_so) then
    if tg_op = 'INSERT' and coalesce(current_setting('sourcingo.tna_backfill', true), '') = 'on' then
      return new;
    end if;
    if tg_op <> 'UPDATE' or (new.style_id, new.position, new.name, new.due_date)
                            is distinct from (old.style_id, old.position, old.name, old.due_date) then
      raise exception 'The TNA for % is locked. Dates and checkpoints cannot change.', v_so;
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- p_steps: [{"name": "...", "due_date": "YYYY-MM-DD"}], applied to every
-- style of a running order that has no checkpoints yet.
create function add_running_tna(p_so text, p_steps jsonb) returns int
  language plpgsql set search_path = public as $$
declare v_status so_status; v_style uuid; c jsonb; j int; v_prev date; v_n int := 0;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can plan a TNA.'; end if;
  select status into v_status from sales_orders where id = p_so for update;
  if not found then raise exception 'Sales order % not found.', p_so; end if;
  if v_status <> 'locked' then raise exception '% is not running. Plan its TNA in the sales order editor.', p_so; end if;
  if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps) = 0 then raise exception 'Add at least one step.'; end if;
  for c in select * from jsonb_array_elements(p_steps) loop
    if nullif(btrim(c->>'name'), '') is null then raise exception 'Every step needs a name.'; end if;
    if nullif(c->>'due_date', '') is null then raise exception 'Step "%" needs a date.', c->>'name'; end if;
    if v_prev is not null and (c->>'due_date')::date < v_prev then raise exception 'Step "%" is dated before the step above it.', c->>'name'; end if;
    v_prev := (c->>'due_date')::date;
  end loop;
  perform set_config('sourcingo.tna_backfill', 'on', true);
  for v_style in select st.id from so_styles st where st.so_id = p_so
                   and not exists (select 1 from tna_checkpoints c2 where c2.style_id = st.id) order by st.position loop
    j := 0;
    for c in select * from jsonb_array_elements(p_steps) loop
      insert into tna_checkpoints (style_id, position, name, due_date) values (v_style, j, btrim(c->>'name'), (c->>'due_date')::date);
      j := j + 1;
    end loop;
    v_n := v_n + 1;
  end loop;
  perform set_config('sourcingo.tna_backfill', 'off', true);
  if v_n = 0 then raise exception 'Every style on % already has a TNA.', p_so; end if;
  return v_n;
end $$;
grant execute on function add_running_tna(text, jsonb) to authenticated;

-- Orders that shipped before Sourcingo OS (no GRN or challan in the app) are
-- closed by hand by the owner or a merchandiser manager.
create function mark_order_shipped(p_so text, p_note text default null) returns void
  language plpgsql set search_path = public as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (is_owner() or my_role() = 'manager') then
    raise exception 'Only the owner or a merchandiser manager can close an order by hand.';
  end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  update sales_orders set status = 'shipped',
         remarks = concat_ws(E'\n', remarks, 'Marked shipped by hand on ' || to_char(current_date, 'DD Mon YYYY') || coalesce(': ' || v_note, '.'))
   where id = p_so and status = 'locked';
  if not found then raise exception '% is not a running order.', p_so; end if;
end $$;
grant execute on function mark_order_shipped(text, text) to authenticated;

-- ───────────────────────── delay reasons ─────────────────────────
alter table tna_checkpoints add column delay_reason text
  check (delay_reason is null or delay_reason in ('fabric','trims','approval','capacity','quality','labour','transport','other'));
alter table tna_status_history add column delay_reason text;

-- Like set_checkpoint_status(), with a reason code for delays. A factory must
-- pick a reason (and explain "other"); Sourcingo staff may leave it blank.
create function update_checkpoint(p_checkpoint uuid, p_status tna_status, p_note text default null, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v_old tna_status; v_old_note text; v_old_reason text; v_factory uuid; v_so_status so_status;
        v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select c.status, c.status_note, c.delay_reason, o.factory_id, o.status into v_old, v_old_note, v_old_reason, v_factory, v_so_status
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where c.id = p_checkpoint;
  if not found then raise exception 'Checkpoint not found.'; end if;
  if not (is_ops() or (my_role() = 'factory' and my_factory_id() = v_factory)) then
    raise exception 'You do not have access to this order.';
  end if;
  if v_so_status <> 'locked' then raise exception 'Status can only be updated after the TNA is locked.'; end if;
  if p_status <> 'delayed' then v_reason := null; end if;
  if v_reason is not null and v_reason not in ('fabric','trims','approval','capacity','quality','labour','transport','other') then
    raise exception 'Unknown delay reason.';
  end if;
  if p_status = 'delayed' and not is_ops() then
    if v_reason is null then raise exception 'Pick why it is delayed, so Sourcingo can plan around it.'; end if;
    if v_reason = 'other' and v_note is null then raise exception 'Say why it is delayed.'; end if;
  end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  if v_old = p_status and v_old_note is not distinct from v_note and v_old_reason is not distinct from v_reason then return; end if;
  update tna_checkpoints set status = p_status, status_note = v_note, delay_reason = v_reason,
         status_updated_at = now(), status_updated_by = auth.uid()
   where id = p_checkpoint;
  insert into tna_status_history (checkpoint_id, from_status, to_status, changed_by, note, delay_reason)
    values (p_checkpoint, v_old, p_status, auth.uid(), v_note, v_reason);
end $$;
grant execute on function update_checkpoint(uuid, tna_status, text, text) to authenticated;

create or replace view portal_factory_checkpoints as
  select c.id, c.style_id, s.so_id, c.position, c.name, c.due_date, c.status, c.status_updated_at, c.status_note, c.delay_reason
    from tna_checkpoints c join so_styles s on s.id = c.style_id join sales_orders o on o.id = s.so_id
   where o.factory_id = my_factory_id() and o.status in ('tna_review','locked','shipped');
