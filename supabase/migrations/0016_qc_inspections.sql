-- QC inspections: inline, midline and final checks at the factory, judged by
-- AQL (ANSI/ASQ Z1.4, general inspection level II, normal single sampling).
-- The database decides pass / fail / hold from the counts, so a result can't
-- be typed in by hand. Factories see the inspections of their own orders.

create type qc_kind as enum ('inline','midline','final');
create type qc_result as enum ('pass','fail','hold');
create sequence qc_seq;

-- Accept number for a sample size and AQL (2.5 or 4.0, the levels Sourcingo uses).
create function qc_accept(p_sample int, p_aql numeric) returns int
  language sql immutable set search_path = public as $$
  select case when p_aql >= 4.0 then a40 else a25 end
    from (values (2, 0, 0), (3, 0, 0), (5, 0, 0), (8, 0, 1), (13, 1, 1), (20, 1, 2), (32, 2, 3), (50, 3, 5), (80, 5, 7),
                 (125, 7, 10), (200, 10, 14), (315, 14, 21), (500, 21, 21), (800, 21, 21), (1250, 21, 21)) t(n, a25, a40)
   where n <= greatest(p_sample, 2)
   order by n desc limit 1
$$;

-- Sample size for a lot (code letters A to Q, level II).
create function qc_sample_size(p_lot int) returns int
  language sql immutable set search_path = public as $$
  select least(greatest(p_lot, 1), case
    when p_lot <= 8 then 2 when p_lot <= 15 then 3 when p_lot <= 25 then 5 when p_lot <= 50 then 8
    when p_lot <= 90 then 13 when p_lot <= 150 then 20 when p_lot <= 280 then 32 when p_lot <= 500 then 50
    when p_lot <= 1200 then 80 when p_lot <= 3200 then 125 when p_lot <= 10000 then 200 when p_lot <= 35000 then 315
    when p_lot <= 150000 then 500 when p_lot <= 500000 then 800 else 1250 end)
$$;

create table qc_inspections (
  id               text primary key default 'QC-' || lpad(nextval('qc_seq')::text, 6, '0'),
  so_id            text not null references sales_orders(id) on delete cascade,
  style_id         uuid not null references so_styles(id) on delete cascade,
  kind             qc_kind not null,
  inspected_on     date not null default current_date,
  inspector_id     uuid references profiles(id) default auth.uid(),
  lot_qty          int  not null check (lot_qty > 0),
  sample_size      int  not null check (sample_size > 0),
  aql_major        numeric not null default 2.5 check (aql_major in (2.5, 4.0)),
  aql_minor        numeric not null default 4.0 check (aql_minor in (2.5, 4.0)),
  -- [{"name": "Open seam", "severity": "major", "count": 2}]
  defects          jsonb not null default '[]' check (jsonb_typeof(defects) = 'array'),
  critical         int  not null default 0 check (critical >= 0),
  major            int  not null default 0 check (major >= 0),
  minor            int  not null default 0 check (minor >= 0),
  measurements_ok  boolean,
  packing_ok       boolean,
  result           qc_result not null default 'hold',
  notes            text check (length(notes) <= 2000),
  created_by       uuid references profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint qc_sample_fits_lot check (sample_size <= lot_qty)
);
create index qc_inspections_so_idx on qc_inspections (so_id);
create index qc_inspections_style_idx on qc_inspections (style_id);

-- Counts come from the defect list and the result from the AQL table.
create function guard_qc() returns trigger
  language plpgsql set search_path = public as $$
declare d jsonb; v_so text; v_status so_status;
begin
  select st.so_id, o.status into v_so, v_status from so_styles st join sales_orders o on o.id = st.so_id where st.id = new.style_id;
  if v_so is distinct from new.so_id then raise exception 'That style is not on %.', new.so_id; end if;
  if v_status not in ('locked','shipped') then raise exception 'Inspect an order once its TNA is locked.'; end if;
  if new.inspected_on > current_date + 1 then raise exception 'The inspection date can''t be in the future.'; end if;
  new.critical := 0; new.major := 0; new.minor := 0;
  for d in select * from jsonb_array_elements(new.defects) loop
    if nullif(btrim(d->>'name'), '') is null then raise exception 'Every defect needs a name.'; end if;
    if (d->>'count') is null or (d->>'count') !~ '^\d+$' then raise exception 'Defect "%": count must be a whole number.', d->>'name'; end if;
    case d->>'severity'
      when 'critical' then new.critical := new.critical + (d->>'count')::int;
      when 'major' then new.major := new.major + (d->>'count')::int;
      when 'minor' then new.minor := new.minor + (d->>'count')::int;
      else raise exception 'Defect "%": severity must be critical, major or minor.', d->>'name';
    end case;
  end loop;
  new.result := case
    when new.critical > 0 or new.major > qc_accept(new.sample_size, new.aql_major) or new.minor > qc_accept(new.sample_size, new.aql_minor) then 'fail'
    when new.measurements_ok is false or new.packing_ok is false then 'hold'
    else 'pass' end;
  new.notes := nullif(btrim(new.notes), '');
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;
create trigger guard_qc before insert or update on qc_inspections for each row execute function guard_qc();
create trigger audit_qc_inspections after insert or update or delete on qc_inspections for each row execute function write_audit();

alter table qc_inspections enable row level security;
create policy "internal read inspections" on qc_inspections for select using ((select is_internal()));
create policy "ops record inspections"    on qc_inspections for all using ((select is_ops())) with check ((select is_ops()));

-- ───────────────────────── photos ─────────────────────────
alter type file_category add value if not exists 'qc_photo';
alter table files add column qc_id text references qc_inspections(id) on delete cascade;
alter table files drop constraint one_owner;
alter table files add constraint one_owner check (num_nonnulls(inquiry_id, style_id, grn_id, sample_id, qc_id) = 1);
create index files_qc_idx on files (qc_id) where qc_id is not null;

create or replace function guard_file() returns trigger
  language plpgsql set search_path = public as $$
declare v_prefix text; v_ok text[];
begin
  if tg_op = 'UPDATE' then raise exception 'Files can''t be changed. Delete it and upload again.'; end if;
  if new.inquiry_id is not null then
    v_prefix := 'inquiry/' || new.inquiry_id; v_ok := '{inquiry_image,other}';
  elsif new.style_id is not null then
    v_prefix := 'style/' || new.style_id; v_ok := '{tech_pack,cutting_program,style_photo,qc_report,other}';
  elsif new.sample_id is not null then
    v_prefix := 'sample/' || new.sample_id; v_ok := '{sample_photo,other}';
  elsif new.qc_id is not null then
    v_prefix := 'qc/' || new.qc_id; v_ok := '{qc_photo,qc_report,other}';
  else
    v_prefix := 'grn/' || new.grn_id; v_ok := '{grn_photo,qc_report,other}';
  end if;
  if left(new.storage_path, length(v_prefix) + 1) <> v_prefix || '/' or new.storage_path !~ '^[^/]+/[^/]+/[^/]+/[^/]+$' then
    raise exception 'File path does not match what it is attached to.';
  end if;
  if not new.category::text = any(v_ok) then raise exception 'That kind of file can''t be attached here.'; end if;
  new.uploaded_by := auth.uid();
  new.created_at := now();
  return new;
end $$;

-- Factories see the inspection photos of their own orders (never "other").
create function factory_qc_access(p_qc text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from qc_inspections q join sales_orders o on o.id = q.so_id
                  where q.id = p_qc and o.factory_id = my_factory_id())
$$;
grant execute on function factory_qc_access(text) to authenticated;
create policy "factory read qc files" on files for select
  using (qc_id is not null and category::text in ('qc_photo','qc_report') and factory_qc_access(qc_id));

create or replace function can_read_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from files f where f.storage_path = p_name and (
    is_internal() or f.uploaded_by = auth.uid()
    or (f.style_id is not null and f.category in ('tech_pack','cutting_program','style_photo','qc_report') and factory_style_access(f.style_id))
    or (f.sample_id is not null and factory_sample_access(f.sample_id))
    or (f.qc_id is not null and f.category::text in ('qc_photo','qc_report') and factory_qc_access(f.qc_id))))
$$;

-- ───────────────────────── portal ─────────────────────────
create view portal_factory_qc as
  select q.id, q.so_id, q.style_id, q.kind, q.inspected_on, q.lot_qty, q.sample_size, q.aql_major, q.aql_minor, q.defects,
         q.critical, q.major, q.minor, q.measurements_ok, q.packing_ok, q.result, q.notes
    from qc_inspections q join sales_orders o on o.id = q.so_id
   where o.factory_id = my_factory_id();
revoke all on portal_factory_qc from anon;
grant select on portal_factory_qc to authenticated;
