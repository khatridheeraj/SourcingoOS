-- Real buyer names stay with the owner, and prices stay away from Quality, in the database itself.
-- A buyer's Tally ledger is usually its real name, and order lines carry buying and selling rates.
-- Both were readable through the API by any staff login (and through the history), though the
-- screens never showed them.

-- Buyers: staff read every column except the Tally ledger. The Tally page gets it from buyer_ledgers().
revoke select on public.buyers from authenticated;
grant select (id, company_id, code, city, notes, active, created_at, credit_days, grn_days) on public.buyers to authenticated;

create function public.buyer_ledgers() returns table (id uuid, tally_ledger text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.tally_ledger from public.buyers b
  where b.company_id = public.current_company() and public.is_finance(b.company_id)
$$;
revoke execute on function public.buyer_ledgers() from public, anon;
grant execute on function public.buyer_ledgers() to authenticated;

-- Bringing entries in from Tally finds the buyer by its ledger through buyer_ledgers() too.
create or replace function public.tally_import(p_guids text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v record;
  v_buyer uuid;
  v_inv uuid;
  v_ref text;
  v_inv_n integer := 0;
  v_cn_n integer := 0;
  v_skipped text[] := '{}';
begin
  if not public.is_finance(v_company) then raise exception 'Only Accounts and the owner can bring in entries from Tally.'; end if;
  -- Invoices first, so credit notes against them can come in the same go.
  for v in
    select * from public.tally_vouchers
    where company_id = v_company and guid = any (p_guids) and gone_at is null and kind in ('sales', 'credit_note')
    order by kind = 'credit_note', vdate, number
  loop
    if v.number is null then
      v_skipped := v_skipped || format('A %s dated %s has no number in Tally.', v.vtype, v.vdate);
      continue;
    end if;
    select id into v_buyer from public.buyer_ledgers() where tally_ledger = v.party;
    if v_buyer is null then
      v_skipped := v_skipped || format('%s: "%s" isn''t linked to a buyer yet.', v.number, coalesce(v.party, 'no party'));
      continue;
    end if;
    if v.kind = 'sales' then
      if exists (select 1 from public.invoices where company_id = v_company and lower(btrim(invoice_no)) = lower(v.number)) then
        v_skipped := v_skipped || format('Invoice %s is already in Payments.', v.number);
        continue;
      end if;
      insert into public.invoices (company_id, invoice_no, buyer_id, invoice_date, amount, notes)
      values (v_company, v.number, v_buyer, v.vdate, coalesce(abs(v.amount), 0), 'Brought in from Tally');
      v_inv_n := v_inv_n + 1;
    else
      if exists (select 1 from public.credit_notes where company_id = v_company and lower(btrim(credit_note_no)) = lower(v.number)) then
        v_skipped := v_skipped || format('Credit note %s is already in Payments.', v.number);
        continue;
      end if;
      -- The invoice it is set against in Tally, or the one named in its reference.
      v_inv := null;
      foreach v_ref in array array(select b ->> 'name' from jsonb_array_elements(v.bills) b union all select v.reference) loop
        select id into v_inv from public.invoices
        where company_id = v_company and buyer_id = v_buyer and cancelled_at is null and lower(btrim(invoice_no)) = lower(btrim(v_ref));
        exit when v_inv is not null;
      end loop;
      if v_inv is null then
        v_skipped := v_skipped || format('Credit note %s: Tally doesn''t say which invoice it is against. Add it in Payments by hand.', v.number);
        continue;
      end if;
      insert into public.credit_notes (company_id, credit_note_no, invoice_id, note_date, amount, notes)
      values (v_company, v.number, v_inv, v.vdate, abs(v.amount), 'Brought in from Tally');
      v_cn_n := v_cn_n + 1;
    end if;
  end loop;
  return jsonb_build_object('invoices', v_inv_n, 'credit_notes', v_cn_n, 'skipped', to_jsonb(v_skipped));
end $$;

-- Order lines: rates are read through line_prices(), which only the orders team and Accounts get.
revoke select on public.order_lines from authenticated;
grant select (id, company_id, order_id, position, style, description, colour, qty, factory_id, created_at, removed_at, photo_path)
  on public.order_lines to authenticated;

create function public.line_prices(p_orders uuid[]) returns table (id uuid, buyer_rate numeric, factory_rate numeric)
language sql stable security definer set search_path = '' as $$
  select l.id, l.buyer_rate, l.factory_rate from public.order_lines l
  where l.order_id = any (p_orders) and public.can_edit_orders(l.company_id)
$$;
revoke execute on function public.line_prices(uuid[]) from public, anon;
grant execute on function public.line_prices(uuid[]) to authenticated;

-- History: office staff no longer read the history of buyers (ledger names) or of Tally's ledgers and items,
-- and Quality no longer reads the history of order lines or dispatch lines (rates).
alter policy history_read on public.history using (
  public.is_owner(company_id)
  or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
    public.is_finance(company_id)
    or (public.my_role(company_id) in ('manager', 'merchandiser', 'quality')
        and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                               'buyers', 'tally_ledgers', 'tally_items')
        and (public.my_role(company_id) <> 'quality' or table_name not in ('order_lines', 'dispatch_lines'))))));
