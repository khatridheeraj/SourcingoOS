-- Samples: a buyer sends a garment, swatch or idea, a vendor develops it, and
-- it must reach the buyer on or before the due date.
--
--   received ─▶ with_vendor ─▶ ready ─▶ dispatched ─▶ approved | changes | rejected
--                    ▲                                            │
--                    └──────────── next round ◀───────────────────┘
--   cancelled can be set from anywhere.
--
-- Dates for what already happened are stamped when the status moves, can't be
-- in the future, and must be in order. Every status change is logged. Vendors
-- see only the samples issued to them; buyers see only their own, by stage.

create type sample_status as enum ('received','with_vendor','ready','dispatched','approved','changes','rejected','cancelled');
alter type file_category add value if not exists 'sample_photo';

create sequence sample_seq;

create table samples (
  id              text primary key default 'SMP-' || lpad(nextval('sample_seq')::text, 6, '0'),
  buyer_id        uuid not null references buyers(id),
  sample_type     text not null default 'development'
                    check (sample_type in ('development','fit','size_set','pp','photoshoot','salesman','other')),
  description     text check (length(description) <= 200),
  buyer_ref       text check (length(buyer_ref) <= 100),
  fabric          text check (length(fabric) <= 200),
  qty             integer not null default 1 check (qty > 0 and qty <= 10000),
  factory_id      uuid references factories(id),
  merchandiser_id uuid references profiles(id),
  status          sample_status not null default 'received',
  round           integer not null default 1,
  received_on     date,                    -- from the buyer
  due_date        date,                    -- must reach the buyer by
  issued_on       date,                    -- handed to the vendor
  vendor_due      date,                    -- vendor promised it back by
  ready_on        date,                    -- back from the vendor
  dispatched_on   date,                    -- sent to the buyer
  courier         text check (length(courier) <= 100),
  tracking        text check (length(tracking) <= 100),
  feedback        text check (length(feedback) <= 2000),
  remarks         text check (length(remarks) <= 2000),
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index samples_buyer_idx on samples (buyer_id);
create index samples_factory_idx on samples (factory_id);
create index samples_open_idx on samples (due_date) where status in ('received','with_vendor','ready');

create table sample_events (
  id           uuid primary key default gen_random_uuid(),
  sample_id    text not null references samples(id) on delete cascade,
  kind         text not null check (kind in ('status','note')),
  from_status  sample_status,
  to_status    sample_status,
  round        integer,
  note         text check (length(note) <= 1000),
  created_by   uuid references profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint note_or_status check ((kind = 'note') = (note is not null) and (kind = 'status') = (to_status is not null))
);
create index sample_events_sample_idx on sample_events (sample_id, created_at);

-- ───────────────────────── rules ─────────────────────────
create function sample_rank(p sample_status) returns int language sql immutable as $$
  select case p when 'received' then 1 when 'with_vendor' then 2 when 'ready' then 3 when 'dispatched' then 4
                when 'cancelled' then 0 else 5 end
$$;

create function guard_sample() returns trigger
  language plpgsql set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_rank int := sample_rank(new.status);
  d text := 'DD Mon YYYY';
begin
  new.description := nullif(btrim(new.description), '');
  new.buyer_ref   := nullif(btrim(new.buyer_ref), '');
  new.fabric      := nullif(btrim(new.fabric), '');
  new.courier     := nullif(btrim(new.courier), '');
  new.tracking    := nullif(btrim(new.tracking), '');
  new.feedback    := nullif(btrim(new.feedback), '');
  new.remarks     := nullif(btrim(new.remarks), '');

  if tg_op = 'INSERT' then
    new.round := 1;
    new.created_at := now();
    new.updated_at := now();
    -- Rows imported from the old sheet (no signed-in user) may lack a due date.
    if new.due_date is null and auth.uid() is not null then
      raise exception 'Set the date the buyer needs this sample by.';
    end if;
    if new.status = 'with_vendor' and new.issued_on is null then new.issued_on := v_today; end if;
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    new.round := old.round;
    if new.status <> old.status then
      -- Buyer asked for changes (or rejected it) and it goes back for another round.
      if old.status in ('changes','rejected') and v_rank between 1 and 2 then
        new.round := old.round + 1;
        new.ready_on := null;
        new.dispatched_on := null;
        new.courier := null;
        new.tracking := null;
        if new.issued_on is not distinct from old.issued_on then new.issued_on := null; end if;
        if new.vendor_due is not distinct from old.vendor_due then new.vendor_due := null; end if;
      end if;
      if new.status = 'with_vendor' and new.issued_on is null then new.issued_on := v_today; end if;
      if new.status = 'ready' and new.ready_on is null then new.ready_on := v_today; end if;
      if new.status = 'dispatched' and new.dispatched_on is null then new.dispatched_on := v_today; end if;
    end if;
  end if;

  -- Moving back a step clears the dates of the steps that haven't happened.
  if new.status <> 'cancelled' then
    if v_rank < 2 then new.issued_on := null; end if;
    if v_rank < 3 then new.ready_on := null; end if;
    if v_rank < 4 then new.dispatched_on := null; end if;
  end if;

  if new.status = 'with_vendor' and new.factory_id is null then
    raise exception 'Choose the vendor making this sample.';
  end if;
  if new.status = 'dispatched' and new.dispatched_on is null then
    raise exception 'Enter the date the sample was sent to the buyer.';
  end if;
  if v_rank = 5 and new.dispatched_on is null then
    raise exception 'Mark the sample as sent to the buyer before recording their decision.';
  end if;

  if new.received_on > v_today then raise exception 'The received date can''t be in the future.'; end if;
  if new.issued_on > v_today then raise exception 'The date it went to the vendor can''t be in the future.'; end if;
  if new.ready_on > v_today then raise exception 'The ready date can''t be in the future.'; end if;
  if new.dispatched_on > v_today then raise exception 'The date it was sent to the buyer can''t be in the future.'; end if;

  if new.issued_on < new.received_on then
    raise exception 'It went to the vendor on % but was received on %. Check the dates.', to_char(new.issued_on, d), to_char(new.received_on, d);
  end if;
  if new.ready_on < coalesce(new.issued_on, new.received_on) then
    raise exception 'The ready date (%) is before it went to the vendor or was received.', to_char(new.ready_on, d);
  end if;
  if new.dispatched_on < coalesce(new.ready_on, new.issued_on, new.received_on) then
    raise exception 'The date it was sent to the buyer (%) is before it was ready, issued or received.', to_char(new.dispatched_on, d);
  end if;
  if new.due_date < new.received_on then
    raise exception 'The due date (%) is before the sample was received (%).', to_char(new.due_date, d), to_char(new.received_on, d);
  end if;
  if new.vendor_due < new.issued_on then
    raise exception 'The vendor''s date (%) is before the sample went to them (%).', to_char(new.vendor_due, d), to_char(new.issued_on, d);
  end if;
  return new;
end $$;
create trigger guard_sample before insert or update on samples for each row execute function guard_sample();

-- Every status change goes into the sample's history.
create function log_sample_status() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status <> old.status then
    insert into sample_events (sample_id, kind, from_status, to_status, round)
      values (new.id, 'status', case when tg_op = 'UPDATE' then old.status end, new.status, new.round);
  end if;
  return null;
end $$;
create trigger log_sample_status after insert or update of status on samples for each row execute function log_sample_status();

create trigger audit_samples after insert or update or delete on samples for each row execute function write_audit();

-- ───────────────────────── access ─────────────────────────
alter table samples       enable row level security;
alter table sample_events enable row level security;

create policy "internal read samples"   on samples for select using ((select is_internal()));
create policy "ops add samples"         on samples for insert with check ((select is_ops()));
create policy "ops update samples"      on samples for update using ((select is_ops())) with check ((select is_ops()));
create policy "owner deletes samples"   on samples for delete using ((select is_owner()));

create policy "internal read sample history" on sample_events for select using ((select is_internal()));
create policy "ops add sample notes"         on sample_events for insert
  with check ((select is_ops()) and kind = 'note' and created_by = auth.uid());

-- The vendor says the sample is done and on its way back to Sourcingo.
create function factory_sample_ready(p_sample text, p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare v_factory uuid; v_status sample_status; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select factory_id, status into v_factory, v_status from samples where id = p_sample;
  if not found or my_factory_id() is null or v_factory is distinct from my_factory_id() or v_status in ('received','cancelled') then
    raise exception 'You do not have access to this sample.';
  end if;
  if v_status <> 'with_vendor' then raise exception 'This sample is already marked ready.'; end if;
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  update samples set status = 'ready' where id = p_sample;
  if v_note is not null then
    insert into sample_events (sample_id, kind, note) values (p_sample, 'note', v_note);
  end if;
end $$;
grant execute on function factory_sample_ready(text, text) to authenticated;

-- ───────────────────────── photos ─────────────────────────
alter table files add column sample_id text references samples(id) on delete cascade;
alter table files drop constraint one_owner;
alter table files add constraint one_owner check (num_nonnulls(inquiry_id, style_id, grn_id, sample_id) = 1);
create index files_sample_idx on files (sample_id) where sample_id is not null;

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

-- Vendors see the photos of samples issued to them, and add their own while
-- they are making it.
create function factory_sample_access(p_sample text, p_making boolean default false) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from samples s
                  where s.id = p_sample and s.factory_id = my_factory_id()
                    and s.status = any(case when p_making then '{with_vendor}'::sample_status[]
                                            else '{with_vendor,ready,dispatched,approved,changes,rejected}'::sample_status[] end))
$$;
grant execute on function factory_sample_access(text, boolean) to authenticated;

create policy "factory read sample files" on files for select
  using (sample_id is not null and factory_sample_access(sample_id));
create policy "factory add sample photos" on files for insert
  with check (sample_id is not null and factory_sample_access(sample_id, true));
create policy "factory delete own sample photos" on files for delete
  using (sample_id is not null and uploaded_by = auth.uid() and factory_sample_access(sample_id, true));

create or replace function can_read_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from files f where f.storage_path = p_name and (
    is_internal() or f.uploaded_by = auth.uid()
    or (f.style_id is not null and f.category in ('tech_pack','cutting_program','style_photo','qc_report') and factory_style_access(f.style_id))
    or (f.sample_id is not null and factory_sample_access(f.sample_id))))
$$;
create or replace function can_delete_object(p_name text) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_ops() or exists (select 1 from files f where f.storage_path = p_name and f.uploaded_by = auth.uid() and (
    (f.category = 'style_photo' and factory_style_access(f.style_id, true))
    or (f.sample_id is not null and factory_sample_access(f.sample_id, true))))
$$;

-- ───────────────────────── portals ─────────────────────────
create view portal_factory_samples as
  select s.id, b.code as buyer_code, s.sample_type, s.description, s.buyer_ref, s.fabric, s.qty, s.status, s.round,
         s.issued_on, s.vendor_due, s.ready_on,
         case when s.status = 'changes' then s.feedback end as feedback
    from samples s join buyers b on b.id = s.buyer_id
   where s.factory_id = my_factory_id() and s.status in ('with_vendor','ready','dispatched','approved','changes','rejected');

create view portal_buyer_samples as
  select s.id, s.sample_type, s.description, s.buyer_ref, s.fabric, s.qty, s.round, s.received_on, s.due_date,
         case when s.status in ('received','with_vendor','ready') then 'In development'
              when s.status = 'dispatched' then 'Sent to you'
              when s.status = 'approved' then 'Approved'
              when s.status = 'changes' then 'Changes requested'
              else 'Not approved' end as stage,
         s.dispatched_on, s.courier, s.tracking
    from samples s
   where s.buyer_id = my_buyer_id() and s.status <> 'cancelled';

revoke all on portal_factory_samples, portal_buyer_samples from anon;
grant select on portal_factory_samples, portal_buyer_samples to authenticated;
