-- E-way bill only when the law asks for one (Dheeraj, 28 Nov 2026).
-- Rule 138 of the CGST Rules: an e-way bill is needed when the consignment value is more than Rs 50,000. The value is
-- the invoice value including GST. Each state sets its own limit for goods that never leave the state; Rajasthan's
-- (notification F.17(131-Pt-II)ACCT/GST/2017/7713, 24 Mar 2022, from 1 Apr 2022) is Rs 1 lakh from one city to another
-- and Rs 2 lakh inside the same city. docs/EWAY-BILL.md has the sources.
--
-- The limits live on the company (companies.eway_rules) and the owner can change them on Goods. Where a lot goes
-- (another state, elsewhere in our state, the same city) is kept on the dispatch, and the buyer remembers it for next
-- time; not known means another state, the strictest limit. When a dispatch is invoiced and its value is not above the
-- limit, its e-way bill step is cleared by itself: eway_at is set with no number and eway_skip says why. The orders
-- team can still ask for one (eway_needed), add one anyway, or mark one not needed with a reason.
-- Additive only: no column, constraint or index is dropped.

alter table public.companies add column eway_rules jsonb not null default jsonb_build_object(
  'home_state', 'Rajasthan', 'inter_state', 50000, 'in_state', 100000, 'same_city', 200000,
  'checked_on', '2026-11-28', 'source', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter16/rule138_v1.00.html');

alter table public.buyers add column eway_zone text check (eway_zone in ('other_state', 'in_state', 'same_city'));
grant select (eway_zone) on public.buyers to authenticated;

alter table public.dispatches
  add column eway_zone text check (eway_zone in ('other_state', 'in_state', 'same_city')),
  add column eway_needed boolean not null default false,
  add column eway_skip text check (length(eway_skip) <= 400),
  add column eway_skip_by uuid references public.profiles (id);

-- The limit for a zone, from the company's rules. Unknown zones get the strictest (another state).
create function public.eway_limit(p_rules jsonb, p_zone text) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce((p_rules ->> (case coalesce(p_zone, 'other_state') when 'same_city' then 'same_city' when 'in_state' then 'in_state' else 'inter_state' end))::numeric,
                  (p_rules ->> 'inter_state')::numeric, 50000)
$$;

-- The consignment value of a dispatch: its invoice in Payments (with GST), else its own invoice value with GST.
create function public.eway_value(p_invoice uuid, p_taxable numeric, p_gst numeric) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select i.amount from public.invoices i where i.id = p_invoice), coalesce(p_taxable, 0) + coalesce(p_gst, 0))
$$;

-- Clears the e-way bill step of an invoiced lot whose value is not above its limit.
create function public.dispatch_eway_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb;
  v_zone text;
  v_limit numeric;
  v_value numeric;
begin
  if new.invoiced_at is null or new.eway_at is not null or new.shipped_at is not null or new.cancelled_at is not null
     or new.eway_needed then
    return new;
  end if;
  select c.eway_rules into v_rules from public.companies c where c.id = new.company_id;
  select coalesce(new.eway_zone, b.eway_zone, 'other_state') into v_zone
  from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = new.order_id;
  v_zone := coalesce(v_zone, 'other_state');
  v_limit := public.eway_limit(v_rules, v_zone);
  v_value := public.eway_value(new.invoice_id, new.invoice_taxable, new.invoice_gst);
  if v_value <= v_limit then
    new.eway_at := now();
    new.eway_skip_by := null;
    new.eway_skip := format('Not required: the invoice is Rs %s with GST, not above the Rs %s limit for %s (Rule 138; limits checked %s).',
      to_char(round(v_value), 'FM99,99,99,999'), to_char(v_limit, 'FM99,99,99,999'),
      case v_zone when 'same_city' then 'the same city' when 'in_state' then 'goods staying in ' || coalesce(v_rules ->> 'home_state', 'our state')
                  else 'another state' end,
      to_char(coalesce((v_rules ->> 'checked_on')::date, current_date), 'DD Mon YYYY'));
  end if;
  return new;
end $$;
revoke execute on function public.dispatch_eway_rule() from public, anon, authenticated;

create trigger dispatches_eway_rule before insert or update on public.dispatches
  for each row execute function public.dispatch_eway_rule();

-- Looks again at lots that are invoiced and not shipped: ones the rule cleared by itself, and ones still waiting.
-- A lot that has its e-way bill, or that someone marked by hand, stays as it is.
create function public.eway_recheck(p_company uuid, p_buyer uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.dispatches d set eway_at = null, eway_skip = null
  where d.company_id = p_company and d.invoiced_at is not null and d.shipped_at is null and d.cancelled_at is null
    and d.eway_bill_no is null and d.eway_skip_by is null and not d.eway_needed
    and (p_buyer is null or exists (select 1 from public.orders o where o.id = d.order_id and o.buyer_id = p_buyer));
$$;
revoke execute on function public.eway_recheck(uuid, uuid) from public, anon, authenticated;

-- The owner sets the limits. p: {home_state, inter_state, in_state, same_city, checked_on, source}
create function public.set_eway_rules(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  k text;
  v numeric;
begin
  if v_company is null or not public.is_owner(v_company) then
    raise exception 'Only the owner can change the e-way bill limits.';
  end if;
  foreach k in array array['inter_state', 'in_state', 'same_city'] loop
    begin
      v := nullif(btrim(p ->> k), '')::numeric;
    exception when others then v := null;
    end;
    if v is null or v < 0 or v > 100000000 then
      raise exception 'Enter each limit in rupees, like 50000.';
    end if;
  end loop;
  if (p ->> 'inter_state')::numeric > (p ->> 'in_state')::numeric or (p ->> 'in_state')::numeric > (p ->> 'same_city')::numeric then
    raise exception 'The limits should rise from another state to elsewhere in the state to the same city.';
  end if;
  if length(btrim(coalesce(p ->> 'home_state', ''))) not between 2 and 40 then
    raise exception 'Enter our state, like Rajasthan.';
  end if;
  if (p ->> 'checked_on') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter the date the limits were checked.';
  end if;
  if length(coalesce(p ->> 'source', '')) > 400 or coalesce(p ->> 'source', '') !~ '^(https?://\S+)?$' then
    raise exception 'The source should be a web link.';
  end if;
  update public.companies set eway_rules = jsonb_build_object(
    'home_state', btrim(p ->> 'home_state'), 'inter_state', round((p ->> 'inter_state')::numeric),
    'in_state', round((p ->> 'in_state')::numeric), 'same_city', round((p ->> 'same_city')::numeric),
    'checked_on', p ->> 'checked_on', 'source', coalesce(p ->> 'source', ''))
  where id = v_company;
  perform public.eway_recheck(v_company);
end $$;
revoke execute on function public.set_eway_rules(jsonb) from public, anon;
grant execute on function public.set_eway_rules(jsonb) to authenticated;

-- The orders team's choices on a lot's e-way bill step, before it ships.
--   zone:       where the lot goes (other_state, in_state, same_city); the buyer keeps it for next time.
--   needed:     the lot needs an e-way bill whatever its value.
--   not_needed: no e-way bill, with the reason (p_value).
--   auto:       back to the rule.
create function public.set_dispatch_eway(p_id uuid, p_action text, p_value text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_buyer uuid;
begin
  if d.invoiced_at is null then raise exception 'Make the invoice first.'; end if;
  if d.shipped_at is not null then raise exception 'The goods have shipped, so the e-way bill is fixed.'; end if;
  if p_action <> 'zone' and d.eway_bill_no is not null then raise exception 'This lot already has its e-way bill.'; end if;
  if p_action = 'zone' then
    if p_value is null or p_value not in ('other_state', 'in_state', 'same_city') then raise exception 'Choose where the goods are going.'; end if;
    select o.buyer_id into v_buyer from public.orders o where o.id = d.order_id;
    update public.buyers set eway_zone = p_value where id = v_buyer;
    update public.dispatches set eway_zone = p_value where id = p_id;
    if d.eway_bill_no is null and d.eway_skip_by is null and not d.eway_needed then
      update public.dispatches set eway_at = null, eway_skip = null where id = p_id;
    end if;
    -- The buyer's other lots that had no place of their own follow.
    update public.dispatches x set eway_at = null, eway_skip = null
    where x.company_id = d.company_id and x.id <> p_id and x.eway_zone is null and x.invoiced_at is not null and x.shipped_at is null
      and x.cancelled_at is null and x.eway_bill_no is null and x.eway_skip_by is null and not x.eway_needed
      and exists (select 1 from public.orders o where o.id = x.order_id and o.buyer_id = v_buyer);
  elsif p_action = 'needed' then
    update public.dispatches set eway_needed = true, eway_at = null, eway_skip = null, eway_skip_by = null where id = p_id;
  elsif p_action = 'not_needed' then
    if length(btrim(coalesce(p_value, ''))) < 5 then raise exception 'Say why this lot needs no e-way bill.'; end if;
    if length(p_value) > 300 then raise exception 'Keep the reason under 300 letters.'; end if;
    update public.dispatches set eway_needed = false, eway_at = now(), eway_skip_by = auth.uid(),
      eway_skip = 'Not required: ' || btrim(p_value) where id = p_id;
  elsif p_action = 'auto' then
    update public.dispatches set eway_needed = false, eway_at = null, eway_skip = null, eway_skip_by = null where id = p_id;
  else
    raise exception 'Unknown choice.';
  end if;
end $$;
revoke execute on function public.set_dispatch_eway(uuid, text, text) from public, anon;
grant execute on function public.set_dispatch_eway(uuid, text, text) to authenticated;

-- 3. E-way bill, as before; adding one to a lot that didn't need it replaces the "not required" note.
create or replace function public.record_eway_bill(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
begin
  if d.invoiced_at is null then raise exception 'Make the invoice first.'; end if;
  if d.shipped_at is not null then raise exception 'The goods have shipped, so the e-way bill is fixed.'; end if;
  if (p ->> 'no') !~ '^\s*\d{12}\s*$' then raise exception 'An e-way bill number has 12 digits.'; end if;
  if nullif(p ->> 'date', '') is null then raise exception 'Enter the e-way bill date.'; end if;
  if nullif(p ->> 'path', '') is null then raise exception 'Attach the e-way bill.'; end if;
  update public.dispatches set eway_bill_no = btrim(p ->> 'no'), eway_bill_date = (p ->> 'date')::date,
    eway_valid_until = nullif(p ->> 'valid_until', '')::date, eway_path = p ->> 'path', eway_at = now(),
    eway_skip = null, eway_skip_by = null
  where id = p_id;
end $$;

-- Tally's e-way bill is still taken when Accounts made one for a lot the rule cleared by itself (as 0031, plus those lots).
create or replace function public.take_eway_bills_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'eway_bill_no') then
    return;
  end if;
  execute $q$
    with m as (
      select d.id as dispatch_id, min(v.guid) as guid, count(*) as n
      from public.dispatches d
      join public.orders o on o.id = d.order_id
      join public.buyers b on b.id = o.buyer_id
      left join public.invoices i on i.id = d.invoice_id
      join public.tally_vouchers v on v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null
        and lower(btrim(v.number)) = lower(btrim(d.invoice_no))
        and (b.tally_ledger is null or v.party = b.tally_ledger)
        and abs(v.vdate - coalesce(i.invoice_date, (d.invoiced_at at time zone 'Asia/Kolkata')::date)) <= 30
      where d.invoiced_at is not null and d.cancelled_at is null and d.eway_bill_no is null
        and (d.eway_at is null or (d.shipped_at is null and d.eway_skip is not null and d.eway_skip_by is null))
      group by d.id
    )
    update public.dispatches d
    set eway_bill_no = v.eway_bill_no, eway_bill_date = coalesce(v.eway_bill_date, v.vdate), eway_valid_until = v.eway_valid_until,
        eway_at = now(), eway_from_tally = v.guid, eway_skip = null
    from m join public.tally_vouchers v on v.guid = m.guid
    where d.id = m.dispatch_id and v.company_id = d.company_id and m.n = 1 and btrim(v.eway_bill_no) ~ '^\d{12}$'
  $q$;
end $$;

-- Lots invoiced and waiting today get the rule now.
update public.dispatches set eway_at = null
where invoiced_at is not null and eway_at is null and shipped_at is null and cancelled_at is null;
