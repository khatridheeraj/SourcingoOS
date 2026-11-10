-- A factory's bills and payments in its own panel, read from Tally like Bills to pay (nothing is written to Tally).
-- The factory sees each bill Sourcingo still has to pay (number, date, amount, what is left), and the payments and
-- debit notes against it in the last 120 days. Due dates, holds and the team's bill notes stay inside Sourcingo
-- (Dheeraj chose "bills and payments, no due dates").

create function public.factory_money() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_factory uuid := public.viewing_factory();
  v_company uuid := public.current_company();
  v_ledger text;
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  select tally_ledger into v_ledger from public.factories where id = v_factory and company_id = v_company;
  if v_ledger is null then
    return jsonb_build_object('linked', false, 'bills', '[]'::jsonb, 'paid', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'linked', true,
    'read_at', (select max(snapshot_at) from public.tally_settings where company_id = v_company and enabled),
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object('bill', p.bill, 'bill_date', p.bill_date, 'amount', p.amount, 'open', p.open)
             order by p.bill_date nulls first, p.bill)
      from public.payables_for(v_company, public.india_today()) p where p.ledger = v_ledger), '[]'::jsonb),
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('kind', v.kind, 'on', v.vdate, 'amount', v.amount,
               'number', case when v.kind = 'debit_note' then v.number end,
               'bills', (select coalesce(jsonb_agg(b ->> 'name'), '[]'::jsonb)
                         from jsonb_array_elements(case when jsonb_typeof(v.bills) = 'array' then v.bills else '[]'::jsonb end) b
                         where coalesce(b ->> 'name', '') <> ''))
             order by v.vdate desc, v.guid)
      from public.tally_vouchers v
      where v.company_id = v_company and v.party = v_ledger and v.gone_at is null and v.kind in ('payment', 'debit_note')
        and v.vdate > public.india_today() - 120), '[]'::jsonb));
end $$;
revoke execute on function public.factory_money() from public, anon;
grant execute on function public.factory_money() to authenticated;
