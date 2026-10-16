-- Fixes from the full test of 16 Oct 2026.

-- 1. Quality could read purchase and sale values in the history of dispatches. Quality now sees no history of
--    dispatches or their photos, as it already sees none of order lines and dispatch lines.
alter policy history_read on public.history using (
  company_id = (select public.current_company())
  and ((select public.my_role(public.current_company())) = 'owner'
    or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
      (select public.my_role(public.current_company())) = 'accounts'
      or ((select public.my_role(public.current_company())) in ('manager', 'merchandiser', 'quality')
          and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                                 'buyers', 'tally_ledgers', 'tally_items')
          and ((select public.my_role(public.current_company())) <> 'quality'
               or table_name not in ('order_lines', 'dispatch_lines', 'dispatches', 'dispatch_photos')))))));

-- 2. Every email with an attachment is picked up, so the owner's private mail (bills, letters, company papers) was
--    open to the whole orders team once it was set aside as "not a PO". Emails the reader set aside by itself are now
--    seen only by the owner, files included. Uploads, POs and anything a person set aside stay open to the team.
create function public.can_see_incoming_po(p_company uuid, p_source text, p_status text, p_closed_by uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.can_edit_orders(p_company)
     and (p_status <> 'not_po' or p_source <> 'email' or p_closed_by is not null or public.is_owner(p_company))
$$;
revoke execute on function public.can_see_incoming_po(uuid, text, text, uuid) from public, anon;
grant execute on function public.can_see_incoming_po(uuid, text, text, uuid) to authenticated;

alter policy incoming_pos_read on public.incoming_pos
  using (public.can_see_incoming_po(company_id, source, status, closed_by));

-- A PO file folder is <company>/<incoming id>/. Files of a row the person can't see are closed to them too;
-- a folder with no row yet is a file being uploaded right now.
create function public.can_read_po_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  r public.incoming_pos;
begin
  if not public.can_edit_orders(v_parts[1]::uuid) then
    return false;
  end if;
  select * into r from public.incoming_pos where id = v_parts[2]::uuid and company_id = v_parts[1]::uuid;
  return r.id is null or public.can_see_incoming_po(r.company_id, r.source, r.status, r.closed_by);
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.can_read_po_file(text) from public, anon;
grant execute on function public.can_read_po_file(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$alter policy "po files read" on storage.objects
      using (bucket_id = 'po-files' and public.can_read_po_file(name))$p$;
  end if;
end $$;

-- 3. "Read again" on the second PO of an email wrote the first PO over it and lost the second one. Each row now
--    takes the PO at its own place in the reading; only the first row adds rows for the rest.
create or replace function public.save_po_reading(p_id uuid, p_pos jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.incoming_pos;
  v_po jsonb;
  v_n integer := 0;
  v_buyer uuid;
  v_match uuid;
begin
  select * into r from public.incoming_pos where id = p_id for update;
  if r.id is null then
    raise exception 'No such incoming PO.';
  end if;
  if r.status not in ('receiving', 'reading', 'failed', 'to_check') then
    return;
  end if;
  if p_error is not null then
    update public.incoming_pos set status = 'failed', read_error = left(p_error, 1000), read_at = now() where id = p_id;
    return;
  end if;
  if jsonb_array_length(coalesce(p_pos, '[]'::jsonb)) < r.part then
    if r.part > 1 then
      update public.incoming_pos set status = 'failed', read_error = 'This PO is no longer in the file when read again.', read_at = now()
      where id = p_id;
    else
      update public.incoming_pos set status = 'not_po', read = '{}'::jsonb, read_error = null, read_at = now() where id = p_id;
    end if;
    return;
  end if;
  for v_po in select value from jsonb_array_elements(p_pos) loop
    v_n := v_n + 1;
    exit when v_n > 50;
    continue when v_n <> r.part and (r.part > 1 or r.status = 'to_check');
    v_buyer := null;
    select b.id into v_buyer from public.buyers b
    where b.company_id = r.company_id and b.code = upper(btrim(v_po ->> 'buyer_code'));
    if v_buyer is null then
      select n.buyer_id into v_buyer from public.buyer_names n
      where n.company_id = r.company_id and lower(btrim(n.real_name)) = lower(btrim(v_po ->> 'buyer_name'));
    end if;
    v_match := null;
    if v_buyer is not null and coalesce(btrim(v_po ->> 'po_number'), '') <> '' then
      select o.id into v_match from public.orders o
      where o.company_id = r.company_id and o.buyer_id = v_buyer and lower(btrim(o.buyer_po)) = lower(btrim(v_po ->> 'po_number'));
    end if;
    if v_n = r.part then
      update public.incoming_pos set status = 'to_check', read = v_po - 'buyer_name', read_error = null, read_at = now(),
        buyer_name_read = left(v_po ->> 'buyer_name', 200), buyer_id = v_buyer, buyer_po = left(btrim(v_po ->> 'po_number'), 100),
        matched_order_id = v_match
      where id = p_id;
    else
      insert into public.incoming_pos (company_id, source, email_id, part, email_from, email_subject, email_body, received_at, files,
                                       status, read, read_at, buyer_name_read, buyer_id, buyer_po, matched_order_id, created_by)
      values (r.company_id, r.source, r.email_id, v_n, r.email_from, r.email_subject, r.email_body, r.received_at, r.files,
              'to_check', v_po - 'buyer_name', now(), left(v_po ->> 'buyer_name', 200), v_buyer, left(btrim(v_po ->> 'po_number'), 100),
              v_match, r.created_by)
      on conflict (company_id, email_id, part) where email_id is not null do nothing;
    end if;
  end loop;
end $$;

-- 4. Any login could read the target date of any order by its id. Only the company's staff and the order's
--    factory get it now.
create or replace function public.factory_target(p_order uuid, p_factory uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce(o.revised_ship_date, o.ship_date) - coalesce(f.buffer_days, 0)
  from public.orders o left join public.factory_pos f on f.order_id = o.id and f.factory_id = p_factory
  where o.id = p_order and (public.is_member(o.company_id) or public.my_factory() = p_factory)
$$;

-- 5. Goods could leave through the dispatch steps with a failed (or no) final QC, although an order can't be marked
--    shipped that way. Shipping a dispatch now needs a passed final QC (or re-check) on every style in it, as marking
--    the order shipped does. The owner can still ship without it.
create or replace function public.record_shipping(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.dispatches := public.dispatch_for_step(p_id);
  v_days integer;
  v_lr date := nullif(p ->> 'lr_date', '')::date;
  v_styles text;
begin
  if d.eway_at is null then raise exception 'Add the e-way bill first.'; end if;
  if d.shipped_at is not null then raise exception 'This dispatch has already shipped.'; end if;
  if btrim(coalesce(p ->> 'transporter', '')) = '' then raise exception 'Enter the transporter.'; end if;
  if btrim(coalesce(p ->> 'lr_no', '')) = '' or v_lr is null then raise exception 'Enter the LR number and date.'; end if;
  if nullif(p ->> 'lr_path', '') is null then raise exception 'Attach the LR copy.'; end if;
  if jsonb_typeof(p -> 'photos') is distinct from 'array' or jsonb_array_length(p -> 'photos') = 0 then
    raise exception 'Add photos of the goods.';
  end if;
  if not public.is_owner(d.company_id) then
    select string_agg(distinct l.style, ', ') into v_styles
    from public.dispatch_lines dl join public.order_lines l on l.id = dl.line_id
    where dl.dispatch_id = p_id
      and coalesce((select q.result = 'pass' from public.qc_checks q
                    where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                    order by q.checked_on desc, q.created_at desc limit 1), false) = false;
    if v_styles is not null then
      raise exception 'Final QC has not passed for %. Quality must pass it before these goods ship.', v_styles
        using errcode = 'P0001', hint = 'final_qc_required';
    end if;
  end if;
  select b.grn_days into v_days from public.orders o join public.buyers b on b.id = o.buyer_id where o.id = d.order_id;
  insert into public.dispatch_photos (company_id, dispatch_id, path)
  select d.company_id, p_id, value from jsonb_array_elements_text(p -> 'photos');
  update public.dispatches set transporter = btrim(p ->> 'transporter'), vehicle_no = nullif(upper(btrim(p ->> 'vehicle_no')), ''),
    lr_no = btrim(p ->> 'lr_no'), lr_date = v_lr, lr_path = p ->> 'lr_path', cartons = nullif(p ->> 'cartons', '')::integer,
    shipped_at = now(), grn_due_on = v_lr + coalesce(v_days, 7)
  where id = p_id;
end $$;

-- 6. An e-way bill was taken from any Tally sales voucher with the same invoice number, so last year's invoice 57
--    could give this year's invoice 57 its e-way bill. The voucher must now also be for the order's buyer (when the
--    buyer is linked to a Tally ledger), dated within 30 days of the invoice, and the only such voucher.
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
      where d.invoiced_at is not null and d.eway_at is null and d.cancelled_at is null
      group by d.id
    )
    update public.dispatches d
    set eway_bill_no = v.eway_bill_no, eway_bill_date = coalesce(v.eway_bill_date, v.vdate), eway_valid_until = v.eway_valid_until,
        eway_at = now(), eway_from_tally = v.guid
    from m join public.tally_vouchers v on v.guid = m.guid
    where d.id = m.dispatch_id and v.company_id = d.company_id and m.n = 1 and btrim(v.eway_bill_no) ~ '^\d{12}$'
  $q$;
end $$;

-- 7. A cheque still in hand more than 90 days after its date can't be banked. The app already stopped counting it,
--    but the database still did, so the buyer's replacement cheque was refused as paying the invoice twice.
create or replace function public.invoice_covered(p_invoice uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(a.amount), 0) from public.cheque_allocations a join public.cheques c on c.id = a.cheque_id
  where a.invoice_id = p_invoice and a.removed_at is null and c.status in ('in_hand', 'deposited', 'cleared')
    and not (c.status = 'in_hand' and c.cheque_date + 90 < public.india_today())
$$;

-- 8. A cheque could be cleared or bounced on a day before it was deposited.
create or replace function public.guard_cheque() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'in_hand' and (new.buyer_id, new.cheque_no, new.cheque_date, new.amount)
                                 is distinct from (old.buyer_id, old.cheque_no, old.cheque_date, old.amount)
     and not public.is_owner(old.company_id) then
    raise exception 'Cheque % has been deposited. Its number, date and amount can''t change.', old.cheque_no;
  end if;
  if new.buyer_id <> old.buyer_id and exists (select 1 from public.cheque_allocations where cheque_id = old.id and removed_at is null) then
    raise exception 'Cheque % is set against invoices, so its buyer can''t change.', old.cheque_no;
  end if;
  if new.status is distinct from old.status then
    if (old.status, new.status) not in (('in_hand', 'deposited'), ('in_hand', 'cleared'), ('in_hand', 'cancelled'),
                                         ('deposited', 'cleared'), ('deposited', 'bounced'), ('deposited', 'in_hand'))
       and not public.is_owner(old.company_id) then
      raise exception 'A % cheque can''t be marked %. Ask the owner to correct it.',
        replace(old.status, '_', ' '), replace(new.status, '_', ' ');
    end if;
    if new.status = 'in_hand' then
      new.deposited_on := null; new.cleared_on := null; new.bounced_on := null;
    elsif new.status = 'deposited' then
      new.deposited_on := coalesce(new.deposited_on, public.india_today()); new.cleared_on := null; new.bounced_on := null;
    elsif new.status = 'cleared' then
      new.cleared_on := coalesce(new.cleared_on, public.india_today());
      new.deposited_on := coalesce(new.deposited_on, new.cleared_on); new.bounced_on := null;
    elsif new.status = 'bounced' then
      new.bounced_on := coalesce(new.bounced_on, public.india_today()); new.cleared_on := null;
    end if;
    if new.status in ('deposited', 'cleared') and new.deposited_on < new.cheque_date then
      raise exception 'Cheque % is dated %, so it can''t be deposited before then.', new.cheque_no, to_char(new.cheque_date, 'DD Mon YYYY');
    end if;
  end if;
  if new.cleared_on < new.deposited_on or new.bounced_on < new.deposited_on then
    raise exception 'Cheque % was deposited on %, so it can''t clear or bounce before then.', new.cheque_no, to_char(new.deposited_on, 'DD Mon YYYY');
  end if;
  return new;
end $$;

-- 9. One credit note Payments couldn't take (for example on an invoice a cheque already pays in full) stopped the whole
--    "bring in from Tally" and nothing was brought in. It is now listed as skipped with the reason, and the rest come in.
create or replace function public.tally_import(p_guids text[]) returns jsonb
language plpgsql set search_path = '' as $$
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
    begin
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
    exception when others then
      v_skipped := v_skipped || format('%s: %s', v.number, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('invoices', v_inv_n, 'credit_notes', v_cn_n, 'skipped', to_jsonb(v_skipped));
end $$;

-- 10. The health check also watches file storage (the free plan has 1 GB, and QC reports fill it fast) and when the
--     Tally reader last actually read the books: it checks in every minute even when Tally can't be read.
create or replace function public.system_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_storage numeric;
begin
  if to_regclass('storage.objects') is not null then
    execute 'select round(coalesce(sum((metadata ->> ''size'')::bigint), 0) / 1048576.0) from storage.objects' into v_storage;
  end if;
  return jsonb_build_object(
    'tally_enabled', coalesce((select bool_or(enabled) from public.tally_settings), false),
    'tally_seen_hours', (select round(extract(epoch from now() - max(agent_seen_at)) / 3600, 1) from public.tally_settings where enabled),
    'tally_read_hours', (select round(extract(epoch from now() - max(snapshot_at)) / 3600, 1) from public.tally_settings where enabled),
    'email_hours', (select round(extract(epoch from now() - max(created_at)) / 3600, 1) from public.incoming_pos where source = 'email'),
    'failed_reads_24h', (select count(*) from public.incoming_pos where status = 'failed' and created_at > now() - interval '24 hours'),
    'db_mb', (select pg_database_size(current_database()) / 1048576),
    'storage_mb', v_storage);
end $$;
revoke execute on function public.system_health() from public;
grant execute on function public.system_health() to anon, authenticated;

-- 11. With no factory logins yet, a factory PO could never be released: only the factory itself could enter its
--     dates. When the factory agrees to the targets by phone or WhatsApp, the orders team can now enter them as the
--     factory's dates for it. The plan shows who entered it, and the factory can still change its dates in its panel
--     until release.
alter table public.factory_pos add column plan_entered_by uuid references public.profiles (id);
grant select (plan_entered_by) on public.factory_pos to authenticated;

create or replace function public.check_line_stage() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_factory uuid;
  v_released boolean;
begin
  select l.factory_id into v_factory from public.order_lines l
  where l.id = new.line_id and l.order_id = new.order_id and l.company_id = new.company_id;
  if not found then
    raise exception 'That style is not on this order.';
  end if;
  v_released := exists (select 1 from public.factory_pos f where f.order_id = new.order_id and f.factory_id = v_factory and f.released_at is not null);
  -- Who may change what applies to people; data loads run by the database owner have no signed-in person.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;
  if (new.planned_on is distinct from (case when tg_op = 'INSERT' then null else old.planned_on end)
      or new.not_needed is distinct from (case when tg_op = 'INSERT' then false else old.not_needed end)
      or new.label is distinct from (case when tg_op = 'INSERT'
        then (select x.label from public.line_stages x where x.line_id = new.line_id and x.stage = new.stage) else old.label end))
     and not public.can_edit_orders(new.company_id) then
    raise exception 'Only the orders team can change the plan.';
  end if;
  if new.factory_on is distinct from (case when tg_op = 'INSERT' then null else old.factory_on end) then
    -- accept_targets_for_factory sets this flag for its own transaction only.
    if public.my_factory() is distinct from v_factory
       and not (current_setting('sourcingo.plan_for_factory', true) = 'on' and public.can_edit_orders(new.company_id)) then
      raise exception 'Only the factory enters its own dates.';
    end if;
    if v_released then
      raise exception 'The PO is released, so the factory''s dates are fixed.';
    end if;
  end if;
  if new.done_on is not null and new.done_on is distinct from (case when tg_op = 'INSERT' then null else old.done_on end) then
    if not (public.can_edit_orders(new.company_id) or public.is_quality(new.company_id)) then
      raise exception 'Only the orders team and Quality enter done dates.';
    end if;
    if not v_released then
      raise exception 'Release the factory PO before entering done dates.';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create function public.accept_targets_for_factory(p_order uuid, p_factory uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_missing text;
begin
  select company_id into v_company from public.orders where id = p_order and status = 'open';
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can enter a factory''s plan on an open order.';
  end if;
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory
                 and (plan_requested_at is not null or plan_requested_on is not null)) then
    raise exception 'Ask the factory for its plan first, so its target date is set.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    raise exception 'The PO is already released.';
  end if;
  select string_agg(style || ' (' || steps || ')', '; ') into v_missing
  from public.tna_gaps(p_order, p_factory) where kind in ('target', 'beyond');
  if v_missing is not null then
    raise exception 'Set every target on or before the target date first: %', v_missing;
  end if;
  perform set_config('sourcingo.plan_for_factory', 'on', true);
  update public.line_stages s set factory_on = s.planned_on
  from public.order_lines l
  where l.id = s.line_id and l.order_id = p_order and l.factory_id = p_factory and l.removed_at is null
    and not s.not_needed and s.factory_on is distinct from s.planned_on;
  perform set_config('sourcingo.plan_for_factory', 'off', true);
  update public.factory_pos set factory_sent_at = now(), plan_entered_by = auth.uid()
  where order_id = p_order and factory_id = p_factory;
end $$;
revoke execute on function public.accept_targets_for_factory(uuid, uuid) from public, anon;
grant execute on function public.accept_targets_for_factory(uuid, uuid) to authenticated;

-- The factory sending its own plan clears the "entered by the orders team" mark.
create or replace function public.clear_plan_entered_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.factory_sent_at is distinct from old.factory_sent_at and public.my_factory() = new.factory_id then
    new.plan_entered_by := null;
  end if;
  return new;
end $$;
create trigger factory_pos_plan_entered_by before update on public.factory_pos
  for each row execute function public.clear_plan_entered_by();
