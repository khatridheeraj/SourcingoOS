-- Buyer inquiries (0047), brought back from the first version of the app (Dheeraj, 20 Oct 2026).
-- Every buyer inquiry is logged before it becomes an order: what the buyer asked for, who follows it up and when,
-- and how it ended. An inquiry is New, then Quoted, then Converted (it became a sales order) or Lost (with a reason).
-- A follow-up date puts it on Home when it falls due. Reference photos sit in the order-photos bucket under
-- <company>/inquiries/<inquiry>/<file>.jpg. Only the orders team reads or writes inquiries, as with prices.
-- Nothing here is ever deleted.

alter table public.companies add column next_inquiry_no integer not null default 1;

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  inquiry_no text not null,
  -- A buyer already in the app, or the name of a new one that isn't (yet).
  buyer_id uuid,
  prospect text check (length(btrim(prospect)) between 1 and 120),
  contact_name text check (length(contact_name) <= 120),
  contact text check (length(contact) <= 200),
  source text not null default 'email' check (source in ('email', 'whatsapp', 'phone', 'visit', 'other')),
  product text not null check (length(btrim(product)) between 1 and 200),
  est_qty integer check (est_qty > 0),
  unit text not null default 'pcs' check (unit in ('pcs', 'm')),
  target_price numeric(12, 2) check (target_price >= 0),
  quoted_price numeric(12, 2) check (quoted_price >= 0),
  merchandiser_id uuid references public.profiles (id),
  next_follow_up date,
  status text not null default 'new' check (status in ('new', 'quoted', 'converted', 'lost')),
  lost_reason text check (length(lost_reason) <= 300),
  order_id uuid,
  notes text check (length(notes) <= 4000),
  photos text[] not null default '{}' check (cardinality(photos) <= 12),
  status_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  constraint inquiries_who check (buyer_id is not null or prospect is not null),
  constraint inquiries_lost_reason check (status <> 'lost' or length(btrim(coalesce(lost_reason, ''))) > 0),
  constraint inquiries_converted_order check ((status = 'converted') = (order_id is not null))
);
create unique index inquiries_no_key on public.inquiries (company_id, inquiry_no);
create unique index inquiries_order_key on public.inquiries (order_id) where order_id is not null;
create index inquiries_open_idx on public.inquiries (company_id, status, next_follow_up);

-- Follow-up notes, newest last: "sent quote at Rs 240, buyer replies Friday".
create table public.inquiry_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  inquiry_id uuid not null references public.inquiries (id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index inquiry_notes_inquiry_idx on public.inquiry_notes (inquiry_id, created_at);

-- Inquiry numbers run per company: ENQ-0001, ENQ-0002, ...
create function public.number_inquiry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.companies set next_inquiry_no = next_inquiry_no + 1 where id = new.company_id
  returning next_inquiry_no - 1 into v_n;
  new.inquiry_no := 'ENQ-' || lpad(v_n::text, 4, '0');
  return new;
end $$;
revoke execute on function public.number_inquiry() from public, anon, authenticated;
create trigger inquiries_number before insert on public.inquiries
  for each row when (new.inquiry_no is null) execute function public.number_inquiry();

-- The rules a save can't get around: who it belongs to stays fixed, photos are the inquiry's own, a converted
-- inquiry stays converted, and it converts only into an order of the same buyer.
create function public.guard_inquiry() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_order record;
begin
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id or new.inquiry_no is distinct from old.inquiry_no
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'The inquiry number and who logged it can''t be changed.';
    end if;
    if old.status = 'converted' and (new.status <> 'converted' or new.order_id is distinct from old.order_id) then
      raise exception '% is already order %. Open the order to make changes.', old.inquiry_no,
        (select o.order_no from public.orders o where o.id = old.order_id);
    end if;
    if new.status is distinct from old.status then
      new.status_at := now();
    end if;
    new.updated_at := now();
  end if;
  if exists (select 1 from unnest(new.photos) p where p not like new.company_id || '/inquiries/' || new.id || '/%') then
    raise exception 'Those photos belong to another inquiry.';
  end if;
  if new.order_id is not null and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id) then
    select o.buyer_id, o.order_no, o.status into v_order from public.orders o where o.id = new.order_id and o.company_id = new.company_id;
    if v_order.order_no is null then
      raise exception 'That order isn''t in this company.';
    end if;
    if new.buyer_id is not null and new.buyer_id <> v_order.buyer_id then
      raise exception 'Order % is for another buyer than this inquiry.', v_order.order_no;
    end if;
    -- A new buyer's inquiry takes the buyer of the order it became.
    new.buyer_id := v_order.buyer_id;
    new.next_follow_up := null;
  end if;
  if new.status in ('converted', 'lost') then
    new.next_follow_up := null;
  end if;
  new.prospect := nullif(btrim(new.prospect), '');
  return new;
end $$;
revoke execute on function public.guard_inquiry() from public, anon, authenticated;
create trigger inquiries_guard before insert or update on public.inquiries
  for each row execute function public.guard_inquiry();

-- Only the orders team (not Quality, factories or buyers) works with inquiries; there is no delete.
alter table public.inquiries enable row level security;
alter table public.inquiry_notes enable row level security;
revoke all on public.inquiries, public.inquiry_notes from public, anon, authenticated;
grant select, insert, update on public.inquiries to authenticated;
grant select, insert on public.inquiry_notes to authenticated;
create policy inquiries_read on public.inquiries for select to authenticated using (public.can_edit_orders(company_id));
create policy inquiries_insert on public.inquiries for insert to authenticated with check (public.can_edit_orders(company_id));
create policy inquiries_update on public.inquiries for update to authenticated
  using (public.can_edit_orders(company_id)) with check (public.can_edit_orders(company_id));
create policy inquiry_notes_read on public.inquiry_notes for select to authenticated using (public.can_edit_orders(company_id));
create policy inquiry_notes_insert on public.inquiry_notes for insert to authenticated
  with check (public.can_edit_orders(company_id) and created_by = auth.uid()
              and exists (select 1 from public.inquiries i where i.id = inquiry_id and i.company_id = inquiry_notes.company_id));

-- Inquiry photos are for the orders team only. Uploads already need the orders team (can_upload_photo's last rule).
create or replace function public.can_read_order_file(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if v_parts[2] = 'help' then
    return public.my_role(v_parts[1]::uuid) is not null and (v_parts[3] = auth.uid()::text or public.is_owner(v_parts[1]::uuid));
  end if;
  if v_parts[2] = 'inquiries' then
    return public.can_edit_orders(v_parts[1]::uuid);
  end if;
  if not public.is_member(v_parts[1]::uuid) then
    return false;
  end if;
  return v_parts[3] is distinct from 'dispatch' or public.can_edit_orders(v_parts[1]::uuid);
exception when invalid_text_representation then
  return false;
end $$;
