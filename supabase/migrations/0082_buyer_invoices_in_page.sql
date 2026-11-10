-- The buyer's invoices and balance on its own page: every invoice still to be paid (number, date, amount, due date,
-- what is left) and those paid in full in the last four months. Amounts left are worked out exactly as in Payments
-- (credit notes, cleared cheques and Tally receipts). Notes, cheque details and other buyers stay inside Sourcingo.

create function public.buyer_money() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.viewing_buyer();
  v_company uuid := public.current_company();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return jsonb_build_object('invoices', coalesce((
    select jsonb_agg(jsonb_build_object(
             'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date, 'amount', i.amount, 'due', d.due,
             'left', case when d.to_collect > 1 then d.to_collect else 0 end,
             'po', coalesce(nullif(btrim(o.buyer_po), ''), o.order_no))
           order by (d.to_collect > 1) desc, d.due nulls last, i.invoice_date desc, i.invoice_no)
    from public.invoice_dues(v_company) d
    join public.invoices i on i.id = d.invoice_id
    left join public.orders o on o.id = i.order_id
    where d.buyer_id = v_buyer
      and (d.to_collect > 1 or i.invoice_date > public.india_today() - 120)), '[]'::jsonb));
end $$;
revoke execute on function public.buyer_money() from public, anon;
grant execute on function public.buyer_money() to authenticated;
