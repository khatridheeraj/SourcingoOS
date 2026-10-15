-- The history read rule asked for the reader's role once per history row, so the order page's activity list took
-- most of a second and got slower as history grew. The same rule now looks the role up once per query.
-- Reading is limited to the company the person is working in, which is the only company the app shows.
alter policy history_read on public.history using (
  company_id = (select public.current_company())
  and ((select public.my_role(public.current_company())) = 'owner'
    or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
      (select public.my_role(public.current_company())) = 'accounts'
      or ((select public.my_role(public.current_company())) in ('manager', 'merchandiser', 'quality')
          and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                                 'buyers', 'tally_ledgers', 'tally_items')
          and ((select public.my_role(public.current_company())) <> 'quality' or table_name not in ('order_lines', 'dispatch_lines')))))));
