-- Factory purchase orders: the PO Sourcingo issues to the factory when the
-- owner locks a TNA. Each PO is a snapshot of the styles, quantities, factory
-- rates and TNA dates at that moment, so what the factory accepted never
-- changes under it. Re-issuing makes a new revision and supersedes the old one.

create type fpo_status as enum ('issued','accepted','declined','superseded','cancelled');
create sequence fpo_seq;

create table factory_pos (
  id             text primary key default 'FPO-' || lpad(nextval('fpo_seq')::text, 6, '0'),
  so_id          text not null references sales_orders(id) on delete cascade,
  factory_id     uuid not null references factories(id),
  revision       int  not null default 1 check (revision > 0),
  status         fpo_status not null default 'issued',
  currency       text not null default 'INR',
  delivery_date  date,
  payment_terms  text,
  terms          text,
  -- [{style_id, name, code, fabric, colour, use_sizes, sizes, qty, rate, steps: [{name, due_date}]}]
  lines          jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  total_qty      numeric not null default 0,
  total_value    numeric,                       -- null while a style has no factory rate
  issued_at      timestamptz not null default now(),
  issued_by      uuid references profiles(id) default auth.uid(),
  responded_at   timestamptz,
  responded_by   uuid references profiles(id),
  response_note  text check (length(response_note) <= 500),
  created_at     timestamptz not null default now(),
  constraint fpo_revision_unique unique (so_id, revision)
);
create unique index factory_pos_one_live on factory_pos (so_id) where status in ('issued','accepted');
create index factory_pos_factory_idx on factory_pos (factory_id, status);
create trigger audit_factory_pos after insert or update or delete on factory_pos for each row execute function write_audit();

-- The snapshot never changes; only the status and the factory's answer do.
create function guard_factory_po() returns trigger
  language plpgsql set search_path = public as $$
begin
  if (new.so_id, new.factory_id, new.revision, new.currency, new.delivery_date, new.payment_terms, new.terms, new.lines,
      new.total_qty, new.total_value, new.issued_at, new.issued_by)
     is distinct from
     (old.so_id, old.factory_id, old.revision, old.currency, old.delivery_date, old.payment_terms, old.terms, old.lines,
      old.total_qty, old.total_value, old.issued_at, old.issued_by) then
    raise exception 'A factory PO can''t be edited. Issue a new revision instead.';
  end if;
  if old.status in ('superseded','cancelled') and new.status is distinct from old.status then
    raise exception '% is closed.', old.id;
  end if;
  return new;
end $$;
create trigger guard_factory_po before update on factory_pos for each row execute function guard_factory_po();

-- Issue (or re-issue) the factory PO for a locked sales order.
create function issue_factory_po(p_so text) returns text
  language plpgsql set search_path = public as $$
declare o sales_orders; v_id text; v_rev int; v_lines jsonb; v_qty numeric; v_value numeric; v_pay text; v_terms text;
begin
  if not is_ops() then raise exception 'Only merchandisers, managers, QC and the owner can issue factory POs.'; end if;
  select * into o from sales_orders where id = p_so for update;
  if not found then raise exception 'Sales order % not found.', p_so; end if;
  if o.status <> 'locked' then raise exception 'Lock the TNA for % before issuing the factory PO.', p_so; end if;
  if o.factory_id is null then raise exception 'Choose the factory for % first.', p_so; end if;
  if not exists (select 1 from so_styles where so_id = p_so) then raise exception '% has no styles to order.', p_so; end if;

  select coalesce(max(revision), 0) + 1 into v_rev from factory_pos where so_id = p_so;
  update factory_pos set status = 'superseded' where so_id = p_so and status in ('issued','accepted');

  select jsonb_agg(jsonb_build_object(
           'style_id', s.id, 'name', s.name, 'code', s.code, 'fabric', s.fabric, 'colour', s.colour,
           'use_sizes', s.use_sizes, 'sizes', s.sizes, 'qty', s.qty, 'rate', s.factory_rate,
           'steps', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'due_date', c.due_date) order by c.position)
                                from tna_checkpoints c where c.style_id = s.id), '[]'::jsonb))
         order by s.position),
         sum(s.qty),
         case when bool_and(s.factory_rate is not null) then sum(s.qty * s.factory_rate) end
    into v_lines, v_qty, v_value
    from so_styles s where s.so_id = p_so;
  select default_payment_terms into v_pay from factories where id = o.factory_id;
  select po_terms into v_terms from company_profile;

  insert into factory_pos (so_id, factory_id, revision, currency, delivery_date, payment_terms, terms, lines, total_qty, total_value)
    values (p_so, o.factory_id, v_rev, o.currency, o.factory_date, v_pay,
            nullif(concat_ws(E'\n\n', nullif(btrim(o.terms), ''), nullif(btrim(v_terms), '')), ''),
            v_lines, coalesce(v_qty, 0), v_value)
    returning id into v_id;
  return v_id;
end $$;
grant execute on function issue_factory_po(text) to authenticated;

-- Locking a TNA issues the PO; unlocking it withdraws the live PO.
create function fpo_on_lock() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.status = 'locked' and old.status in ('draft','tna_review') and new.factory_id is not null then
    perform issue_factory_po(new.id);
  elsif old.status = 'locked' and new.status in ('draft','tna_review') then
    update factory_pos set status = 'cancelled' where so_id = new.id and status in ('issued','accepted');
  end if;
  return new;
end $$;
create trigger fpo_on_lock after update of status on sales_orders for each row execute function fpo_on_lock();

-- The factory (or Sourcingo on its behalf, after a call) accepts or declines.
create function respond_factory_po(p_id text, p_accept boolean, p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare v factory_pos; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v from factory_pos where id = p_id for update;
  if not found or not (is_ops() or (my_factory_id() is not null and v.factory_id = my_factory_id())) then
    raise exception 'You do not have access to this purchase order.';
  end if;
  if v.status <> 'issued' then raise exception 'This purchase order is already %.', v.status; end if;
  if not p_accept and v_note is null then raise exception 'Say why it can''t be accepted, so Sourcingo can sort it out.'; end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  update factory_pos set status = case when p_accept then 'accepted'::fpo_status else 'declined'::fpo_status end,
         responded_at = now(), responded_by = auth.uid(), response_note = v_note
   where id = p_id;
end $$;
grant execute on function respond_factory_po(text, boolean, text) to authenticated;

alter table factory_pos enable row level security;
create policy "internal read factory pos" on factory_pos for select using ((select is_internal()));
create policy "ops issue factory pos"     on factory_pos for insert with check ((select is_ops()));
create policy "ops update factory pos"    on factory_pos for update using ((select is_ops())) with check ((select is_ops()));

-- The factory sees its own POs, never other factories' or the buyer's name.
create view portal_factory_pos as
  select p.id, p.so_id, b.code as buyer_code, p.revision, p.status, p.currency, p.delivery_date, p.payment_terms, p.terms,
         p.lines, p.total_qty, p.total_value, p.issued_at, p.responded_at, p.response_note
    from factory_pos p join sales_orders o on o.id = p.so_id join buyers b on b.id = o.buyer_id
   where p.factory_id = my_factory_id() and p.status <> 'superseded';
revoke all on portal_factory_pos from anon;
grant select on portal_factory_pos to authenticated;
