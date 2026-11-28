-- Milestone payments on the Guarantee (six-month plan, batch 7). The Guarantee's fixed "deposit with the PO, balance on
-- the Final QC pass" becomes a plan of up to five milestones, each a share of the PO that falls due on an event:
--   po (the PO date), passed (every style passed Final QC), shipped (the order's last part left), delivered (every
--   part reached the buyer), plus a number of days after it ("balance 30 days after shipping").
-- The owner sets the default (30% with the PO, 70% on the pass, as before); Accounts or the owner can give one order its
-- own plan. Money a buyer pays fills the milestones in order, so a part payment never has to be split by hand.
-- Additive only: nothing is dropped, and payments recorded as 'deposit' or 'balance' still count.

alter table public.companies
  add column guarantee_plan jsonb not null default
    '[{"label":"Deposit","pct":30,"when":"po","days":0},{"label":"Balance","pct":70,"when":"passed","days":0}]'::jsonb;
-- Start from the deposit the owner already set.
update public.companies set guarantee_plan = jsonb_build_array(
    jsonb_build_object('label', 'Deposit', 'pct', guarantee_deposit_pct, 'when', 'po', 'days', 0),
    jsonb_build_object('label', 'Balance', 'pct', 100 - guarantee_deposit_pct, 'when', 'passed', 'days', 0))
  where guarantee_deposit_pct between 1 and 90;

alter table public.orders add column pay_plan jsonb;

-- Why a plan can't be saved, in the team's words; null when it is fine.
create function public.pay_plan_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_total integer := 0;
  v_step jsonb;
  v_pct integer;
  v_days integer;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then
    return 'Add at least one milestone.';
  end if;
  if jsonb_array_length(p) > 5 then
    return 'Up to five milestones.';
  end if;
  for v_step in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_step) <> 'object' then return 'Each milestone needs a name, a share and when it is due.'; end if;
    if char_length(btrim(coalesce(v_step ->> 'label', ''))) not between 1 and 40 then
      return 'Name each milestone in up to 40 letters.';
    end if;
    if coalesce(v_step ->> 'when', '') not in ('po', 'passed', 'shipped', 'delivered') then
      return 'Pick when each milestone falls due.';
    end if;
    if coalesce(v_step ->> 'pct', '') !~ '^[0-9]{1,3}$' or coalesce(v_step ->> 'days', '0') !~ '^[0-9]{1,3}$' then
      return 'Shares and days are whole numbers.';
    end if;
    v_pct := (v_step ->> 'pct')::integer;
    v_days := coalesce((v_step ->> 'days')::integer, 0);
    if v_pct < 1 or v_pct > 100 then return 'Each milestone is 1% to 100% of the PO.'; end if;
    if v_days > 180 then return 'Up to 180 days after the event.'; end if;
    v_total := v_total + v_pct;
  end loop;
  if v_total <> 100 then
    return format('The milestones add up to %s%%. Make them 100%%.', v_total);
  end if;
  return null;
end $$;

-- A plan cleaned to its five fields, so nothing else rides along into the buyer's page.
create function public.pay_plan_clean(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('label', btrim(e ->> 'label'), 'pct', (e ->> 'pct')::integer, 'when', e ->> 'when',
                                      'days', coalesce((e ->> 'days')::integer, 0)) order by n)
  from jsonb_array_elements(p) with ordinality as t(e, n)
$$;

-- p_order null: the owner's default for every order. Otherwise one order's own plan (Accounts or the owner); a null plan
-- puts that order back on the default.
create function public.set_pay_plan(p_order uuid, p_plan jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_problem text;
  v_plan jsonb;
begin
  if p_order is null then
    if not public.is_owner(v_company) then
      raise exception 'Only the owner can change the default plan.';
    end if;
  elsif not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner can change an order''s payment plan.';
  elsif not exists (select 1 from public.orders where id = p_order and company_id = v_company and removed_at is null) then
    raise exception 'That order isn''t here any more. Reload the page.';
  end if;
  if p_plan is not null then
    v_problem := public.pay_plan_problem(p_plan);
    if v_problem is not null then raise exception '%', v_problem; end if;
    v_plan := public.pay_plan_clean(p_plan);
  end if;
  if p_order is null then
    if v_plan is null then raise exception 'Add at least one milestone.'; end if;
    -- The deposit the website quotes: what falls due with the PO.
    update public.companies set guarantee_plan = v_plan,
      guarantee_deposit_pct = least(90, (select coalesce(sum((e ->> 'pct')::integer), 0) from jsonb_array_elements(v_plan) e where e ->> 'when' = 'po'))
    where id = v_company;
  else
    update public.orders set pay_plan = v_plan where id = p_order;
  end if;
end $$;
revoke execute on function public.set_pay_plan(uuid, jsonb) from public, anon;
grant execute on function public.set_pay_plan(uuid, jsonb) to authenticated;

-- The old two-step terms form still works: it rewrites the default as deposit + balance on the pass.
create or replace function public.set_guarantee(p_live boolean, p_deposit_pct integer, p_pay_days integer) returns void
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
  update public.companies set guarantee_live = coalesce(p_live, false), guarantee_pay_days = p_pay_days,
    guarantee_plan = case when p_deposit_pct = guarantee_deposit_pct then guarantee_plan
      when p_deposit_pct = 0 then '[{"label":"Balance","pct":100,"when":"passed","days":0}]'::jsonb
      else jsonb_build_array(jsonb_build_object('label', 'Deposit', 'pct', p_deposit_pct, 'when', 'po', 'days', 0),
                             jsonb_build_object('label', 'Balance', 'pct', 100 - p_deposit_pct, 'when', 'passed', 'days', 0)) end,
    guarantee_deposit_pct = p_deposit_pct,
    guarantee_from = case when coalesce(p_live, false) then coalesce(guarantee_from, public.india_today()) else guarantee_from end
  where id = v_company;
end $$;

-- The day an order's goods left: the last part's LR (or ship) day, once the order is shipped.
create function public.order_shipped_on(p_order uuid) returns date
language sql stable security definer set search_path = '' as $$
  select max(coalesce(d.lr_date, (d.shipped_at at time zone 'Asia/Kolkata')::date))
  from public.dispatches d join public.orders o on o.id = d.order_id
  where d.order_id = p_order and o.status = 'shipped' and d.cancelled_at is null and d.shipped_at is not null
$$;
revoke execute on function public.order_shipped_on(uuid) from public, anon, authenticated;

-- The day every part reached the buyer: the last GRN, once the order has shipped and every part has one.
create function public.order_delivered_on(p_order uuid) returns date
language sql stable security definer set search_path = '' as $$
  select case when public.order_shipped_on(p_order) is not null
                and not exists (select 1 from public.dispatches d where d.order_id = p_order and d.cancelled_at is null
                                and d.shipped_at is not null and d.grn_at is null)
              then (select max((d.grn_at at time zone 'Asia/Kolkata')::date) from public.dispatches d
                    where d.order_id = p_order and d.cancelled_at is null and d.shipped_at is not null) end
$$;
revoke execute on function public.order_delivered_on(uuid) from public, anon, authenticated;

-- As in 0095, plus each order's plan, its ship and delivery days, and everything the buyer has paid against it.
create or replace function public.guarantee_facts(p_company uuid, p_orders uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'buyer_id', o.buyer_id, 'po_date', o.po_date,
    'status', o.status, 'ship_date', coalesce(o.revised_ship_date, o.ship_date),
    'value', (select coalesce(sum(l.qty * coalesce(l.buyer_rate, 0)), 0) from public.order_lines l where l.order_id = o.id and l.removed_at is null),
    'priced', not exists (select 1 from public.order_lines l where l.order_id = o.id and l.removed_at is null and l.buyer_rate is null),
    'passed_on', public.passed_on(array(select l.id from public.order_lines l where l.order_id = o.id and l.removed_at is null)),
    'shipped_on', public.order_shipped_on(o.id),
    'delivered_on', public.order_delivered_on(o.id),
    'plan', coalesce(o.pay_plan, c.guarantee_plan),
    'own_plan', o.pay_plan is not null,
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
  from public.orders o join public.companies c on c.id = o.company_id
  where o.id = any (p_orders) and o.company_id = p_company and o.removed_at is null
$$;

-- The terms, now with the default plan.
create or replace function public.guarantee_terms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('live', c.guarantee_live, 'deposit_pct', c.guarantee_deposit_pct, 'pay_days', c.guarantee_pay_days,
                            'from', c.guarantee_from, 'shown', public.guarantee_shown(), 'plan', c.guarantee_plan)
  from public.companies c where c.id = public.current_company()
$$;
