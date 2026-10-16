-- Second full check of 16 Oct 2026: the core rules hold however the data is written.

-- 1. The screens write through the app's own steps, but a signed-in person could also write to the tables directly
--    and change what no screen lets them: move a style (with its plan, QC and dispatches) to another order, or say
--    an order, invoice or cheque was made by someone else or on another day. Who made a record, when, which order a
--    style belongs to and an order's number are now fixed once saved; the columns the screens change stay open.
revoke insert, update on public.orders from authenticated;
grant insert (id, company_id, buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, revised_ship_date, delay_reason)
  on public.orders to authenticated;
grant update (buyer_id, buyer_po, po_date, ship_date, status, merchandiser_id, notes, revised_ship_date, delay_reason)
  on public.orders to authenticated;

revoke insert, update on public.order_lines from authenticated;
grant insert (id, company_id, order_id, position, style, description, colour, qty, buyer_rate, factory_id, factory_rate, photo_path)
  on public.order_lines to authenticated;
grant update (position, style, description, colour, qty, buyer_rate, factory_id, factory_rate, removed_at, photo_path)
  on public.order_lines to authenticated;

revoke insert, update on public.invoices from authenticated;
grant insert (id, company_id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes) on public.invoices to authenticated;
grant update (invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes, cancelled_at) on public.invoices to authenticated;

revoke insert, update on public.cheques from authenticated;
grant insert (id, company_id, buyer_id, cheque_no, bank, cheque_date, amount, received_on, notes) on public.cheques to authenticated;
grant update (buyer_id, cheque_no, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on, bounced_on, notes)
  on public.cheques to authenticated;

revoke insert, update on public.credit_notes from authenticated;
grant insert (id, company_id, credit_note_no, invoice_id, note_date, amount, notes) on public.credit_notes to authenticated;
grant update (credit_note_no, invoice_id, note_date, amount, notes, cancelled_at) on public.credit_notes to authenticated;

revoke insert, update on public.cheque_allocations from authenticated;
grant insert (id, company_id, cheque_id, invoice_id, amount) on public.cheque_allocations to authenticated;
grant update (amount, removed_at) on public.cheque_allocations to authenticated;

revoke insert, update on public.buyers from authenticated;
grant insert (id, company_id, code, city, notes, active, credit_days, tally_ledger, grn_days) on public.buyers to authenticated;
grant update (code, city, notes, active, credit_days, tally_ledger, grn_days) on public.buyers to authenticated;

revoke insert, update on public.factories from authenticated;
grant insert (id, company_id, name, city, contact_name, phone, notes, active, tally_ledger) on public.factories to authenticated;
grant update (name, city, contact_name, phone, notes, active, tally_ledger) on public.factories to authenticated;

revoke update on public.buyer_names from authenticated;
grant update (real_name) on public.buyer_names to authenticated;

revoke insert, update on public.qc_checks from authenticated;
grant insert (id, company_id, order_id, line_id, kind, checked_on, result, pieces_checked, defects, notes, checked_by)
  on public.qc_checks to authenticated;
grant update (cancelled_at, cancel_reason) on public.qc_checks to authenticated;

-- 2. A cheque is recorded as received, then deposited, then cleared or bounced, each on its own day. Writing one
--    straight in as already cleared skipped every check on those steps. New cheques now always start in hand.
create or replace function public.guard_new_cheque() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (new.status <> 'in_hand' or coalesce(new.deposited_on, new.cleared_on, new.bounced_on) is not null) then
    raise exception 'Record the cheque as received first, then mark it deposited and cleared.';
  end if;
  return new;
end $$;
create trigger cheques_guard_new before insert on public.cheques
  for each row execute function public.guard_new_cheque();

-- 3. A QC check could be dated in the future, so a "pass" dated next month counted as passed today and let goods ship.
create or replace function public.check_qc_line() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.line_id is null then
    raise exception 'Pick the style this check is for.';
  end if;
  if not exists (select 1 from public.order_lines l where l.id = new.line_id and l.order_id = new.order_id and l.removed_at is null) then
    raise exception 'That style isn''t on this order.';
  end if;
  if new.checked_on > public.india_today() then
    raise exception 'The check date can''t be in the future.';
  end if;
  return new;
end $$;

-- 4. An order's ship date (and a revised one) can't be before its PO date.
alter table public.orders add constraint orders_ship_after_po check (ship_date >= po_date and revised_ship_date >= po_date);

-- 5. Pieces already dispatched per style are looked up by style.
create index dispatch_lines_line_idx on public.dispatch_lines (line_id);

-- 6. When Tally answered a read with an error (the company was closed or switched mid-read), the reader sent an empty
--    read, and the app marked every Tally ledger, stock item and voucher as deleted until the next read 15 minutes
--    later, while the health check counted it as a good read. An empty read is now refused.
create or replace function public.tally_bridge_snapshot(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.tally_company_for_key(p_key);
  v_now timestamptz := clock_timestamp();
  v_from date := nullif(p ->> 'from', '')::date;
  v_to date := nullif(p ->> 'to', '')::date;
  v_linked integer := 0;
  v_n integer;
  v_counts jsonb := '{}'::jsonb;
begin
  -- Every company has ledgers, so an empty list means Tally didn't really answer (the company was closed or
  -- switched mid-read). Taking it would mark every ledger, stock item and voucher as deleted.
  if jsonb_typeof(p -> 'ledgers') = 'array' and jsonb_array_length(p -> 'ledgers') = 0 then
    raise exception 'Tally sent no ledgers, so this read was not taken. The reader will try again.';
  end if;
  if jsonb_typeof(p -> 'ledgers') = 'array' then
    insert into public.tally_ledgers as t (company_id, name, parent, balance, gstin, seen_at, gone_at)
    select distinct on (btrim(x ->> 'name')) v_company, btrim(x ->> 'name'), nullif(x ->> 'parent', ''),
           coalesce(nullif(x ->> 'balance', '')::numeric, 0), nullif(upper(btrim(x ->> 'gstin')), ''), v_now, null
    from jsonb_array_elements(p -> 'ledgers') x
    where nullif(btrim(x ->> 'name'), '') is not null
    on conflict (company_id, name) do update set parent = excluded.parent, balance = excluded.balance,
      gstin = excluded.gstin, seen_at = excluded.seen_at, gone_at = null;
    update public.tally_ledgers set gone_at = v_now where company_id = v_company and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('ledgers', jsonb_array_length(p -> 'ledgers'));
  end if;

  if jsonb_typeof(p -> 'items') = 'array' then
    insert into public.tally_items (company_id, name, parent, unit, qty, value, seen_at, gone_at)
    select distinct on (btrim(x ->> 'name')) v_company, btrim(x ->> 'name'), nullif(x ->> 'parent', ''), nullif(x ->> 'unit', ''),
           coalesce(nullif(x ->> 'qty', '')::numeric, 0), coalesce(nullif(x ->> 'value', '')::numeric, 0), v_now, null
    from jsonb_array_elements(p -> 'items') x
    where nullif(btrim(x ->> 'name'), '') is not null
    on conflict (company_id, name) do update set parent = excluded.parent, unit = excluded.unit, qty = excluded.qty,
      value = excluded.value, seen_at = excluded.seen_at, gone_at = null;
    update public.tally_items set gone_at = v_now where company_id = v_company and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('items', jsonb_array_length(p -> 'items'));
  end if;

  if jsonb_typeof(p -> 'vouchers') = 'array' and v_from is not null and v_to is not null then
    insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, reference, narration, bills,
                                       eway_bill_no, eway_bill_date, eway_valid_until, irn, seen_at, gone_at)
    select distinct on (x ->> 'guid') v_company, x ->> 'guid', coalesce(nullif(x ->> 'vtype', ''), 'Voucher'),
           public.tally_kind(x ->> 'vtype'), nullif(btrim(x ->> 'number'), ''), (x ->> 'date')::date, nullif(btrim(x ->> 'party'), ''),
           nullif(x ->> 'amount', '')::numeric, nullif(x ->> 'reference', ''), nullif(x ->> 'narration', ''),
           case when jsonb_typeof(x -> 'bills') = 'array' then x -> 'bills' else '[]'::jsonb end,
           nullif(btrim(x ->> 'eway_bill_no'), ''), nullif(x ->> 'eway_bill_date', '')::date, nullif(x ->> 'eway_valid_until', '')::date,
           nullif(btrim(x ->> 'irn'), ''), v_now, null
    from jsonb_array_elements(p -> 'vouchers') x
    where nullif(x ->> 'guid', '') is not null and nullif(x ->> 'date', '') is not null
    on conflict (company_id, guid) do update set vtype = excluded.vtype, kind = excluded.kind, number = excluded.number,
      vdate = excluded.vdate, party = excluded.party, amount = excluded.amount, reference = excluded.reference,
      narration = excluded.narration, bills = excluded.bills, eway_bill_no = excluded.eway_bill_no,
      eway_bill_date = excluded.eway_bill_date, eway_valid_until = excluded.eway_valid_until, irn = excluded.irn,
      seen_at = excluded.seen_at, gone_at = null;
    update public.tally_vouchers set gone_at = v_now
    where company_id = v_company and vdate between v_from and v_to and seen_at < v_now and gone_at is null;
    v_counts := v_counts || jsonb_build_object('vouchers', jsonb_array_length(p -> 'vouchers'), 'from', v_from, 'to', v_to);
  end if;

  -- Link buyers and factories to the ledger with the same name, when exactly one matches.
  update public.buyers b set tally_ledger = m.name
  from (
    select b2.id, min(l.name) as name
    from public.buyers b2
    left join public.buyer_names n on n.buyer_id = b2.id
    join public.tally_ledgers l on l.company_id = b2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
     and public.tally_norm(l.name) in (public.tally_norm(n.real_name), public.tally_norm(b2.code))
    where b2.company_id = v_company and b2.tally_ledger is null
    group by b2.id having count(*) = 1
  ) m
  where b.id = m.id;
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.factories f set tally_ledger = m.name
  from (
    select f2.id, min(l.name) as name
    from public.factories f2
    join public.tally_ledgers l on l.company_id = f2.company_id and l.gone_at is null and public.tally_norm(l.name) <> ''
     and public.tally_norm(l.name) = public.tally_norm(f2.name)
    where f2.company_id = v_company and f2.tally_ledger is null
    group by f2.id having count(*) = 1
  ) m
  where f.id = m.id;
  get diagnostics v_n = row_count;
  v_linked := v_linked + v_n;

  update public.tally_settings set snapshot_at = v_now, agent_seen_at = v_now, snapshot_counts = v_counts
  where company_id = v_company;
  return v_counts || jsonb_build_object('linked', v_linked);
end $$;
