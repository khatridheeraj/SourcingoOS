-- Sales order editing in one call each, so a draft and its styles and TNA
-- checkpoints are always saved together. All functions run as the caller,
-- so row-level security and the lock guards from 0001 still apply.

-- Start a sales order, optionally from an inquiry. Payment terms, address and
-- merchandiser default from the buyer and the inquiry.
create function create_sales_order(p_buyer uuid, p_po_number text, p_order_type order_type default 'garment',
                                   p_inquiry text default null)
  returns text
  language plpgsql set search_path = public as $$
declare v_id text; v_b buyers; v_inq inquiries;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can create sales orders.'; end if;
  if nullif(btrim(p_po_number), '') is null then raise exception 'Enter the buyer PO / reference number.'; end if;
  select * into v_b from buyers where id = p_buyer;
  if not found then raise exception 'Choose the buyer.'; end if;
  if p_inquiry is not null then
    select * into v_inq from inquiries where id = p_inquiry;
    if not found then raise exception 'Inquiry % not found.', p_inquiry; end if;
    if v_inq.so_id is not null then raise exception 'Inquiry % already has sales order %.', p_inquiry, v_inq.so_id; end if;
    if v_inq.buyer_id <> p_buyer then raise exception 'That inquiry belongs to a different buyer.'; end if;
  end if;
  insert into sales_orders (buyer_id, buyer_po_number, order_type, inquiry_id, payment_terms, delivery_address, merchandiser_id, remarks)
    values (p_buyer, btrim(p_po_number), p_order_type, p_inquiry, v_b.default_payment_terms, v_b.default_address,
            v_inq.merchandiser_id, v_inq.notes)
    returning id into v_id;
  if p_inquiry is not null then
    update inquiries set status = 'converted', so_id = v_id where id = p_inquiry;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Buyer PO % is already used on another sales order for this buyer.', btrim(p_po_number);
end $$;

-- Save the whole draft: header, styles and checkpoints. Styles and
-- checkpoints missing from the payload are removed.
create function save_sales_order(p jsonb) returns void
  language plpgsql set search_path = public as $$
declare v_so text := p->>'id'; v_status so_status; s jsonb; c jsonb; v_style uuid; v_qty numeric;
        v_styles uuid[] := '{}'; v_cps uuid[]; i int := 0; j int;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can edit sales orders.'; end if;
  select status into v_status from sales_orders where id = v_so for update;
  if not found then raise exception 'Sales order % not found.', v_so; end if;
  if v_status not in ('draft', 'tna_review') then
    raise exception 'Sales order % is locked. Ask the owner to unlock it first.', v_so;
  end if;

  update sales_orders set
    buyer_id = (p->>'buyer_id')::uuid,
    buyer_po_number = btrim(p->>'buyer_po_number'),
    order_type = (p->>'order_type')::order_type,
    currency = p->>'currency',
    so_date = coalesce(nullif(p->>'so_date', '')::date, so_date),
    order_source = nullif(p->>'order_source', ''),
    tags = coalesce(array(select btrim(t) from jsonb_array_elements_text(p->'tags') t where btrim(t) <> ''), '{}'),
    factory_id = nullif(p->>'factory_id', '')::uuid,
    payment_terms = nullif(btrim(p->>'payment_terms'), ''),
    delivery_address = nullif(btrim(p->>'delivery_address'), ''),
    merchandiser_id = nullif(p->>'merchandiser_id', '')::uuid,
    manager_id = nullif(p->>'manager_id', '')::uuid,
    fabric_poc_id = nullif(p->>'fabric_poc_id', '')::uuid,
    quality_poc_id = nullif(p->>'quality_poc_id', '')::uuid,
    buyer_date = nullif(p->>'buyer_date', '')::date,
    factory_date = nullif(p->>'factory_date', '')::date,
    merch_date = nullif(p->>'merch_date', '')::date,
    remarks = nullif(btrim(p->>'remarks'), ''),
    terms = nullif(btrim(p->>'terms'), '')
  where id = v_so;

  for s in select * from jsonb_array_elements(coalesce(p->'styles', '[]')) loop
    v_style := (s->>'id')::uuid;
    v_styles := v_styles || v_style;
    v_qty := case when (s->>'use_sizes')::boolean and p->>'order_type' = 'garment'
                  then (select coalesce(sum(nullif(value, '')::numeric), 0) from jsonb_each_text(coalesce(s->'sizes', '{}')))
                  else coalesce(nullif(s->>'qty', '')::numeric, 0) end;
    insert into so_styles as t (id, so_id, position, name, code, fabric, colour, use_sizes, sizes, qty, buyer_rate, factory_rate, internal_note)
      values (v_style, v_so, i, coalesce(s->>'name', ''), coalesce(s->>'code', ''), coalesce(s->>'fabric', ''), coalesce(s->>'colour', ''),
              coalesce((s->>'use_sizes')::boolean, false) and p->>'order_type' = 'garment', coalesce(s->'sizes', '{}'), v_qty,
              coalesce(nullif(s->>'buyer_rate', '')::numeric, 0), nullif(s->>'factory_rate', '')::numeric, nullif(btrim(s->>'internal_note'), ''))
    on conflict (id) do update set
      position = excluded.position, name = excluded.name, code = excluded.code, fabric = excluded.fabric, colour = excluded.colour,
      use_sizes = excluded.use_sizes, sizes = excluded.sizes, qty = excluded.qty, buyer_rate = excluded.buyer_rate,
      factory_rate = excluded.factory_rate, internal_note = excluded.internal_note
    where t.so_id = v_so;
    if not found then raise exception 'Style % belongs to another order.', v_style; end if;

    v_cps := '{}'; j := 0;
    for c in select * from jsonb_array_elements(coalesce(s->'checkpoints', '[]')) loop
      v_cps := v_cps || (c->>'id')::uuid;
      insert into tna_checkpoints as t (id, style_id, position, name, due_date)
        values ((c->>'id')::uuid, v_style, j, btrim(coalesce(c->>'name', '')), nullif(c->>'due_date', '')::date)
      on conflict (id) do update set position = excluded.position, name = excluded.name, due_date = excluded.due_date
      where t.style_id = v_style;
      if not found then raise exception 'Checkpoint belongs to another style.'; end if;
      j := j + 1;
    end loop;
    delete from tna_checkpoints where style_id = v_style and id <> all(v_cps);
    i := i + 1;
  end loop;
  delete from so_styles where so_id = v_so and id <> all(v_styles);
exception when unique_violation then
  raise exception 'Buyer PO % is already used on another sales order for this buyer.', btrim(p->>'buyer_po_number');
end $$;

-- Delete a draft. Its inquiry goes back to Quoted so it can be converted again.
create function delete_draft_sales_order(p_so text) returns void
  language plpgsql set search_path = public as $$
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can delete drafts.'; end if;
  if not exists (select 1 from sales_orders where id = p_so and status = 'draft') then
    raise exception 'Only draft sales orders can be deleted.';
  end if;
  update inquiries set so_id = null, status = 'quoted' where so_id = p_so;
  delete from sales_orders where id = p_so;
end $$;

grant execute on function create_sales_order(uuid, text, order_type, text), save_sales_order(jsonb),
  delete_draft_sales_order(text) to authenticated;
