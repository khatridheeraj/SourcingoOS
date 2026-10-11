-- 0018 can go live before the Tally reader keeps e-way bills (0016_tally_eway). Until those columns exist,
-- taking e-way bills from Tally does nothing instead of failing every dispatch invoice.
create or replace function public.take_eway_bills_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Nothing to take until the Tally reader keeps e-way bills (0016_tally_eway).
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'eway_bill_no') then
    return;
  end if;
  execute $q$
    update public.dispatches d
    set eway_bill_no = v.eway_bill_no, eway_bill_date = coalesce(v.eway_bill_date, v.vdate), eway_valid_until = v.eway_valid_until,
        eway_at = now(), eway_from_tally = v.guid
    from public.tally_vouchers v
    where d.invoiced_at is not null and d.eway_at is null and d.cancelled_at is null
      and v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null
      and lower(btrim(v.number)) = lower(btrim(d.invoice_no))
      and btrim(v.eway_bill_no) ~ '^\d{12}$'
  $q$;
end $$;
