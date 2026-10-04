-- Warehouse documents saved in one call each, tighter GRN/DC rules, and
-- read access to sales orders for Accounts (they invoice from them).

-- ───────────────────────── accounts can read orders ─────────────────────────
create policy "internal read sales orders" on sales_orders    for select using ((select is_internal()));
create policy "internal read styles"       on so_styles       for select using ((select is_internal()));
create policy "internal read checkpoints"  on tna_checkpoints for select using ((select is_internal()));

-- ───────────────────────── sales order lock helpers ─────────────────────────
create function unlock_sales_order(p_so text) returns void
  language plpgsql set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can unlock a TNA.'; end if;
  if not exists (select 1 from sales_orders where id = p_so and status = 'locked') then
    raise exception 'Only a locked sales order can be unlocked.';
  end if;
  update sales_orders set status = 'tna_review', locked_at = null, locked_by = null where id = p_so;
end $$;

-- Draft <-> TNA review. Anyone who runs orders can move a draft along.
create function set_sales_order_review(p_so text, p_review boolean) returns void
  language plpgsql set search_path = public as $$
declare v so_status;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can change sales orders.'; end if;
  select status into v from sales_orders where id = p_so for update;
  if not found then raise exception 'Sales order % not found.', p_so; end if;
  if v not in ('draft', 'tna_review') then raise exception 'Sales order % is locked. Ask the owner to unlock it first.', p_so; end if;
  update sales_orders set status = case when p_review then 'tna_review'::so_status else 'draft'::so_status end where id = p_so;
end $$;

-- ───────────────────────── GRN rules ─────────────────────────
-- Quantities are fixed once a GRN is submitted.
create function guard_grn_lines_draft() returns trigger
  language plpgsql set search_path = public as $$
declare v grn_status;
begin
  select status into v from grns where id = coalesce(new.grn_id, old.grn_id);
  if v is not null and v <> 'draft' then
    raise exception 'GRN % has been submitted. Its quantities can''t change.', coalesce(new.grn_id, old.grn_id);
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_grn_lines_draft before insert or update or delete on grn_lines
  for each row execute function guard_grn_lines_draft();

-- A submitted GRN never goes back to draft; a rejected one is final; and a GRN
-- that goods were dispatched from can't be rejected.
create function guard_grn_status() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'rejected' then raise exception 'GRN % was rejected. Create a new GRN instead.', old.id; end if;
    if old.status <> 'draft' and new.status = 'draft' then raise exception 'GRN % has been submitted and can''t go back to draft.', old.id; end if;
    if new.status = 'rejected' and exists (select 1 from delivery_challans where grn_id = old.id) then
      raise exception 'Goods from % are already on a delivery challan, so it can''t be rejected.', old.id;
    end if;
  end if;
  if old.status <> 'draft' and (new.so_id, new.received_at) is distinct from (old.so_id, old.received_at) then
    raise exception 'GRN % has been submitted. Its order and received time can''t change.', old.id;
  end if;
  return new;
end $$;
create trigger guard_grn_status before update on grns for each row execute function guard_grn_status();

create policy "ops delete draft grns" on grns for delete using ((select is_ops()) and status = 'draft');

-- ───────────────────────── DC rules ─────────────────────────
create function guard_dc_lines_draft() returns trigger
  language plpgsql set search_path = public as $$
declare v dc_status;
begin
  select status into v from delivery_challans where id = coalesce(new.dc_id, old.dc_id);
  if v is not null and v <> 'draft' then
    raise exception '% has been dispatched. Its quantities can''t change.', coalesce(new.dc_id, old.dc_id);
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_dc_lines_draft before insert or update or delete on dc_lines
  for each row execute function guard_dc_lines_draft();

-- Same as 0001, plus: only submitted GRNs can be dispatched from.
create or replace function guard_dc_line() returns trigger
  language plpgsql set search_path = public as $$
declare v_grn text; v_status grn_status; v_in numeric; v_out numeric;
begin
  select grn_id into v_grn from delivery_challans where id = new.dc_id;
  select status into v_status from grns where id = v_grn;
  if v_status = 'rejected' then raise exception 'This GRN was rejected.'; end if;
  if v_status = 'draft' then raise exception 'Submit % for approval before dispatching from it.', v_grn; end if;
  select coalesce(sum(qty), 0) into v_in from grn_lines where grn_id = v_grn and style_id = new.style_id;
  select coalesce(sum(l.qty), 0) into v_out from dc_lines l join delivery_challans d on d.id = l.dc_id
   where d.grn_id = v_grn and l.style_id = new.style_id and l.id <> new.id;
  if v_out + new.qty > v_in then
    raise exception 'Only % available on % for this style.', v_in - v_out, v_grn;
  end if;
  return new;
end $$;

-- ───────────────────────── save in one call ─────────────────────────
-- p: {id?, so_id, received_at, received_by, qc_checked, qc_note, notes,
--     lines: [{style_id, qty, condition}], status: draft|pending_approval|approved}
create function save_grn(p jsonb) returns text
  language plpgsql set search_path = public as $$
declare v_id text := nullif(p->>'id', ''); v_status grn_status; l jsonb; v_any boolean := false;
        v_target grn_status := coalesce(nullif(p->>'status', ''), 'draft')::grn_status;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can record goods received.'; end if;
  if v_target = 'rejected' then raise exception 'Reject a GRN from its page.'; end if;
  if v_target = 'approved' and not is_owner() then raise exception 'Only the owner can approve a GRN.'; end if;
  if nullif(p->>'so_id', '') is null then raise exception 'Choose the sales order the goods are against.'; end if;
  if nullif(p->>'received_at', '') is null then raise exception 'Set the date and time the goods arrived.'; end if;
  if (p->>'received_at')::timestamptz > now() + interval '5 minutes' then raise exception 'Received time can''t be in the future.'; end if;
  if v_target <> 'draft' and nullif(p->>'received_by', '') is null then raise exception 'Choose who received the goods.'; end if;

  if v_id is null then
    insert into grns (so_id, received_at, received_by, qc_checked, qc_note, notes)
      values (p->>'so_id', (p->>'received_at')::timestamptz, nullif(p->>'received_by', '')::uuid,
              coalesce((p->>'qc_checked')::boolean, false), nullif(btrim(p->>'qc_note'), ''), nullif(btrim(p->>'notes'), ''))
      returning id into v_id;
  else
    select status into v_status from grns where id = v_id for update;
    if not found then raise exception 'GRN % not found.', v_id; end if;
    if v_status <> 'draft' then raise exception 'GRN % has already been submitted.', v_id; end if;
    update grns set so_id = p->>'so_id', received_at = (p->>'received_at')::timestamptz,
                    received_by = nullif(p->>'received_by', '')::uuid, qc_checked = coalesce((p->>'qc_checked')::boolean, false),
                    qc_note = nullif(btrim(p->>'qc_note'), ''), notes = nullif(btrim(p->>'notes'), '')
     where id = v_id;
    delete from grn_lines where grn_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    continue when coalesce(nullif(l->>'qty', '')::numeric, 0) = 0;
    if (l->>'qty')::numeric < 0 then raise exception 'Quantities can''t be negative.'; end if;
    insert into grn_lines (grn_id, style_id, qty, condition)
      values (v_id, (l->>'style_id')::uuid, (l->>'qty')::numeric, coalesce(nullif(l->>'condition', ''), 'good')::goods_condition);
    v_any := true;
  end loop;
  if not v_any and v_target <> 'draft' then raise exception 'Enter the received quantity for at least one style.'; end if;

  if v_target <> 'draft' then update grns set status = v_target where id = v_id; end if;
  return v_id;
end $$;

-- p: {id?, grn_id, courier, tracking, address, invoice_no, invoice_date,
--     dispatched_at, lines: [{style_id, qty}], status: draft|dispatched}
create function save_dc(p jsonb) returns text
  language plpgsql set search_path = public as $$
declare v_id text := nullif(p->>'id', ''); v_status dc_status; g grns; l jsonb; v_any boolean := false;
        v_dispatch boolean := p->>'status' = 'dispatched'; v_at timestamptz := nullif(p->>'dispatched_at', '')::timestamptz;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can create delivery challans.'; end if;
  select * into g from grns where id = p->>'grn_id';
  if not found then raise exception 'Choose the GRN you''re dispatching from. You can only dispatch goods that have a GRN.'; end if;
  if g.status = 'rejected' then raise exception '% was rejected. Goods can''t be dispatched from it.', g.id; end if;
  if g.status = 'draft' then raise exception 'Submit % for approval before dispatching from it.', g.id; end if;
  if v_dispatch then
    if nullif(btrim(p->>'courier'), '') is null then raise exception 'Enter the courier or transporter name.'; end if;
    if nullif(btrim(p->>'tracking'), '') is null then raise exception 'Enter the tracking / LR number.'; end if;
    if nullif(btrim(p->>'address'), '') is null then raise exception 'Enter the destination address.'; end if;
    if nullif(btrim(p->>'invoice_no'), '') is null then raise exception 'Enter the buyer invoice number. Invoice and dispatch go together.'; end if;
    if nullif(p->>'invoice_date', '') is null then raise exception 'Set the invoice date.'; end if;
    if v_at is null then raise exception 'Set the dispatch date and time.'; end if;
    if v_at < g.received_at then raise exception 'Dispatch time can''t be before the goods were received.'; end if;
    if v_at > now() + interval '5 minutes' then raise exception 'Dispatch time can''t be in the future.'; end if;
  end if;

  if v_id is null then
    insert into delivery_challans (grn_id, so_id, courier, tracking, address, invoice_no, invoice_date)
      values (g.id, g.so_id, nullif(btrim(p->>'courier'), ''), nullif(btrim(p->>'tracking'), ''), nullif(btrim(p->>'address'), ''),
              nullif(btrim(p->>'invoice_no'), ''), nullif(p->>'invoice_date', '')::date)
      returning id into v_id;
  else
    select status into v_status from delivery_challans where id = v_id for update;
    if not found then raise exception 'Delivery challan % not found.', v_id; end if;
    if v_status <> 'draft' then raise exception '% has already been dispatched.', v_id; end if;
    update delivery_challans set grn_id = g.id, so_id = g.so_id, courier = nullif(btrim(p->>'courier'), ''),
           tracking = nullif(btrim(p->>'tracking'), ''), address = nullif(btrim(p->>'address'), ''),
           invoice_no = nullif(btrim(p->>'invoice_no'), ''), invoice_date = nullif(p->>'invoice_date', '')::date
     where id = v_id;
    delete from dc_lines where dc_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    continue when coalesce(nullif(l->>'qty', '')::numeric, 0) = 0;
    if (l->>'qty')::numeric < 0 then raise exception 'Quantities can''t be negative.'; end if;
    insert into dc_lines (dc_id, style_id, qty) values (v_id, (l->>'style_id')::uuid, (l->>'qty')::numeric);
    v_any := true;
  end loop;
  if not v_any then raise exception 'Enter a dispatch quantity for at least one style.'; end if;

  if v_dispatch then
    update delivery_challans set status = 'dispatched', dispatched_at = v_at where id = v_id;
  end if;
  return v_id;
end $$;

grant execute on function unlock_sales_order(text), set_sales_order_review(text, boolean),
  save_grn(jsonb), save_dc(jsonb) to authenticated;
