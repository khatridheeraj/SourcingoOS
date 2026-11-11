-- The Sourcingo Guarantee (Dheeraj, 11 Nov 2026: "bigger than Alibaba"; remake-or-refund and paying factories soon
-- after QC "can be looked into"). Alibaba sells an introduction; Sourcingo answers for the delivered order:
--   * Each PO gets a payment plan: the buyer pays a deposit when the PO is placed and the balance once its goods pass
--     our Final QC; the factory is paid within N days (15) of its goods passing.
--   * A buyer raises a claim on a style with photos; the team decides within 7 days (remake, refund or decline with a
--     reason). An agreed claim passes to the factory as a factory claim (debit note), so the factory answers for it.
-- Nothing reaches real buyers or factories until the owner turns it on (companies.guarantee_live). Until then the team
-- sees it everywhere, including the "See what they see" previews.
-- Payments here are the team's own record of what came in and went out against the plan. Tally stays read only.

alter table public.companies
  add column guarantee_live boolean not null default false,
  add column guarantee_deposit_pct smallint not null default 30 check (guarantee_deposit_pct between 0 and 90),
  add column guarantee_pay_days smallint not null default 15 check (guarantee_pay_days between 1 and 60),
  -- The day it was first turned on. It covers orders entered from then: a buyer never meets a deposit it didn't agree to.
  -- Until then (the preview) it is drawn over every open order, so the owner can see how it would read.
  add column guarantee_from date;

-- True when the Guarantee may show on this page: it is on, or a team member is looking (in the app or a preview).
create function public.guarantee_shown() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.guarantee_live from public.companies c where c.id = public.current_company()), false)
      or (public.my_buyer() is null and public.my_factory() is null and public.is_member(public.current_company()))
$$;
revoke execute on function public.guarantee_shown() from public, anon;
grant execute on function public.guarantee_shown() to authenticated;

-- The owner sets the terms and turns the Guarantee on or off for buyers and factories.
create function public.set_guarantee(p_live boolean, p_deposit_pct integer, p_pay_days integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_owner(v_company) then
    raise exception 'Only the owner can change the Guarantee.';
  end if;
  if p_deposit_pct is null or p_deposit_pct < 0 or p_deposit_pct > 90 then
    raise exception 'The deposit is a share of the PO from 0%% to 90%%.';
  end if;
  if p_pay_days is null or p_pay_days < 1 or p_pay_days > 60 then
    raise exception 'Pay factories within 1 to 60 days of their QC pass.';
  end if;
  update public.companies set guarantee_live = coalesce(p_live, false), guarantee_deposit_pct = p_deposit_pct,
    guarantee_pay_days = p_pay_days,
    guarantee_from = case when coalesce(p_live, false) then coalesce(guarantee_from, public.india_today()) else guarantee_from end
  where id = v_company;
end $$;
revoke execute on function public.set_guarantee(boolean, integer, integer) from public, anon;
grant execute on function public.set_guarantee(boolean, integer, integer) to authenticated;

-- What came in from the buyer (deposit, balance) and went out to a factory against an order's plan.
-- Never deleted: a wrong entry is taken back (cancelled).
create table public.guarantee_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null,
  kind text not null check (kind in ('deposit', 'balance', 'factory')),
  factory_id uuid,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  paid_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  check ((kind = 'factory') = (factory_id is not null)),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, factory_id) references public.factories (company_id, id)
);
create index guarantee_payments_order_idx on public.guarantee_payments (order_id) where cancelled_at is null;
alter table public.guarantee_payments enable row level security;
revoke all on public.guarantee_payments from anon, authenticated;
grant select on public.guarantee_payments to authenticated;
create policy guarantee_payments_read on public.guarantee_payments for select to authenticated using (public.is_finance(company_id));

create function public.record_guarantee_payment(p_order uuid, p_kind text, p_factory uuid, p_amount numeric, p_paid_on date, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_id uuid;
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner can record Guarantee payments.';
  end if;
  if not exists (select 1 from public.orders where id = p_order and company_id = v_company and removed_at is null) then
    raise exception 'That order isn''t here any more. Reload the page.';
  end if;
  if p_kind is null or p_kind not in ('deposit', 'balance', 'factory') then
    raise exception 'Pick what the payment is for.';
  end if;
  if p_kind = 'factory' and not exists (select 1 from public.order_lines where order_id = p_order and factory_id = p_factory and removed_at is null) then
    raise exception 'That factory doesn''t make anything on this order.';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'Write the amount paid, in rupees.';
  end if;
  if p_paid_on is null or p_paid_on > public.india_today() or p_paid_on < public.india_today() - 400 then
    raise exception 'The payment date can''t be in the future or over a year ago.';
  end if;
  insert into public.guarantee_payments (company_id, order_id, kind, factory_id, amount, paid_on, note)
  values (v_company, p_order, p_kind, case when p_kind = 'factory' then p_factory end, p_amount, p_paid_on,
          left(nullif(btrim(coalesce(p_note, '')), ''), 200))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.record_guarantee_payment(uuid, text, uuid, numeric, date, text) from public, anon;
grant execute on function public.record_guarantee_payment(uuid, text, uuid, numeric, date, text) to authenticated;

create function public.cancel_guarantee_payment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.guarantee_payments where id = p_id and company_id = public.current_company()) then
    raise exception 'That payment isn''t here any more. Reload the page.';
  end if;
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can take back Guarantee payments.';
  end if;
  update public.guarantee_payments set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id and cancelled_at is null;
end $$;
revoke execute on function public.cancel_guarantee_payment(uuid) from public, anon;
grant execute on function public.cancel_guarantee_payment(uuid) to authenticated;

-- The day a set of styles passed: the latest pass among them, once every one's latest final check or re-check is a
-- pass (as shipping reads it). Null while any style has not passed.
create function public.passed_on(p_lines uuid[]) returns date
language sql stable security definer set search_path = '' as $$
  with last as (
    select l.id, (select q from public.qc_checks q where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                  order by q.checked_on desc, q.created_at desc limit 1) as q
    from public.order_lines l where l.id = any (p_lines) and l.removed_at is null)
  select case when count(*) > 0 and bool_and(coalesce((q).result = 'pass', false)) then max((q).checked_on) end from last
$$;
revoke execute on function public.passed_on(uuid[]) from public, anon, authenticated;

-- The plan's facts for some orders: PO value, the day the goods passed, what came in, and per factory its cost,
-- its pass day and what it was paid. Internal: each reader below picks what its viewer may see.
create function public.guarantee_facts(p_company uuid, p_orders uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'buyer_id', o.buyer_id, 'po_date', o.po_date,
    'status', o.status, 'ship_date', coalesce(o.revised_ship_date, o.ship_date),
    'value', (select coalesce(sum(l.qty * coalesce(l.buyer_rate, 0)), 0) from public.order_lines l where l.order_id = o.id and l.removed_at is null),
    'priced', not exists (select 1 from public.order_lines l where l.order_id = o.id and l.removed_at is null and l.buyer_rate is null),
    'passed_on', public.passed_on(array(select l.id from public.order_lines l where l.order_id = o.id and l.removed_at is null)),
    'paid_deposit', (select coalesce(sum(p.amount), 0) from public.guarantee_payments p where p.order_id = o.id and p.kind = 'deposit' and p.cancelled_at is null),
    'paid_balance', (select coalesce(sum(p.amount), 0) from public.guarantee_payments p where p.order_id = o.id and p.kind = 'balance' and p.cancelled_at is null),
    'factories', (select coalesce(jsonb_agg(jsonb_build_object(
        'factory_id', f.id, 'name', f.name,
        'cost', (select coalesce(sum(l.qty * coalesce(l.factory_rate, 0)), 0) from public.order_lines l where l.order_id = o.id and l.factory_id = f.id and l.removed_at is null),
        'passed_on', public.passed_on(array(select l.id from public.order_lines l where l.order_id = o.id and l.factory_id = f.id and l.removed_at is null)),
        'paid', (select coalesce(sum(p.amount), 0) from public.guarantee_payments p where p.order_id = o.id and p.factory_id = f.id and p.kind = 'factory' and p.cancelled_at is null)
      ) order by f.name), '[]'::jsonb)
      from public.factories f where f.id in (select l.factory_id from public.order_lines l where l.order_id = o.id and l.removed_at is null))
  ) order by coalesce(o.revised_ship_date, o.ship_date), o.order_no), '[]'::jsonb)
  from public.orders o
  where o.id = any (p_orders) and o.company_id = p_company and o.removed_at is null
$$;
revoke execute on function public.guarantee_facts(uuid, uuid[]) from public, anon, authenticated;

-- Orders the plan covers: open ones, and shipped ones from the last 120 days (balances and factory pay still due),
-- entered on or after the day the Guarantee was first turned on.
create function public.guarantee_order_ids(p_company uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(o.id), '{}') from public.orders o join public.companies c on c.id = o.company_id
  where o.company_id = p_company and o.removed_at is null
    and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '120 days'))
    and (c.guarantee_from is null or (o.created_at at time zone 'Asia/Kolkata')::date >= c.guarantee_from)
$$;
revoke execute on function public.guarantee_order_ids(uuid) from public, anon, authenticated;

-- The team's view: the terms and every covered order's plan, with buyer names. Money: owner and Accounts.
create function public.guarantee_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner see Guarantee payments.';
  end if;
  return jsonb_build_object(
    'orders', public.guarantee_facts(v_company, public.guarantee_order_ids(v_company)),
    'buyers', (select coalesce(jsonb_object_agg(b.id, coalesce(n.real_name, b.code)), '{}'::jsonb)
               from public.buyers b left join public.buyer_names n on n.buyer_id = b.id where b.company_id = v_company));
end $$;
revoke execute on function public.guarantee_orders() from public, anon;
grant execute on function public.guarantee_orders() to authenticated;

-- The terms, for every team page and preview.
create function public.guarantee_terms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('live', c.guarantee_live, 'deposit_pct', c.guarantee_deposit_pct, 'pay_days', c.guarantee_pay_days,
                            'from', c.guarantee_from, 'shown', public.guarantee_shown())
  from public.companies c where c.id = public.current_company()
$$;
revoke execute on function public.guarantee_terms() from public, anon;
grant execute on function public.guarantee_terms() to authenticated;

-- Buyer claims: something wrong with delivered (or passed) goods, raised by the buyer on its page or by the team for it.
create table public.buyer_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  claim_no text not null,
  order_id uuid not null,
  line_id uuid not null references public.order_lines (id),
  reason text not null check (reason in ('defect', 'short', 'wrong', 'late', 'other')),
  pieces integer not null check (pieces > 0 and pieces <= 10000000),
  ask text not null check (ask in ('remake', 'refund')),
  detail text not null check (char_length(btrim(detail)) between 1 and 800),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  raised_by uuid not null default auth.uid() references public.profiles (id),
  by_buyer boolean not null,
  raised_at timestamptz not null default now(),
  decide_by date not null,
  decision text check (decision in ('remake', 'refund', 'declined')),
  amount numeric(14, 2) check (amount > 0),
  answer text check (answer is null or char_length(answer) <= 500),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  factory_claim_no text,
  check ((decision is null) = (decided_at is null)),
  check ((decision = 'refund') = (amount is not null)),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create unique index buyer_claims_no_key on public.buyer_claims (company_id, claim_no);
create index buyer_claims_open_idx on public.buyer_claims (company_id, decide_by) where decision is null;
alter table public.buyer_claims enable row level security;
revoke all on public.buyer_claims from anon, authenticated;
grant select on public.buyer_claims to authenticated;
create policy buyer_claims_read on public.buyer_claims for select to authenticated using (public.is_member(company_id));

-- Days the team has to decide a claim. The buyer reads the date; it is our promise.
create function public.claim_days() returns integer language sql immutable as $$ select 7 $$;

create function public.raise_buyer_claim(p_line uuid, p_reason text, p_pieces integer, p_ask text, p_detail text, p_photos text[])
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer uuid := public.my_buyer();
  v_line public.order_lines%rowtype;
  v_order public.orders%rowtype;
  v_detail text := btrim(coalesce(p_detail, ''));
  v_photos text[] := coalesce(p_photos, '{}');
  v_no text;
begin
  select * into v_line from public.order_lines where id = p_line and company_id = v_company and removed_at is null;
  select * into v_order from public.orders where id = v_line.order_id and removed_at is null;
  if v_line.id is null or v_order.id is null or v_order.status = 'cancelled' then
    raise exception 'That style isn''t on an order any more. Reload the page.';
  end if;
  if v_buyer is not null then
    if v_order.buyer_id is distinct from v_buyer then
      raise exception 'That order isn''t yours.';
    end if;
    if not (select guarantee_live from public.companies where id = v_company) then
      raise exception 'Claims open here soon. For now, message your Sourcingo merchandiser.';
    end if;
  elsif not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can raise a claim for a buyer.';
  end if;
  if p_reason is null or p_reason not in ('defect', 'short', 'wrong', 'late', 'other') then
    raise exception 'Pick what went wrong.';
  end if;
  if p_pieces is null or p_pieces < 1 or p_pieces > v_line.qty then
    raise exception 'Pieces affected: from 1 to the % ordered.', v_line.qty;
  end if;
  if p_ask is null or p_ask not in ('remake', 'refund') then
    raise exception 'Pick a remake or a refund.';
  end if;
  if v_detail = '' then
    raise exception 'Say what is wrong, so we can put it right.';
  end if;
  if char_length(v_detail) > 800 then
    raise exception 'Keep it under 800 letters.';
  end if;
  if cardinality(v_photos) > 6 then
    raise exception 'Up to 6 photos.';
  end if;
  if exists (select 1 from unnest(v_photos) p where p not like v_company::text || '/' || v_order.id::text || '/claims/' || p_line::text || '/%') then
    raise exception 'Upload the photos again.';
  end if;
  perform pg_advisory_xact_lock(hashtext('buyer_claims:' || v_company::text));
  select 'BC-' || lpad((coalesce(max(substring(claim_no from 4)::integer), 0) + 1)::text, 4, '0') into v_no
  from public.buyer_claims where company_id = v_company and claim_no ~ '^BC-[0-9]+$';
  insert into public.buyer_claims (company_id, claim_no, order_id, line_id, reason, pieces, ask, detail, photos, by_buyer, decide_by)
  values (v_company, v_no, v_order.id, p_line, p_reason, p_pieces, p_ask, v_detail, v_photos, v_buyer is not null,
          public.india_today() + public.claim_days());
  return v_no;
end $$;
revoke execute on function public.raise_buyer_claim(uuid, text, integer, text, text, text[]) from public, anon;
grant execute on function public.raise_buyer_claim(uuid, text, integer, text, text, text[]) to authenticated;

-- The team decides: remake, refund (an amount) or decline (a reason). An agreed claim can pass to the factory as a
-- factory claim for its pieces at the factory's rate. Returns the factory claim number when one was raised.
create function public.decide_buyer_claim(p_id uuid, p_decision text, p_amount numeric, p_answer text, p_pass_on boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.buyer_claims%rowtype;
  v_line public.order_lines%rowtype;
  v_ledger text;
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
  v_cost numeric;
  v_no text;
begin
  select * into v_c from public.buyer_claims where id = p_id and company_id = public.current_company() for update;
  if v_c.id is null then
    raise exception 'That claim isn''t here any more. Reload the page.';
  end if;
  if not public.can_edit_orders(v_c.company_id) then
    raise exception 'Only the orders team and Accounts decide claims.';
  end if;
  if v_c.decision is not null then
    raise exception 'This claim was already decided. Reload the page.';
  end if;
  if p_decision is null or p_decision not in ('remake', 'refund', 'declined') then
    raise exception 'Pick remake, refund or decline.';
  end if;
  if p_decision = 'declined' and v_answer is null then
    raise exception 'Say why, so the buyer understands.';
  end if;
  if v_answer is not null and char_length(v_answer) > 500 then
    raise exception 'Keep the answer under 500 letters.';
  end if;
  select * into v_line from public.order_lines where id = v_c.line_id;
  if p_decision = 'refund' then
    if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
      raise exception 'Write the refund, in rupees.';
    end if;
    if v_line.buyer_rate is not null and p_amount > v_c.pieces * v_line.buyer_rate then
      raise exception 'The refund is more than the % pieces cost the buyer.', v_c.pieces;
    end if;
  end if;
  if coalesce(p_pass_on, false) and p_decision <> 'declined' then
    select f.tally_ledger into v_ledger from public.factories f where f.id = v_line.factory_id;
    v_cost := round(v_c.pieces * coalesce(v_line.factory_rate, 0), 2);
    if v_line.factory_id is null then
      raise exception 'No factory is set on this style, so the claim can''t pass on. Untick "Pass it to the factory".';
    end if;
    if nullif(btrim(coalesce(v_ledger, '')), '') is null then
      raise exception 'This factory isn''t linked to its Tally ledger yet, so the claim can''t pass on. Untick "Pass it to the factory".';
    end if;
    if v_cost <= 0 then
      raise exception 'This style has no factory rate, so the claim can''t be priced for the factory. Untick "Pass it to the factory".';
    end if;
    perform pg_advisory_xact_lock(hashtext('factory_claims:' || v_c.company_id::text));
    select 'CL-' || lpad((coalesce(max(substring(claim_no from 4)::integer), 0) + 1)::text, 4, '0') into v_no
    from public.factory_claims where company_id = v_c.company_id and claim_no ~ '^CL-[0-9]+$';
    insert into public.factory_claims (company_id, claim_no, ledger, order_id, claim_date, reason, pieces, amount, note)
    values (v_c.company_id, v_no, v_ledger, v_c.order_id, public.india_today(),
            case v_c.reason when 'short' then 'short' when 'late' then 'late' when 'other' then 'other' else 'quality' end,
            v_c.pieces, v_cost, left('Buyer claim ' || v_c.claim_no || ', ' || v_line.style || ': ' || v_c.detail, 500));
  end if;
  update public.buyer_claims set decision = p_decision, amount = case when p_decision = 'refund' then p_amount end,
    answer = v_answer, decided_by = auth.uid(), decided_at = now(), factory_claim_no = v_no
  where id = p_id;
  return v_no;
end $$;
revoke execute on function public.decide_buyer_claim(uuid, text, numeric, text, boolean) from public, anon;
grant execute on function public.decide_buyer_claim(uuid, text, numeric, text, boolean) to authenticated;

-- Claims for the team: newest open first, with the order, buyer, style and factory.
create function public.guarantee_claims() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_member(v_company) then
    raise exception 'Only the team reads claims.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'claim_no', c.claim_no, 'order_id', c.order_id, 'order_no', o.order_no, 'buyer_po', o.buyer_po,
      'buyer', coalesce(n.real_name, b.code), 'line_id', c.line_id, 'style', l.style, 'factory', f.name,
      'buyer_rate', case when public.can_edit_orders(v_company) then l.buyer_rate end,
      'factory_rate', case when public.can_edit_orders(v_company) then l.factory_rate end, 'linked', f.tally_ledger is not null,
      'reason', c.reason, 'pieces', c.pieces, 'ask', c.ask, 'detail', c.detail, 'photos', c.photos, 'by_buyer', c.by_buyer,
      'raised_at', c.raised_at, 'decide_by', c.decide_by, 'decision', c.decision, 'amount', c.amount, 'answer', c.answer,
      'decided_at', c.decided_at, 'factory_claim_no', c.factory_claim_no)
      order by c.decision is not null, c.decide_by, c.claim_no desc)
    from public.buyer_claims c
    join public.orders o on o.id = c.order_id
    join public.buyers b on b.id = o.buyer_id left join public.buyer_names n on n.buyer_id = b.id
    join public.order_lines l on l.id = c.line_id
    left join public.factories f on f.id = l.factory_id
    where c.company_id = v_company and o.removed_at is null
      and (c.decision is null or c.decided_at > now() - interval '120 days')), '[]'::jsonb);
end $$;
revoke execute on function public.guarantee_claims() from public, anon;
grant execute on function public.guarantee_claims() to authenticated;

-- The buyer's page: its plan per PO (never a factory, a cost or a rate) and its claims. Nothing while the Guarantee is
-- off, except to the team previewing it.
create function public.buyer_guarantee() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.viewing_buyer();
  v_company uuid := public.current_company();
  v_ids uuid[];
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  if not public.guarantee_shown() then
    return jsonb_build_object('shown', false);
  end if;
  select coalesce(array_agg(x), '{}') into v_ids from unnest(public.guarantee_order_ids(v_company)) x
  where exists (select 1 from public.orders o where o.id = x and o.buyer_id = v_buyer);
  return jsonb_build_object('shown', true, 'terms', public.guarantee_terms(),
    'orders', (select coalesce(jsonb_agg(e - 'factories' - 'buyer_id'), '[]'::jsonb) from jsonb_array_elements(public.guarantee_facts(v_company, v_ids)) e),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'claim_no', c.claim_no, 'order_id', c.order_id, 'style', l.style, 'reason', c.reason, 'pieces', c.pieces,
        'ask', c.ask, 'detail', c.detail, 'photos', c.photos, 'raised_at', c.raised_at, 'decide_by', c.decide_by,
        'decision', c.decision, 'amount', c.amount, 'answer', c.answer, 'decided_at', c.decided_at) order by c.raised_at desc)
      from public.buyer_claims c join public.order_lines l on l.id = c.line_id
      where c.order_id = any (v_ids)), '[]'::jsonb));
end $$;
revoke execute on function public.buyer_guarantee() from public, anon;
grant execute on function public.buyer_guarantee() to authenticated;

-- The factory's panel: for each order it makes, what it is owed for its goods, the day they passed, the day it is
-- paid by, and what it was paid. Never the buyer, the buyer's price or another factory.
create function public.factory_guarantee() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_factory uuid := public.viewing_factory();
  v_company uuid := public.current_company();
  v_ids uuid[];
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  if not public.guarantee_shown() then
    return jsonb_build_object('shown', false);
  end if;
  select coalesce(array_agg(x), '{}') into v_ids from unnest(public.guarantee_order_ids(v_company)) x
  where exists (select 1 from public.order_lines l where l.order_id = x and l.factory_id = v_factory and l.removed_at is null);
  return jsonb_build_object('shown', true, 'terms', public.guarantee_terms(),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('order_id', e ->> 'order_id', 'order_no', e ->> 'order_no', 'status', e ->> 'status',
                 'cost', f -> 'cost', 'passed_on', f -> 'passed_on', 'paid', f -> 'paid')), '[]'::jsonb)
               from jsonb_array_elements(public.guarantee_facts(v_company, v_ids)) e
               cross join lateral jsonb_array_elements(e -> 'factories') f
               where (f ->> 'factory_id')::uuid = v_factory));
end $$;
revoke execute on function public.factory_guarantee() from public, anon;
grant execute on function public.factory_guarantee() to authenticated;

-- As 0092, plus: claim photos under <company>/<order>/claims/<line>/<file>, by the orders team or the order's buyer.
create or replace function public.can_upload_photo(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := v_parts[1]::uuid;
begin
  if v_parts[2] = 'help' then
    return array_length(v_parts, 1) = 4 and v_parts[3] = auth.uid()::text and public.my_role(v_company) is not null;
  end if;
  if v_parts[2] = 'inquiries' then
    return public.can_edit_orders(v_company)
        or (array_length(v_parts, 1) = 4 and public.buyer_may_upload_inquiry(v_company, v_parts[3]::uuid));
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
  if v_parts[3] = 'claims' then
    return array_length(v_parts, 1) = 5 and (public.can_edit_orders(v_company) or public.buyer_owns_order(v_company, v_parts[2]::uuid));
  end if;
  if v_parts[3] = 'notes' then
    return array_length(v_parts, 1) = 5 and public.is_member(v_company);
  end if;
  return public.can_edit_orders(v_company);
exception when invalid_text_representation then
  return false;
end $$;

-- As 0094, plus: the buyer reads the photos of its own claims.
create or replace function public.buyer_can_read_photo(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null or v_parts[3] not in ('qc', 'styles', 'factory', 'samples', 'claims') then
    return false;
  end if;
  if v_parts[3] = 'qc' then
    return exists (
      select 1 from public.qc_photos p
      join public.qc_checks q on q.id = p.qc_id
      join public.order_lines l on l.id = q.line_id and l.removed_at is null
      join public.orders o on o.id = q.order_id
      where p.path = p_name and p.removed_at is null and p.kind = 'photo'
        and q.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
        and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
        and q.id = (select q2.id from public.qc_checks q2
                    where q2.line_id = l.id and q2.kind in ('final', 'recheck') and q2.cancelled_at is null
                    order by q2.checked_on desc, q2.created_at desc limit 1));
  end if;
  if v_parts[3] = 'claims' then
    return exists (select 1 from public.buyer_claims c join public.orders o on o.id = c.order_id
                   where c.order_id = v_parts[2]::uuid and c.company_id = v_parts[1]::uuid and o.company_id = public.current_company()
                     and o.buyer_id = v_buyer and p_name = any (c.photos));
  end if;
  if v_parts[3] in ('factory', 'samples') then
    return exists (
      select 1 from public.sample_rounds r join public.orders o on o.id = r.order_id
      where r.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and r.status in ('with_buyer', 'approved', 'changes') and (p_name = any (r.photos) or p_name = any (r.answer_photos)))
    or exists (
      select 1 from public.step_updates u join public.orders o on o.id = u.order_id and o.removed_at is null
      where u.order_id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid and o.company_id = public.current_company() and o.buyer_id = v_buyer
        and u.status = 'confirmed' and u.buyer_sees and p_name = any (u.photos)
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days')));
  end if;
  return exists (select 1 from public.orders o where o.id = v_parts[2]::uuid and o.company_id = v_parts[1]::uuid
                 and o.company_id = public.current_company() and o.buyer_id = v_buyer);
end $$;
