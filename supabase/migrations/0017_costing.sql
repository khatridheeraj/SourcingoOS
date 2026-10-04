-- Cost sheets and quotes on inquiries. One cost sheet per style quoted:
-- the factory's price per piece plus Sourcingo's own costs per piece, an
-- overhead share and a target margin give a suggested price; the quoted
-- price is what the buyer is offered. Accepted sheets become the styles of
-- the sales order, with buyer and factory rates filled in.

create sequence costing_seq;
create table costings (
  id            text primary key default 'CST-' || lpad(nextval('costing_seq')::text, 6, '0'),
  inquiry_id    text not null references inquiries(id) on delete cascade,
  style_name    text not null check (btrim(style_name) <> '' and length(style_name) <= 120),
  currency      text not null default 'INR' check (currency in ('INR','USD','EUR','GBP')),
  qty           numeric check (qty is null or qty >= 0),
  factory_id    uuid references factories(id),
  factory_cost  numeric not null default 0 check (factory_cost >= 0),
  -- Sourcingo's own costs per piece: [{"label": "Freight", "amount": 4.5}]
  extras        jsonb not null default '[]' check (jsonb_typeof(extras) = 'array'),
  overhead_pct  numeric not null default 0 check (overhead_pct >= 0 and overhead_pct <= 100),
  margin_pct    numeric not null default 15 check (margin_pct >= 0 and margin_pct < 100),
  quoted_price  numeric check (quoted_price is null or quoted_price >= 0),
  status        text not null default 'draft' check (status in ('draft','quoted','accepted','rejected')),
  notes         text check (length(notes) <= 2000),
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index costings_inquiry_idx on costings (inquiry_id);

create function guard_costing() returns trigger
  language plpgsql set search_path = public as $$
declare e jsonb;
begin
  new.style_name := btrim(new.style_name);
  for e in select * from jsonb_array_elements(new.extras) loop
    if nullif(btrim(e->>'label'), '') is null then raise exception 'Every extra cost needs a name.'; end if;
    if (e->>'amount') is null or (e->>'amount') !~ '^\d+(\.\d+)?$' then raise exception 'Extra cost "%": enter an amount of 0 or more.', e->>'label'; end if;
  end loop;
  if new.status in ('quoted','accepted') and new.quoted_price is null then
    raise exception 'Enter the price you quoted before marking it %.', new.status;
  end if;
  -- Quoting moves a new inquiry to Quoted.
  if new.status = 'quoted' and (tg_op = 'INSERT' or old.status is distinct from 'quoted') then
    update inquiries set status = 'quoted' where id = new.inquiry_id and status = 'new';
  end if;
  return new;
end $$;
create trigger guard_costing before insert or update on costings for each row execute function guard_costing();
create trigger touch_costings before update on costings for each row execute function touch_updated_at();
create trigger audit_costings after insert or update or delete on costings for each row execute function write_audit();

alter table costings enable row level security;
create policy "ops costings" on costings for all using ((select is_ops())) with check ((select is_ops()));
