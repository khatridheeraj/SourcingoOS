-- The buyer and Sourcingo talk about an order on the buyer's own page (step 5 of the buyer and factory sides).
-- The buyer writes on any of its open orders; the team answers from the order's Buyer tab. A buyer message waits on
-- the order's merchandiser's Home (the owner's when no one owns the order) until someone replies or taps Done.
-- Messages are never changed or deleted. The team's own notes (order_notes) stay separate and never reach the buyer.

create table public.buyer_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  body text not null check (btrim(body) <> '' and length(body) <= 2000),
  -- true when the buyer wrote it; false for Sourcingo's answer.
  from_buyer boolean not null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  -- A buyer message is dealt with once the team answers on the order or taps Done.
  answered_at timestamptz,
  answered_by uuid references public.profiles (id),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create index buyer_messages_order_idx on public.buyer_messages (order_id, created_at);
create index buyer_messages_open_idx on public.buyer_messages (company_id) where from_buyer and answered_at is null;

alter table public.buyer_messages enable row level security;
revoke all on public.buyer_messages from anon, authenticated;
-- The team reads them; the buyer reads its own through buyer_messages_mine(); writes go only through the functions below.
grant select on public.buyer_messages to authenticated;
create policy buyer_messages_read on public.buyer_messages for select to authenticated using (public.is_member(company_id));

-- The buyer writes on one of its own open orders.
create function public.post_buyer_message(p_order uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if public.my_buyer() is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  if not public.buyer_owns_order(v_company, p_order) then
    raise exception 'That order is not open any more. Reload the page.';
  end if;
  if v_body = '' then
    raise exception 'Write your message first.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Keep the message under 2,000 characters.';
  end if;
  insert into public.buyer_messages (company_id, order_id, body, from_buyer) values (v_company, p_order, v_body, true)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.post_buyer_message(uuid, text) from public, anon;
grant execute on function public.post_buyer_message(uuid, text) to authenticated;

-- Sourcingo answers the buyer on an order. Answering deals with every buyer message still open on it.
create function public.answer_buyer(p_order uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if auth.uid() is null or not public.is_member(v_company) then
    raise exception 'Only the team can answer the buyer.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company and removed_at is null) then
    raise exception 'That order is not here any more. Reload the page.';
  end if;
  if v_body = '' then
    raise exception 'Write the answer first.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Keep the answer under 2,000 characters.';
  end if;
  insert into public.buyer_messages (company_id, order_id, body, from_buyer) values (v_company, p_order, v_body, false)
  returning id into v_id;
  update public.buyer_messages set answered_at = now(), answered_by = auth.uid()
  where order_id = p_order and company_id = v_company and from_buyer and answered_at is null;
  return v_id;
end $$;
revoke execute on function public.answer_buyer(uuid, text) from public, anon;
grant execute on function public.answer_buyer(uuid, text) to authenticated;

-- The team marks the buyer's open messages on an order as dealt with, without writing back.
create function public.buyer_messages_done(p_order uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not public.is_member(public.current_company()) then
    raise exception 'Only the team can do that.';
  end if;
  update public.buyer_messages set answered_at = now(), answered_by = auth.uid()
  where company_id = public.current_company() and order_id = p_order and from_buyer and answered_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.buyer_messages_done(uuid) from public, anon;
grant execute on function public.buyer_messages_done(uuid) to authenticated;

-- The messages on the open orders of the buyer whose page this is (its own login, or a team member's preview).
-- Who on the team wrote an answer stays inside: the buyer sees "Sourcingo".
create function public.buyer_messages_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'order_id', m.order_id, 'body', m.body, 'from_buyer', m.from_buyer,
                                               'at', m.created_at) order by m.created_at), '[]'::jsonb)
  from public.buyer_messages m
  join public.orders o on o.id = m.order_id and o.company_id = m.company_id and o.status = 'open' and o.removed_at is null
  where m.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
$$;
revoke execute on function public.buyer_messages_mine() from public, anon;
grant execute on function public.buyer_messages_mine() to authenticated;
