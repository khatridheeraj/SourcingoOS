-- Buyer details become a switch, like Money (0118), held by the database itself.
-- The owner asked that the assistant merchandiser runs orders but sees nothing about buyers. Orders keep working:
-- someone without "Buyer details" sees each buyer by its code (BYR-FL-0003), never its real name, and none of:
--   buyer names, contacts and links, the buyer's messages and claims, buyer emails and uploaded POs, inquiries and
--   costings (leads), buyer ratings, buyer PO files, weekly buyer updates, buyer referral codes, the buyer's city,
--   notes and delivery address, the selling price (buyer rate) and margins, Dispatch (our invoice to the buyer and
--   the shipment to them), and the history of any of those.
-- Owner, Manager, Merchandiser and Accounts have it unless the owner switches it off; Quality does not (Quality
-- keeps reading claims and ratings, which are about the goods). Factory and buyer logins never have it.

-- ---------------------------------------------------------------- 1. the switch
create or replace function public.perm_default(p_role text, p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_key
    when 'money' then p_role in ('owner', 'accounts')
    when 'export' then p_role in ('owner', 'accounts')
    when 'buyers' then p_role in ('owner', 'manager', 'merchandiser', 'accounts')
    else false end
$$;

-- Anyone's switch, for the jobs that run for a person (morning brief, bell, evening email). Not callable from the app.
create function public.perm_for(p_company uuid, p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when m.role = 'owner' then true
                when m.role in ('factory', 'buyer') then false
                else coalesce((m.perms ->> p_key)::boolean, public.perm_default(m.role, p_key)) end
    from public.members m where m.company_id = p_company and m.user_id = p_user and m.active), false)
$$;
revoke execute on function public.perm_for(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.my_perm(p_company uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$ select public.perm_for(p_company, auth.uid(), p_key) $$;

create function public.can_see_buyers(p_company uuid) returns boolean
language sql stable set search_path = '' as $$ select public.my_perm(p_company, 'buyers') $$;
revoke execute on function public.can_see_buyers(uuid) from public, anon;
grant execute on function public.can_see_buyers(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. functions: a guard or a hidden name where buyers show
-- Each change is an exact piece of text in the function as it stands; if any piece is missing, the whole migration stops.
do $$
declare
  p record;
  v_def text;
  i integer;
begin
  for p in select * from (values
    ('public.set_member_perms(uuid,jsonb)'::regprocedure, array[
      $a$v_key not in ('money', 'export')$a$, $b$v_key not in ('money', 'export', 'buyers')$b$]),
    ('public.add_buyer_person(uuid,text,text,text,text)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.buyer_link(uuid,boolean)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.buyer_person_link(uuid,boolean)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.stop_buyer_person(uuid)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.make_buyer_from_inquiry(uuid)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.mark_buyer_update_sent(uuid,text)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.send_costing(uuid,jsonb,numeric,numeric,date,text)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.set_buyer_delivery(uuid,text)'::regprocedure, array[
      'not public.can_edit_orders(v_company)', 'not (public.can_edit_orders(v_company) and public.can_see_buyers(v_company))']),
    ('public.decide_buyer_claim(uuid,text,numeric,text,boolean)'::regprocedure, array[
      'not public.can_edit_orders(v_c.company_id)', 'not (public.can_edit_orders(v_c.company_id) and public.can_see_buyers(v_c.company_id))']),
    ('public.answer_buyer(uuid,text)'::regprocedure, array[
      'not public.is_member(v_company)', 'not public.can_see_buyers(v_company)']),
    ('public.buyer_messages_done(uuid)'::regprocedure, array[
      'not public.is_member(public.current_company())', 'not public.can_see_buyers(public.current_company())']),
    ('public.guarantee_orders()'::regprocedure, array[
      'not public.is_finance(v_company)', 'not (public.is_finance(v_company) and public.can_see_buyers(v_company))']),
    ('public.order_margins()'::regprocedure, array[
      'not public.is_finance(v_company)', 'not (public.is_finance(v_company) and public.can_see_buyers(v_company))']),
    ('public.line_prices(uuid[])'::regprocedure, array[
      'select l.id, l.buyer_rate,', 'select l.id, case when public.can_see_buyers(l.company_id) then l.buyer_rate end,']),
    ('public.guarantee_claims()'::regprocedure, array[
      'not public.is_member(v_company)', 'not (public.can_see_buyers(v_company) or public.is_quality(v_company))',
      'coalesce(n.real_name, b.code)', 'coalesce(case when public.can_see_buyers(v_company) then n.real_name end, b.code)',
      $a$'buyer_rate', case when public.can_edit_orders(v_company)$a$, $b$'buyer_rate', case when public.can_see_buyers(v_company)$b$]),
    ('public.can_see_incoming_po(uuid,text,text,uuid)'::regprocedure, array[
      'select public.can_edit_orders(p_company)', 'select public.can_edit_orders(p_company) and public.can_see_buyers(p_company)']),
    ('public.can_read_order_file(text)'::regprocedure, array[
      'return public.can_edit_orders(v_parts[1]::uuid) or public.buyer_owns_inquiry',
      'return (public.can_edit_orders(v_parts[1]::uuid) and public.can_see_buyers(v_parts[1]::uuid)) or public.buyer_owns_inquiry',
      $a$v_parts[3] is distinct from 'dispatch' or public.can_edit_orders(v_parts[1]::uuid);$a$,
      $b$v_parts[3] is distinct from 'dispatch' or (public.can_edit_orders(v_parts[1]::uuid) and public.can_see_buyers(v_parts[1]::uuid));$b$]),
    ('public.can_read_po_file(text)'::regprocedure, array[
      'if not public.can_edit_orders(v_parts[1]::uuid) then',
      'if not (public.can_edit_orders(v_parts[1]::uuid) and public.can_see_buyers(v_parts[1]::uuid)) then']),
    ('public.brief_data_base(uuid)'::regprocedure, array[
      'coalesce((select n.real_name from public.buyer_names n where n.buyer_id = o.buyer_id), b.code)',
      $b$coalesce((select n.real_name from public.buyer_names n where n.buyer_id = o.buyer_id and public.perm_for(v_company, p_user, 'buyers')), b.code)$b$,
      $a$case when v_role <> 'quality' then$a$, $b$case when v_role <> 'quality' and public.perm_for(v_company, p_user, 'buyers') then$b$]),
    ('public.brief_data_for(uuid)'::regprocedure, array[
      $a$and (v_role = 'owner' or i.merchandiser_id is null or i.merchandiser_id = p_user)), '[]'::jsonb),$a$,
      $b$and (v_role = 'owner' or i.merchandiser_id is null or i.merchandiser_id = p_user) and public.perm_for(v_company, p_user, 'buyers')), '[]'::jsonb),$b$]),
    ('public.bell_for(uuid,timestamptz,integer)'::regprocedure, array[
      'v_orders boolean;', 'v_orders boolean;' || chr(10) || '  v_buyers boolean;',
      $a$v_orders := v_role <> 'quality';$a$, $b$v_orders := v_role <> 'quality';$b$ || chr(10) || $b$  v_buyers := public.perm_for(v_company, p_user, 'buyers');$b$,
      'coalesce(n.real_name, b.code)', 'coalesce(case when v_buyers then n.real_name end, b.code)',
      'where v_orders and m.company_id', 'where v_orders and v_buyers and m.company_id',
      'where v_orders and c.company_id', 'where v_orders and v_buyers and c.company_id',
      $a$and ((v_orders and i.status = 'to_check')$a$, $b$and v_buyers and ((v_orders and i.status = 'to_check')$b$,
      'where v_orders and u.company_id', 'where v_orders and v_buyers and u.company_id',
      'where v_orders and i.company_id = v_company and i.created_at', 'where v_orders and v_buyers and i.company_id = v_company and i.created_at',
      'where v_orders and i.company_id = v_company and i.buyer_answer_at', 'where v_orders and v_buyers and i.company_id = v_company and i.buyer_answer_at'])
  ) as t (fn, pairs) loop
    v_def := pg_get_functiondef(p.fn);
    for i in 1 .. array_length(p.pairs, 1) by 2 loop
      if position(p.pairs[i] in v_def) = 0 then
        raise exception 'Buyer details switch: "%" not found in %', p.pairs[i], p.fn;
      end if;
      v_def := replace(v_def, p.pairs[i], p.pairs[i + 1]);
    end loop;
    execute v_def;
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. tables
alter policy buyer_names_staff_read on public.buyer_names using (public.can_see_buyers(company_id));
alter policy buyer_people_read on public.buyer_people using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy buyer_links_read on public.buyer_links using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy buyer_updates_read on public.buyer_updates using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy buyer_po_uploads_read on public.buyer_po_uploads using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy buyer_messages_read on public.buyer_messages using (public.can_see_buyers(company_id));
alter policy buyer_claims_read on public.buyer_claims using (public.can_see_buyers(company_id) or public.is_quality(company_id));
alter policy order_ratings_read on public.order_ratings using (public.can_see_buyers(company_id) or public.is_quality(company_id));
alter policy order_po_files_read on public.order_po_files using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy referral_codes_read on public.referral_codes using (public.can_edit_orders(company_id) and (buyer_id is null or public.can_see_buyers(company_id)));
alter policy inquiries_read on public.inquiries using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy inquiries_update on public.inquiries using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy inquiries_insert on public.inquiries with check (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy inquiry_costings_read on public.inquiry_costings using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy inquiry_notes_read on public.inquiry_notes using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy inquiry_notes_insert on public.inquiry_notes with check (
  public.can_edit_orders(company_id) and public.can_see_buyers(company_id) and created_by = auth.uid()
  and exists (select 1 from public.inquiries i where i.id = inquiry_notes.inquiry_id and i.company_id = inquiry_notes.company_id));
alter policy incoming_pos_upload on public.incoming_pos with check (
  public.can_edit_orders(company_id) and public.can_see_buyers(company_id) and source = 'upload' and status = 'reading' and created_by = auth.uid());

-- Dispatch is the factory's bill, our invoice to the buyer (with its selling price), the buyer's address and the
-- shipment to the buyer: it goes with Buyer details.
alter policy dispatches_read on public.dispatches using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy dispatch_lines_read on public.dispatch_lines using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy dispatch_photos_read on public.dispatch_photos using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy packing_rows_read on public.packing_rows using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));
alter policy shipment_events_read on public.shipment_events using (public.can_edit_orders(company_id) and public.can_see_buyers(company_id));

-- The buyer's city, notes and delivery address come through buyer_details(); everyone keeps the code.
revoke select (city, notes, delivery_address) on public.buyers from authenticated;
create function public.buyer_details(p_ids uuid[] default null) returns table (id uuid, city text, notes text, delivery_address text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.city, b.notes, b.delivery_address from public.buyers b
  where b.company_id = public.current_company() and public.can_see_buyers(b.company_id) and (p_ids is null or b.id = any (p_ids))
$$;
revoke execute on function public.buyer_details(uuid[]) from public, anon;
grant execute on function public.buyer_details(uuid[]) to authenticated;

-- Selling prices stay as they are when someone without Buyer details saves an order: they never see them, so they
-- can't change or clear them, and a style they add starts without one.
create function public.keep_hidden_buyer_rate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and public.is_member(new.company_id) and not public.can_see_buyers(new.company_id) then
    new.buyer_rate := case when tg_op = 'UPDATE' then old.buyer_rate end;
  end if;
  return new;
end $$;
create trigger order_lines_keep_buyer_rate before insert or update of buyer_rate on public.order_lines
  for each row execute function public.keep_hidden_buyer_rate();

-- History: no history of buyer records (or of order lines, which carry the selling price) without Buyer details.
alter policy history_read on public.history using (
  company_id = (select public.current_company())
  and ((select public.my_role(public.current_company())) = 'owner'
    or (table_name <> all (array['buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys'])
      and ((select public.my_role(public.current_company())) = 'accounts'
        or ((select public.my_role(public.current_company())) = any (array['manager', 'merchandiser', 'quality'])
          and table_name <> all (array['invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                                       'buyers', 'tally_ledgers', 'tally_items', 'supplier_terms', 'bill_notes', 'factory_claims'])
          and ((select public.my_role(public.current_company())) <> 'quality'
            or table_name <> all (array['order_lines', 'dispatch_lines', 'dispatches', 'dispatch_photos']))))
      and ((select public.can_see_buyers(public.current_company()))
        or table_name <> all (array['order_lines', 'buyer_people', 'buyer_links', 'buyer_messages', 'buyer_claims', 'buyer_updates',
                                    'buyer_po_uploads', 'inquiries', 'inquiry_notes', 'inquiry_costings', 'order_ratings',
                                    'order_po_files', 'referral_codes', 'dispatches', 'dispatch_lines', 'dispatch_photos',
                                    'packing_rows', 'shipment_events'])))));
