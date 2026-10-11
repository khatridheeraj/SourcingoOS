-- Dispatch takes the e-way bill from Tally. The merchandiser makes the invoice in Tally, which also makes its
-- e-way bill (Tally is linked to the e-way bill portal). Once the invoice number is on the dispatch and the
-- Tally reader has brought that sales voucher, its e-way bill fills the dispatch's e-way bill step by itself.
-- Entering it by hand stays possible for when Tally hasn't synced.

alter table public.dispatches
  add column eway_from_tally text;   -- the Tally sales voucher (guid) the e-way bill came from; null when typed in

-- Fills every dispatch still waiting for its e-way bill whose invoice is in Tally with one.
create function public.take_eway_bills_from_tally() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.dispatches d
  set eway_bill_no = v.eway_bill_no, eway_bill_date = coalesce(v.eway_bill_date, v.vdate), eway_valid_until = v.eway_valid_until,
      eway_at = now(), eway_from_tally = v.guid
  from public.tally_vouchers v
  where d.invoiced_at is not null and d.eway_at is null and d.cancelled_at is null
    and v.company_id = d.company_id and v.kind = 'sales' and v.gone_at is null
    and lower(btrim(v.number)) = lower(btrim(d.invoice_no))
    and btrim(v.eway_bill_no) ~ '^\d{12}$';
end $$;

create function public.take_eway_bills_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.take_eway_bills_from_tally();
  return null;
end $$;

-- When Tally brings vouchers, and when a dispatch gets its invoice number.
create trigger tally_vouchers_eway after insert or update on public.tally_vouchers
  for each statement execute function public.take_eway_bills_trigger();
create trigger dispatches_invoice_eway after update of invoice_no on public.dispatches
  for each statement execute function public.take_eway_bills_trigger();

revoke execute on function public.take_eway_bills_from_tally(), public.take_eway_bills_trigger() from public, anon, authenticated;
