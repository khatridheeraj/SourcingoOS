-- Order entry checks.
-- 1. Before an order is saved, the form asks order_entry_warnings for the same buyer PO number already on an order
--    (an exact copy is still refused by orders_buyer_po_key; one that differs only in spaces, dashes, case or leading
--    zeros needs "Save anyway"), and for styles of the same buyer already on another open order (a warning only).
-- 2. Emails from senders that match no buyer are held as "Unknown sender" for the owner to accept or ignore. Each
--    buyer keeps a list of known PO senders (email addresses, or @domain for a whole domain), seen and changed only
--    by the owner. Holding starts once any buyer in the company has a known sender; senders of emails already read as
--    a buyer's PO are added to that buyer's list here, so pickups that work today keep working.

-- ---------------------------------------------------------------- 1. duplicate buyer PO and repeated styles

-- A PO number with only its letters and digits, lower case, without leading zeros on its numbers:
-- "PO-0045 / A" and "po45a" match.
create function public.po_key(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g'), '(^|[a-z])0+([0-9])', '\1\2', 'g'), '')
$$;

-- What the order form warns about before saving. p_order: the order being changed (left out of the checks), or null.
-- {same_po: [{id, order_no, buyer_po, status}], similar_po: [...], same_style: [{id, order_no, buyer_po, styles: [..]}]}
create function public.order_entry_warnings(p_buyer uuid, p_buyer_po text, p_styles text[], p_order uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_po text := lower(btrim(coalesce(p_buyer_po, '')));
  v_key text := public.po_key(p_buyer_po);
  v_styles text[];
begin
  select company_id into v_company from public.buyers where id = p_buyer;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can check orders.';
  end if;
  select coalesce(array_agg(distinct lower(btrim(s))), '{}') into v_styles
  from unnest(coalesce(p_styles, '{}')) s where btrim(s) <> '';

  return jsonb_build_object(
    'same_po', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'status', o.status) order by o.order_no)
      from public.orders o
      where o.company_id = v_company and o.buyer_id = p_buyer and v_po <> '' and lower(btrim(o.buyer_po)) = v_po
        and o.id is distinct from p_order), '[]'::jsonb),
    'similar_po', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'status', o.status) order by o.order_no)
      from public.orders o
      where o.company_id = v_company and o.buyer_id = p_buyer and v_key is not null and public.po_key(o.buyer_po) = v_key
        and lower(btrim(o.buyer_po)) <> v_po and o.id is distinct from p_order), '[]'::jsonb),
    'same_style', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'order_no', x.order_no, 'buyer_po', x.buyer_po, 'styles', x.styles) order by x.order_no)
      from (
        select o.id, o.order_no, o.buyer_po, jsonb_agg(distinct l.style) as styles
        from public.orders o join public.order_lines l on l.order_id = o.id and l.removed_at is null
        where o.company_id = v_company and o.buyer_id = p_buyer and o.status = 'open' and o.id is distinct from p_order
          and lower(btrim(l.style)) = any (v_styles)
        group by o.id, o.order_no, o.buyer_po
      ) x), '[]'::jsonb));
end $$;

revoke execute on function public.order_entry_warnings(uuid, text, text[], uuid) from public, anon;
grant execute on function public.order_entry_warnings(uuid, text, text[], uuid) to authenticated;

-- ---------------------------------------------------------------- 2. known PO senders and held emails

-- The plain address in a From line: '"Areeba" <Orders@Areeba.in>' gives 'orders@areeba.in'.
create function public.email_address(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(coalesce(substring(p from '<\s*([^<>\s@]+@[^<>\s@]+)\s*>'), substring(p from '([^<>\s"'',;:@]+@[^<>\s"'',;:@]+)')))
$$;

-- Known PO senders: 'orders@areeba.in' for one address, '@areeba.in' for a whole domain.
alter table public.buyers add column po_senders text[] not null default '{}';
-- Not granted to staff: only the owner reads or changes it, through the functions below.

-- An email held because its sender matches no buyer stays true after it is ignored, so it stays owner-only.
alter table public.incoming_pos add column sender_unknown boolean not null default false;
grant select (sender_unknown) on public.incoming_pos to authenticated;

alter table public.incoming_pos drop constraint incoming_pos_status_check;
alter table public.incoming_pos add constraint incoming_pos_status_check
  check (status in ('receiving', 'held', 'reading', 'to_check', 'added', 'not_po', 'failed'));

-- Mail from unknown senders is private: only the owner sees it, files included.
create policy incoming_pos_unknown_sender on public.incoming_pos as restrictive for select to authenticated
  using (not sender_unknown or public.is_owner(company_id));

create or replace function public.can_read_po_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  r public.incoming_pos;
begin
  if not public.can_edit_orders(v_parts[1]::uuid) then
    return false;
  end if;
  select * into r from public.incoming_pos where id = v_parts[2]::uuid and company_id = v_parts[1]::uuid;
  return r.id is null or (public.can_see_incoming_po(r.company_id, r.source, r.status, r.closed_by)
                          and (not r.sender_unknown or public.is_owner(r.company_id)));
exception when invalid_text_representation then
  return false;
end $$;

-- Whether an email's sender is on a buyer's list of known PO senders.
create function public.po_sender_known(p_company uuid, p_from text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.buyers b, unnest(b.po_senders) s
    where b.company_id = p_company and public.email_address(p_from) is not null
      and (s = public.email_address(p_from) or (s like '@%' and s = '@' || split_part(public.email_address(p_from), '@', 2))))
$$;
revoke execute on function public.po_sender_known(uuid, text) from public, anon, authenticated;

-- Senders of emails already read as a buyer's PO are that buyer's known senders.
update public.buyers b set po_senders = s.senders
from (
  select coalesce(o.buyer_id, i.buyer_id) as buyer_id, array_agg(distinct public.email_address(i.email_from)) as senders
  from public.incoming_pos i left join public.orders o on o.id = i.order_id
  where i.source = 'email' and i.status in ('to_check', 'added') and coalesce(o.buyer_id, i.buyer_id) is not null
    and public.email_address(i.email_from) is not null
  group by 1
) s
where b.id = s.buyer_id;

-- The mailbox script hands over an email. From a sender no buyer knows, it is held for the owner (once the company
-- has any known sender); otherwise it is read as before.
create or replace function public.receive_email_po(p_key text, p_email jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_id uuid;
  v_hold boolean;
begin
  select company_id into v_company from public.inbound_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if v_company is null then
    raise exception 'Unknown mailbox key.';
  end if;
  if coalesce(btrim(p_email ->> 'email_id'), '') = '' then
    raise exception 'The email has no id.';
  end if;
  v_hold := exists (select 1 from public.buyers where company_id = v_company and cardinality(po_senders) > 0)
            and not public.po_sender_known(v_company, p_email ->> 'from');
  insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, email_body, received_at, status,
                                   sender_unknown, created_by)
  values (v_company, 'email', p_email ->> 'email_id', left(p_email ->> 'from', 300), left(p_email ->> 'subject', 500),
          left(p_email ->> 'body', 8000), coalesce((p_email ->> 'received_at')::timestamptz, now()),
          case when v_hold then 'held' else 'receiving' end, v_hold, null)
  on conflict (company_id, email_id, part) where email_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- The owner's list of known PO senders, by buyer: {buyer_id: [sender, ...]}.
create function public.buyer_po_senders() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(b.id, to_jsonb(b.po_senders)), '{}'::jsonb)
  from public.buyers b
  where b.company_id = public.current_company() and public.is_owner(b.company_id) and cardinality(b.po_senders) > 0
$$;

-- The owner sets a buyer's known PO senders. Each is an email address or @domain.
create function public.set_buyer_po_senders(p_buyer uuid, p_senders text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_list text[];
  v_bad text;
begin
  select company_id into v_company from public.buyers where id = p_buyer;
  if v_company is null or v_company is distinct from public.current_company() or not public.is_owner(v_company) then
    raise exception 'Only the owner can change who sends a buyer''s POs.';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_list
  from (select case when s like '%@%' and s not like '@%' then s else '@' || ltrim(s, '@') end as x
        from (select lower(btrim(s)) as s from unnest(coalesce(p_senders, '{}')) s) t where s <> '') u;
  select x into v_bad from unnest(v_list) x
  where x !~ '^[a-z0-9._%+''-]*@[a-z0-9-]+(\.[a-z0-9-]+)+$' limit 1;
  if v_bad is not null then
    raise exception '"%" is not an email address or a domain like @buyer.com.', v_bad;
  end if;
  if cardinality(v_list) > 50 then
    raise exception 'Keep it to 50 senders or fewer.';
  end if;
  update public.buyers set po_senders = v_list where id = p_buyer;
end $$;

-- The owner accepts a held email: it is read as a PO. With p_buyer, its sender is remembered for that buyer.
create function public.accept_po_sender(p_id uuid, p_buyer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
  v_from text;
begin
  select * into r from public.incoming_pos where id = p_id for update;
  if r.id is null or r.company_id is distinct from public.current_company() or not public.is_owner(r.company_id) then
    raise exception 'Only the owner can accept emails from unknown senders.';
  end if;
  if r.status <> 'held' then
    raise exception 'This email is not waiting for you any more. Reload the page.';
  end if;
  if p_buyer is not null then
    if not exists (select 1 from public.buyers where id = p_buyer and company_id = r.company_id) then
      raise exception 'That buyer is not in this company.';
    end if;
    v_from := public.email_address(r.email_from);
    if v_from is null then
      raise exception 'This email has no sender address to remember. Accept it without remembering.';
    end if;
    update public.buyers set po_senders = (select array_agg(distinct x order by x) from unnest(po_senders || v_from) x)
    where id = p_buyer and not (v_from = any (po_senders));
  end if;
  update public.incoming_pos set status = 'reading', sender_unknown = false, read_error = null where id = p_id;
end $$;

-- The owner ignores a held email. It stays private (sender_unknown) under Set aside.
create function public.ignore_po_sender(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
begin
  select * into r from public.incoming_pos where id = p_id for update;
  if r.id is null or r.company_id is distinct from public.current_company() or not public.is_owner(r.company_id) then
    raise exception 'Only the owner can ignore emails from unknown senders.';
  end if;
  if r.status <> 'held' then
    raise exception 'This email is not waiting for you any more. Reload the page.';
  end if;
  update public.incoming_pos set status = 'not_po', closed_by = auth.uid(), closed_at = now() where id = p_id;
end $$;

revoke execute on function public.buyer_po_senders(), public.set_buyer_po_senders(uuid, text[]),
  public.accept_po_sender(uuid, uuid), public.ignore_po_sender(uuid) from public, anon;
grant execute on function public.buyer_po_senders(), public.set_buyer_po_senders(uuid, text[]),
  public.accept_po_sender(uuid, uuid), public.ignore_po_sender(uuid) to authenticated;

-- Not a PO, or back to the list. A held email is the owner's to sort; putting back an ignored one holds it again.
create or replace function public.set_incoming_po_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
begin
  select * into r from public.incoming_pos where id = p_id;
  if r.id is null or not public.can_edit_orders(r.company_id) or (r.sender_unknown and not public.is_owner(r.company_id)) then
    raise exception 'Only the orders team can sort incoming POs.';
  end if;
  if r.status = 'added' then
    raise exception 'This PO is already added as an order.';
  end if;
  if r.status = 'held' then
    raise exception 'Accept or ignore this sender first.';
  end if;
  if p_status not in ('not_po', 'to_check') then
    raise exception 'Unknown choice.';
  end if;
  update public.incoming_pos set
    status = case when p_status = 'to_check' and r.sender_unknown then 'held' else p_status end,
    closed_by = case when p_status = 'not_po' then auth.uid() end,
    closed_at = case when p_status = 'not_po' then now() end
  where id = p_id;
end $$;
