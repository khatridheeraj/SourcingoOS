-- POs received: every buyer purchase order that reaches Sourcingo by email,
-- kept as its own register. The team works each one from here: open an
-- inquiry for it, convert it into a sales order, or reject it.
--
-- The email pickup writes rows here (one per email thread). Staff only.

create type received_po_status as enum ('new','in_progress','converted','rejected');
create sequence received_po_seq;

create table received_pos (
  id              text primary key default 'RPO-' || lpad(nextval('received_po_seq')::text, 6, '0'),
  buyer_id        uuid not null references buyers(id),
  po_number       text not null check (btrim(po_number) <> ''),
  po_date         date,
  delivery_date   date,
  order_type      order_type not null default 'garment',
  currency        text check (currency in ('INR','USD','EUR','GBP')),
  payment_terms   text,
  sender_name     text,
  sender_email    text,
  email_thread_id text unique,
  received_at     timestamptz not null default now(),
  attachments     text[] not null default '{}',
  -- [{style_code, description, colour, qty, rate}], as read from the email body.
  lines           jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  notes           text,
  status          received_po_status not null default 'new',
  reject_reason   text,
  inquiry_id      text references inquiries(id) on delete set null,
  so_id           text references sales_orders(id) on delete set null,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint received_po_unique unique (buyer_id, po_number),
  constraint converted_has_order check (status <> 'converted' or so_id is not null),
  constraint rejected_has_reason check (status <> 'rejected' or nullif(btrim(reject_reason), '') is not null)
);
create index received_pos_status_idx on received_pos (status, received_at desc);

-- A PO that already has a sales order (same buyer and PO number) is linked to
-- it on arrival. If that order is later deleted, the PO goes back to the team.
create function link_received_po() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.po_number := btrim(new.po_number);
  if tg_op = 'INSERT' and new.so_id is null then
    select o.id into new.so_id from sales_orders o where o.buyer_id = new.buyer_id and o.buyer_po_number = new.po_number;
  end if;
  if new.so_id is not null and new.inquiry_id is null then
    select coalesce((select o.inquiry_id from sales_orders o where o.id = new.so_id),
                    (select i.id from inquiries i where i.so_id = new.so_id limit 1)) into new.inquiry_id;
  end if;
  if new.so_id is not null then new.status := 'converted'; new.reject_reason := null;
  elsif new.status = 'converted' then new.status := 'in_progress';
  end if;
  if new.status <> 'rejected' then new.reject_reason := null; end if;
  return new;
end $$;
create trigger link_received_po before insert or update on received_pos for each row execute function link_received_po();
create trigger touch_received_pos before update on received_pos for each row execute function touch_updated_at();

alter table received_pos enable row level security;
create policy "ops received pos" on received_pos for all using ((select is_ops())) with check ((select is_ops()));

-- Open an inquiry for a received PO, so the team can work it.
create function received_po_to_inquiry(p_po text) returns text
  language plpgsql set search_path = public as $$
declare r received_pos; v_id text; v_qty numeric; v_value numeric; v_first text;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can work on POs.'; end if;
  select * into r from received_pos where id = p_po for update;
  if not found then raise exception 'PO % not found.', p_po; end if;
  if r.inquiry_id is not null then raise exception 'PO % already has inquiry %.', r.po_number, r.inquiry_id; end if;
  select nullif(sum(nullif(l->>'qty', '')::numeric), 0),
         case when bool_and(nullif(l->>'qty', '') is not null and nullif(l->>'rate', '') is not null)
              then sum((l->>'qty')::numeric * (l->>'rate')::numeric) end,
         min(nullif(btrim(coalesce(l->>'description', '')), ''))
    into v_qty, v_value, v_first
    from jsonb_array_elements(r.lines) l;
  insert into inquiries (buyer_id, contact_person, contact_email, product_type, est_qty, unit, budget_inr,
                         status, next_follow_up, notes, so_id)
    values (r.buyer_id, coalesce(r.sender_name, ''), coalesce(r.sender_email, ''),
            coalesce(v_first || ' - PO ' || r.po_number, 'Buyer PO ' || r.po_number),
            v_qty, case when r.order_type = 'fabric' then 'm' else 'pcs' end,
            case when coalesce(r.currency, 'INR') = 'INR' then v_value end,
            case when r.so_id is null then 'new' else 'converted' end::inquiry_status,
            case when r.so_id is null then current_date + 1 end,
            concat_ws(E'\n', 'Buyer PO ' || r.po_number || ' received ' || to_char(r.received_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
                             || ' (' || r.id || ').', r.notes),
            r.so_id)
    returning id into v_id;
  update received_pos set inquiry_id = v_id, status = case when status = 'new' then 'in_progress' else status end where id = p_po;
  return v_id;
end $$;

-- Turn a received PO into a draft sales order: header, dates and any lines
-- from the email become styles with the standard TNA checkpoints.
create function convert_received_po(p_po text) returns text
  language plpgsql set search_path = public as $$
declare r received_pos; v_id text; v_inq text; l jsonb; v_style uuid; i int := 0;
        v_cps text[] := array['Fabric Sourcing','Cutting','Sewing','QC','Packing','Ready for Dispatch'];
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can work on POs.'; end if;
  select * into r from received_pos where id = p_po for update;
  if not found then raise exception 'PO % not found.', p_po; end if;
  if r.so_id is not null then raise exception 'PO % is already sales order %.', r.po_number, r.so_id; end if;
  select id into v_id from sales_orders where buyer_id = r.buyer_id and buyer_po_number = r.po_number;
  if v_id is not null then
    update received_pos set so_id = v_id where id = p_po;
    return v_id;
  end if;
  select id into v_inq from inquiries where id = r.inquiry_id and so_id is null;
  v_id := create_sales_order(r.buyer_id, r.po_number, r.order_type, v_inq);
  update sales_orders set
    so_date = coalesce(r.po_date, so_date),
    buyer_date = r.delivery_date,
    currency = coalesce(r.currency, currency),
    payment_terms = coalesce(nullif(btrim(r.payment_terms), ''), payment_terms),
    order_source = 'Email',
    remarks = concat_ws(E'\n', 'From ' || r.id || ' (buyer PO received by email).',
                        case when array_length(r.attachments, 1) > 0 then 'PO attachment(s): ' || array_to_string(r.attachments, ', ') end,
                        r.notes)
  where id = v_id;
  for l in select * from jsonb_array_elements(r.lines) loop
    insert into so_styles (so_id, position, name, code, colour, use_sizes, qty, buyer_rate, internal_note)
      values (v_id, i, coalesce(btrim(l->>'description'), ''), coalesce(btrim(l->>'style_code'), ''), coalesce(btrim(l->>'colour'), ''),
              false, coalesce(nullif(l->>'qty', '')::numeric, 0), coalesce(nullif(l->>'rate', '')::numeric, 0), 'From the buyer''s PO email')
      returning id into v_style;
    insert into tna_checkpoints (style_id, position, name) select v_style, k - 1, v_cps[k] from generate_subscripts(v_cps, 1) k;
    i := i + 1;
  end loop;
  if i = 0 then
    insert into so_styles (so_id, position, use_sizes) values (v_id, 0, r.order_type = 'garment') returning id into v_style;
    insert into tna_checkpoints (style_id, position, name) select v_style, k - 1, v_cps[k] from generate_subscripts(v_cps, 1) k;
  end if;
  update received_pos set so_id = v_id where id = p_po;
  return v_id;
end $$;

grant execute on function received_po_to_inquiry(text), convert_received_po(text) to authenticated;
