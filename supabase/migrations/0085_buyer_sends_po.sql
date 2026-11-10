-- The buyer sends a new PO from its own page (step 6 of the buyer and factory sides). The PO file lands in Buyer POs
-- like one the team uploaded, already marked with its buyer, and is read as soon as someone on the orders team opens
-- Home or Buyer POs. The buyer sees what it sent and whether it is an order yet. Other buyers' POs and the team's
-- reading stay inside.

-- Which incoming POs a buyer sent from its page, with what it wrote. Kept apart from incoming_pos so reading the
-- file (which may find another buyer name or none) never loses who sent it.
create table public.buyer_po_uploads (
  incoming_id uuid primary key references public.incoming_pos (id),
  company_id uuid not null references public.companies (id),
  buyer_id uuid not null,
  buyer_po text check (length(buyer_po) <= 100),
  note text check (length(note) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
create index buyer_po_uploads_buyer_idx on public.buyer_po_uploads (buyer_id, created_at desc);
alter table public.buyer_po_uploads enable row level security;
revoke all on public.buyer_po_uploads from anon, authenticated;
grant select on public.buyer_po_uploads to authenticated;
create policy buyer_po_uploads_read on public.buyer_po_uploads for select to authenticated using (public.can_edit_orders(company_id));

-- A buyer login may put files in its own company's PO folder too (it can't read any back). Everything else as before.
create or replace function public.can_use_po_folder(p_folder text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return public.can_edit_orders(p_folder::uuid)
      or (public.my_buyer() is not null and p_folder::uuid = public.current_company());
exception when invalid_text_representation then
  return false;
end $$;

-- The buyer sends one PO: its files (already uploaded to <company>/<id>/), its PO number if it gave one, and a note.
create function public.buyer_send_po(p_id uuid, p_files jsonb, p_po text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer uuid := public.my_buyer();
  v_po text := nullif(btrim(coalesce(p_po, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  v_name text;
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) = 0 then
    raise exception 'Pick the PO file first.';
  end if;
  if jsonb_array_length(v_files) > 10 then
    raise exception 'Send at most 10 files with one PO.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_files) f
             where coalesce(f ->> 'path', '') not like v_company::text || '/' || p_id::text || '/%'
                or f ->> 'path' like '%..%'
                or coalesce(f ->> 'type', '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv',
                     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                or coalesce((f ->> 'size')::bigint, 0) not between 1 and 26214400) then
    raise exception 'That file didn''t upload properly. Try again.';
  end if;
  if length(v_po) > 100 then
    raise exception 'Keep the PO number under 100 characters.';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1,000 characters.';
  end if;
  if exists (select 1 from public.incoming_pos where id = p_id) then
    raise exception 'This PO was already sent. Reload the page.';
  end if;
  if (select count(*) from public.buyer_po_uploads where buyer_id = v_buyer and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is a lot of POs for one day. Message your Sourcingo merchandiser.';
  end if;
  select coalesce(nullif(btrim(n.real_name), ''), b.code) into v_name
  from public.buyers b left join public.buyer_names n on n.buyer_id = b.id where b.id = v_buyer;
  insert into public.incoming_pos (id, company_id, source, received_at, files, status, buyer_id, buyer_po,
                                   email_from, email_subject, email_body)
  values (p_id, v_company, 'upload', now(),
          (select jsonb_agg(jsonb_build_object('path', f ->> 'path', 'name', left(coalesce(f ->> 'name', 'PO file'), 200),
                                               'type', f ->> 'type', 'size', (f ->> 'size')::bigint))
           from jsonb_array_elements(v_files) f),
          'receiving', v_buyer, v_po, left(coalesce(v_name, 'Buyer') || ' (their page)', 200),
          coalesce('PO ' || v_po, 'New PO') || ' sent from the buyer page', v_note);
  insert into public.buyer_po_uploads (incoming_id, company_id, buyer_id, buyer_po, note) values (p_id, v_company, v_buyer, v_po, v_note);
  return p_id;
end $$;
revoke execute on function public.buyer_send_po(uuid, jsonb, text, text) from public, anon;
grant execute on function public.buyer_send_po(uuid, jsonb, text, text) to authenticated;

-- Reading the file never loses the buyer (or PO number) the buyer sent it as.
create function public.keep_sent_buyer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u public.buyer_po_uploads;
begin
  select * into u from public.buyer_po_uploads where incoming_id = new.id;
  if found then
    new.buyer_id := coalesce(new.buyer_id, u.buyer_id);
    new.buyer_po := coalesce(nullif(btrim(new.buyer_po), ''), u.buyer_po);
  end if;
  return new;
end $$;
create trigger incoming_pos_keep_sent_buyer before update of buyer_id, buyer_po on public.incoming_pos
  for each row execute function public.keep_sent_buyer();

-- What the buyer whose page this is sent in the last 4 months: when, the PO number, file names, and where it is now
-- (with Sourcingo, or an order with its reference).
create function public.buyer_sent_pos() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.incoming_id, 'sent_at', u.created_at, 'po', u.buyer_po, 'note', u.note,
      'files', (select coalesce(jsonb_agg(f ->> 'name'), '[]'::jsonb) from jsonb_array_elements(i.files) f),
      'state', case when i.status = 'added' and o.id is not null and o.removed_at is null then 'added'
                    when i.status = 'not_po' then 'set_aside' else 'with_team' end,
      'order_po', case when i.status = 'added' and o.removed_at is null then coalesce(nullif(btrim(o.buyer_po), ''), o.order_no) end,
      'order_ref', case when i.status = 'added' and o.removed_at is null then o.order_no end)
    order by u.created_at desc), '[]'::jsonb)
  from public.buyer_po_uploads u
  join public.incoming_pos i on i.id = u.incoming_id
  left join public.orders o on o.id = i.order_id
  where u.company_id = public.current_company() and u.buyer_id = public.viewing_buyer()
    and u.created_at > now() - interval '120 days'
$$;
revoke execute on function public.buyer_sent_pos() from public, anon;
grant execute on function public.buyer_sent_pos() to authenticated;
