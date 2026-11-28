-- Money both sides trust (six-month plan, batch 8): buyer-currency invoices and statements, the margin view, and
-- the bank balance for the 90-day cash view. Additive only. Books stay in rupees, as in Tally (read only): a foreign
-- currency is shown beside them at a rate locked on each invoice, so a sent invoice never changes with the market.

-- The currencies buyers are invoiced in.
create function public.is_currency(p text) returns boolean language sql immutable as $$
  select p in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'AUD', 'CAD', 'SGD', 'HKD', 'JPY', 'CHF', 'SEK', 'NZD', 'ZAR')
$$;

alter table public.buyers add column currency text not null default 'INR' check (public.is_currency(currency));
alter table public.invoices
  add column currency text check (currency is null or (public.is_currency(currency) and currency <> 'INR')),
  -- Rupees for one unit of the currency, the day the invoice went out.
  add column fx_rate numeric(12, 4) check (fx_rate is null or (fx_rate > 0 and fx_rate <= 100000)),
  add check ((currency is null) = (fx_rate is null));

-- Buyers' columns are granted one by one (0024); the currency is not a secret.
grant select (currency) on public.buyers to authenticated;

-- Today's bank balance, so the 90-day cash view starts from real money. Owner and Accounts only.
create table public.company_cash (
  company_id uuid primary key references public.companies (id),
  amount numeric(14, 2) not null check (abs(amount) <= 10000000000),
  as_of date not null,
  set_by uuid not null default auth.uid() references public.profiles (id),
  set_at timestamptz not null default now()
);
alter table public.company_cash enable row level security;
revoke all on public.company_cash from anon, authenticated;
grant select on public.company_cash to authenticated;
create policy company_cash_read on public.company_cash for select to authenticated using (public.is_finance(company_id));

create function public.set_buyer_currency(p_buyer uuid, p_currency text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner set a buyer''s currency.';
  end if;
  if p_currency is null or not public.is_currency(p_currency) then
    raise exception 'Pick a currency from the list.';
  end if;
  update public.buyers set currency = p_currency where id = p_buyer and company_id = public.current_company();
  if not found then raise exception 'That buyer isn''t here any more. Reload the page.'; end if;
end $$;
revoke execute on function public.set_buyer_currency(uuid, text) from public, anon;
grant execute on function public.set_buyer_currency(uuid, text) to authenticated;

-- Lock (or clear, with a null rate) an invoice's currency and rate.
create function public.set_invoice_fx(p_invoice uuid, p_currency text, p_rate numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner set an invoice''s rate.';
  end if;
  if p_rate is not null then
    if p_currency is null or not public.is_currency(p_currency) or p_currency = 'INR' then
      raise exception 'Pick the buyer''s currency.';
    end if;
    if p_rate <= 0 or p_rate > 100000 or round(p_rate, 4) <> p_rate then
      raise exception 'Write the rate as rupees for one %, up to 4 decimals.', p_currency;
    end if;
  end if;
  update public.invoices set currency = case when p_rate is null then null else p_currency end, fx_rate = p_rate
  where id = p_invoice and company_id = public.current_company() and cancelled_at is null;
  if not found then raise exception 'That invoice isn''t here any more. Reload the page.'; end if;
end $$;
revoke execute on function public.set_invoice_fx(uuid, text, numeric) from public, anon;
grant execute on function public.set_invoice_fx(uuid, text, numeric) to authenticated;

create function public.set_cash_in_hand(p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner set the cash in hand.';
  end if;
  if p_amount is not null and (abs(p_amount) > 10000000000 or round(p_amount, 2) <> p_amount) then
    raise exception 'Write the bank balance in rupees.';
  end if;
  if p_amount is null then
    update public.company_cash set amount = 0, as_of = public.india_today(), set_by = auth.uid(), set_at = now()
    where company_id = public.current_company();
  else
    insert into public.company_cash (company_id, amount, as_of) values (public.current_company(), p_amount, public.india_today())
    on conflict (company_id) do update set amount = excluded.amount, as_of = excluded.as_of, set_by = auth.uid(), set_at = now();
  end if;
end $$;
revoke execute on function public.set_cash_in_hand(numeric) from public, anon;
grant execute on function public.set_cash_in_hand(numeric) to authenticated;

-- The buyer's page, as in 0082, with each invoice's currency and rate and the buyer's own currency.
create or replace function public.buyer_money() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.viewing_buyer();
  v_company uuid := public.current_company();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return jsonb_build_object('currency', (select currency from public.buyers where id = v_buyer), 'invoices', coalesce((
    select jsonb_agg(jsonb_build_object(
             'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date, 'amount', i.amount, 'due', d.due,
             'left', case when d.to_collect > 1 then d.to_collect else 0 end,
             'po', coalesce(nullif(btrim(o.buyer_po), ''), o.order_no), 'currency', i.currency, 'fx_rate', i.fx_rate)
           order by (d.to_collect > 1) desc, d.due nulls last, i.invoice_date desc, i.invoice_no)
    from public.invoice_dues(v_company) d
    join public.invoices i on i.id = d.invoice_id
    left join public.orders o on o.id = i.order_id
    where d.buyer_id = v_buyer
      and (d.to_collect > 1 or i.invoice_date > public.india_today() - 120)), '[]'::jsonb));
end $$;

-- The margin view: per order, what the rates plan and what was actually billed both ways (before GST), less refunds
-- agreed to the buyer, plus claims passed to factories. Open orders, and orders shipped in the last year.
create function public.order_margins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner see margins.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'buyer_id', o.buyer_id, 'status', o.status,
      'ship_date', coalesce(o.revised_ship_date, o.ship_date), 'shipped_on', public.order_shipped_on(o.id),
      'missing', (select count(*) from public.order_lines l where l.order_id = o.id and l.removed_at is null and (l.buyer_rate is null or l.factory_rate is null)),
      'refunds', (select coalesce(sum(c.amount), 0) from public.buyer_claims c where c.order_id = o.id and c.decision = 'refund'),
      'recovered', (select coalesce(sum(c.amount), 0) from public.factory_claims c where c.order_id = o.id and c.cancelled_at is null),
      'factories', (select coalesce(jsonb_agg(jsonb_build_object(
          'factory_id', f.id, 'name', f.name,
          'sale', (select coalesce(sum(l.qty * l.buyer_rate), 0) from public.order_lines l where l.order_id = o.id and l.factory_id = f.id and l.removed_at is null and l.buyer_rate is not null and l.factory_rate is not null),
          'cost', (select coalesce(sum(l.qty * l.factory_rate), 0) from public.order_lines l where l.order_id = o.id and l.factory_id = f.id and l.removed_at is null and l.buyer_rate is not null and l.factory_rate is not null),
          'billed_sale', (select coalesce(sum(d.invoice_taxable), 0) from public.dispatches d where d.order_id = o.id and d.factory_id = f.id and d.cancelled_at is null and d.invoiced_at is not null),
          'billed_cost', (select coalesce(sum(d.purchase_taxable), 0) from public.dispatches d where d.order_id = o.id and d.factory_id = f.id and d.cancelled_at is null and d.invoiced_at is not null)
        ) order by f.name), '[]'::jsonb)
        from public.factories f where f.id in (select l.factory_id from public.order_lines l where l.order_id = o.id and l.removed_at is null))
    ) order by coalesce(o.revised_ship_date, o.ship_date) desc nulls last, o.order_no desc)
    from public.orders o
    where o.company_id = v_company and o.removed_at is null
      and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '365 days'))), '[]'::jsonb);
end $$;
revoke execute on function public.order_margins() from public, anon;
grant execute on function public.order_margins() to authenticated;
