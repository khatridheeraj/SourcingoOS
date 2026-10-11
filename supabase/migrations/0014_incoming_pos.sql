-- Buyer POs that arrive by email (picked up automatically) or are added from a file (for example one shared on WhatsApp).
-- The app reads each file with AI into a draft; the orders team checks the draft and adds it as an order.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

create table public.incoming_pos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  source text not null check (source in ('email', 'upload')),
  -- One email can carry several POs; each becomes its own row (part 1, 2, ...).
  email_id text,
  part integer not null default 1 check (part between 1 and 50),
  email_from text,
  email_subject text,
  email_body text,
  received_at timestamptz not null default now(),
  -- [{path, name, type, size}] in the private "po-files" bucket.
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  status text not null default 'reading' check (status in ('receiving', 'reading', 'to_check', 'added', 'not_po', 'failed')),
  read jsonb,
  read_error text,
  read_at timestamptz,
  -- The buyer's name as printed on the PO. Only the owner sees it (staff see buyer codes).
  buyer_name_read text,
  buyer_id uuid,
  buyer_po text,
  matched_order_id uuid,
  order_id uuid,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id),
  constraint incoming_pos_matched_fkey foreign key (company_id, matched_order_id) references public.orders (company_id, id),
  constraint incoming_pos_order_fkey foreign key (company_id, order_id) references public.orders (company_id, id),
  constraint incoming_pos_added_has_order check (status <> 'added' or order_id is not null)
);
create unique index incoming_pos_email_key on public.incoming_pos (company_id, email_id, part) where email_id is not null;
create index incoming_pos_status_idx on public.incoming_pos (company_id, status, received_at desc);

create trigger incoming_pos_touch before update on public.incoming_pos
  for each row execute function public.touch_updated_at();

-- Keys the mailbox script uses to hand over emails. Only a hash is kept; nobody can read this table through the API.
create table public.inbound_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  key_hash text not null unique,
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.incoming_pos enable row level security;
alter table public.inbound_keys enable row level security;
revoke all on public.incoming_pos, public.inbound_keys from anon, authenticated;
grant select (id, company_id, source, email_id, part, email_from, email_subject, email_body, received_at, files, status, read,
              read_error, read_at, buyer_id, buyer_po, matched_order_id, order_id, closed_by, closed_at, created_by, created_at, updated_at)
  on public.incoming_pos to authenticated;
grant insert (id, source, files, received_at) on public.incoming_pos to authenticated;
grant all on public.incoming_pos, public.inbound_keys to service_role;

-- The orders team sees incoming POs and adds files itself; everything else goes through the functions below.
create policy incoming_pos_read on public.incoming_pos for select to authenticated using (public.can_edit_orders(company_id));
create policy incoming_pos_upload on public.incoming_pos for insert to authenticated
  with check (public.can_edit_orders(company_id) and source = 'upload' and status = 'reading' and created_by = auth.uid());

-- The owner can see the buyer's name as the AI read it.
create function public.incoming_po_buyer_name(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select buyer_name_read from public.incoming_pos where id = p_id and public.is_owner(company_id)
$$;

-- Not a PO, or back to the list.
create function public.set_incoming_po_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_status text;
begin
  select company_id, status into v_company, v_status from public.incoming_pos where id = p_id;
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can sort incoming POs.';
  end if;
  if v_status = 'added' then
    raise exception 'This PO is already added as an order.';
  end if;
  if p_status not in ('not_po', 'to_check') then
    raise exception 'Unknown choice.';
  end if;
  update public.incoming_pos set status = p_status,
    closed_by = case when p_status = 'not_po' then auth.uid() end,
    closed_at = case when p_status = 'not_po' then now() end
  where id = p_id;
end $$;

-- After the team saves the order, the incoming PO is marked added and linked to it.
create function public.link_incoming_po(p_id uuid, p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.incoming_pos where id = p_id and status in ('to_check', 'failed', 'reading');
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'This incoming PO is not waiting to be added. Reload the page.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company) then
    raise exception 'That order is not in this company.';
  end if;
  update public.incoming_pos set status = 'added', order_id = p_order, closed_by = auth.uid(), closed_at = now() where id = p_id;
end $$;

-- The mailbox script hands over an email: returns the new row's id, or null when that email was already received.
-- Run by the app's server with its own key; p_key is the mailbox script's key.
create function public.receive_email_po(p_key text, p_email jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_id uuid;
begin
  select company_id into v_company from public.inbound_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if v_company is null then
    raise exception 'Unknown mailbox key.';
  end if;
  if coalesce(btrim(p_email ->> 'email_id'), '') = '' then
    raise exception 'The email has no id.';
  end if;
  insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, email_body, received_at, status, created_by)
  values (v_company, 'email', p_email ->> 'email_id', left(p_email ->> 'from', 300), left(p_email ->> 'subject', 500),
          left(p_email ->> 'body', 8000), coalesce((p_email ->> 'received_at')::timestamptz, now()), 'receiving', null)
  on conflict (company_id, email_id, part) where email_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- The AI's reading of a PO. The first PO stays on this row; any further POs in the same files get their own rows.
-- p_pos: [{buyer_name, buyer_code, po_number, ...}] (empty when the files hold no buyer PO).
create function public.save_po_reading(p_id uuid, p_pos jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
  v_po jsonb;
  v_n integer := 0;
  v_buyer uuid;
  v_match uuid;
begin
  select * into r from public.incoming_pos where id = p_id for update;
  if r.id is null then
    raise exception 'No such incoming PO.';
  end if;
  if r.status not in ('receiving', 'reading', 'failed', 'to_check') then
    return;
  end if;
  if p_error is not null then
    update public.incoming_pos set status = 'failed', read_error = left(p_error, 1000), read_at = now() where id = p_id;
    return;
  end if;
  if jsonb_array_length(coalesce(p_pos, '[]'::jsonb)) = 0 then
    update public.incoming_pos set status = 'not_po', read = '{}'::jsonb, read_error = null, read_at = now() where id = p_id;
    return;
  end if;
  for v_po in select value from jsonb_array_elements(p_pos) loop
    v_n := v_n + 1;
    exit when v_n > 50;
    select b.id into v_buyer from public.buyers b
    where b.company_id = r.company_id and b.code = upper(btrim(v_po ->> 'buyer_code'));
    if v_buyer is null then
      select n.buyer_id into v_buyer from public.buyer_names n
      where n.company_id = r.company_id and lower(btrim(n.real_name)) = lower(btrim(v_po ->> 'buyer_name'));
    end if;
    v_match := null;
    if v_buyer is not null and coalesce(btrim(v_po ->> 'po_number'), '') <> '' then
      select o.id into v_match from public.orders o
      where o.company_id = r.company_id and o.buyer_id = v_buyer and lower(btrim(o.buyer_po)) = lower(btrim(v_po ->> 'po_number'));
    end if;
    if v_n = 1 then
      update public.incoming_pos set status = 'to_check', read = v_po - 'buyer_name', read_error = null, read_at = now(),
        buyer_name_read = left(v_po ->> 'buyer_name', 200), buyer_id = v_buyer, buyer_po = left(btrim(v_po ->> 'po_number'), 100),
        matched_order_id = v_match
      where id = p_id;
    elsif r.status <> 'to_check' then
      insert into public.incoming_pos (company_id, source, email_id, part, email_from, email_subject, email_body, received_at, files,
                                       status, read, read_at, buyer_name_read, buyer_id, buyer_po, matched_order_id, created_by)
      values (r.company_id, r.source, r.email_id, v_n, r.email_from, r.email_subject, r.email_body, r.received_at, r.files,
              'to_check', v_po - 'buyer_name', now(), left(v_po ->> 'buyer_name', 200), v_buyer, left(btrim(v_po ->> 'po_number'), 100),
              v_match, r.created_by)
      on conflict (company_id, email_id, part) where email_id is not null do nothing;
    end if;
  end loop;
end $$;

revoke execute on function public.incoming_po_buyer_name(uuid), public.set_incoming_po_status(uuid, text),
  public.link_incoming_po(uuid, uuid), public.receive_email_po(text, jsonb), public.save_po_reading(uuid, jsonb, text) from public, anon;
grant execute on function public.incoming_po_buyer_name(uuid), public.set_incoming_po_status(uuid, text),
  public.link_incoming_po(uuid, uuid) to authenticated;
revoke execute on function public.receive_email_po(text, jsonb), public.save_po_reading(uuid, jsonb, text) from authenticated;
grant execute on function public.receive_email_po(text, jsonb), public.save_po_reading(uuid, jsonb, text) to service_role;

-- PO files: <company>/<incoming id>/<file>. The orders team reads them and uploads new ones; the server adds emailed ones.
create function public.can_use_po_folder(p_folder text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return public.can_edit_orders(p_folder::uuid);
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.can_use_po_folder(text) from public, anon;
grant execute on function public.can_use_po_folder(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('po-files', 'po-files', false, 26214400, array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do nothing;
    execute $p$create policy "po files read" on storage.objects for select to authenticated
      using (bucket_id = 'po-files' and public.can_use_po_folder((storage.foldername(name))[1]))$p$;
    execute $p$create policy "po files upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'po-files' and public.can_use_po_folder((storage.foldername(name))[1]))$p$;
  end if;
end $$;
