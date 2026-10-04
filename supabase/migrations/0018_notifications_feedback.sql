-- In-app notifications for the events people act on, a feedback inbox for
-- the testing phase, and an order timeline built from the audit log.

-- ───────────────────────── notifications ─────────────────────────
create table notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  href        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
alter table notifications enable row level security;
create policy "read own notifications" on notifications for select using (user_id = (select auth.uid()));

-- Mark some (or, with null, all) of my notifications read.
create function mark_notifications_read(p_ids bigint[] default null) returns void
  language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;
grant execute on function mark_notifications_read(bigint[]) to authenticated;

-- Internal helper for the triggers below: never tells people about their own actions.
create function notify(p_users uuid[], p_kind text, p_title text, p_body text, p_href text) returns void
  language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, href)
  select distinct p.id, p_kind, left(p_title, 200), left(p_body, 500), p_href
    from profiles p
   where p.id = any(p_users) and p.active and p.id is distinct from auth.uid()
$$;
create function people_with_role(p_roles user_role[]) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where active and role = any(p_roles)
$$;
create function factory_people(p_factory uuid) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where active and role = 'factory' and factory_id = p_factory
$$;
revoke execute on function notify(uuid[], text, text, text, text), people_with_role(user_role[]), factory_people(uuid) from public, anon, authenticated;

create function reason_label(p text) returns text language sql immutable as $$
  select case p when 'fabric' then 'Fabric late' when 'trims' then 'Trims late' when 'approval' then 'Waiting for approval'
                when 'capacity' then 'Line capacity' when 'quality' then 'Quality issue' when 'labour' then 'Labour / power'
                when 'transport' then 'Transport' when 'other' then 'Other' end
$$;

-- A step marked Delayed: the order's merchandiser and manager hear at once.
create function notify_checkpoint() returns trigger
  language plpgsql security definer set search_path = public as $$
declare o sales_orders; s so_styles;
begin
  if new.status = 'delayed' and old.status is distinct from 'delayed' then
    select * into s from so_styles where id = new.style_id;
    select * into o from sales_orders where id = s.so_id;
    perform notify(array[o.merchandiser_id, o.manager_id], 'tna_delayed',
      'Delayed: ' || new.name || ' · ' || coalesce(nullif(s.name, ''), 'style') || coalesce(' (' || nullif(s.colour, '') || ')', ''),
      o.id || coalesce(' · ' || reason_label(new.delay_reason), '') || coalesce(' · ' || new.status_note, ''),
      '/orders/' || o.id);
  end if;
  return new;
end $$;
create trigger notify_checkpoint after update of status on tna_checkpoints for each row execute function notify_checkpoint();

create function notify_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_code text := (select code from buyers where id = new.buyer_id);
begin
  if new.status = 'tna_review' and old.status = 'draft' then
    perform notify(people_with_role('{owner}'), 'order_review', 'Waiting for your TNA lock: ' || new.id,
                   v_code || ' · PO ' || new.buyer_po_number, '/orders/' || new.id);
  elsif new.status = 'locked' and old.status is distinct from 'locked' then
    perform notify(array[new.merchandiser_id, new.manager_id], 'order_locked', new.id || ' is locked and running',
                   v_code || ' · PO ' || new.buyer_po_number || '. The factory PO has gone out.', '/orders/' || new.id);
  end if;
  if new.merchandiser_id is distinct from old.merchandiser_id and new.merchandiser_id is not null then
    perform notify(array[new.merchandiser_id], 'assigned', 'You''re the merchandiser on ' || new.id,
                   v_code || ' · PO ' || new.buyer_po_number, '/orders/' || new.id);
  end if;
  return new;
end $$;
create trigger notify_order after update on sales_orders for each row execute function notify_order();

create function notify_factory_po() returns trigger
  language plpgsql security definer set search_path = public as $$
declare o sales_orders; v_factory text;
begin
  select * into o from sales_orders where id = new.so_id;
  select name into v_factory from factories where id = new.factory_id;
  if tg_op = 'INSERT' then
    perform notify(factory_people(new.factory_id), 'fpo_issued',
      'New purchase order ' || new.id || case when new.revision > 1 then ' (revision ' || new.revision || ')' else '' end,
      'Deliver by ' || coalesce(to_char(new.delivery_date, 'DD Mon YYYY'), 'the agreed date') || '. Please accept it in the portal.',
      '/factory/po/' || new.id);
  elsif new.status in ('accepted','declined') and old.status = 'issued' then
    perform notify(array[o.merchandiser_id, o.manager_id, new.issued_by], 'fpo_' || new.status,
      new.id || ' ' || new.status::text || ' by ' || coalesce(v_factory, 'the factory'),
      o.id || coalesce(' · "' || new.response_note || '"', ''), '/orders/' || o.id);
  end if;
  return new;
end $$;
create trigger notify_factory_po after insert or update of status on factory_pos for each row execute function notify_factory_po();

create function notify_grn() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending_approval' and old.status = 'draft' then
    perform notify(people_with_role('{owner}'), 'grn_approval', 'Approve ' || new.id, 'Goods received on ' || new.so_id, '/grn/' || new.id);
  elsif new.status in ('approved','rejected') and old.status is distinct from new.status then
    perform notify(array[new.created_by, new.received_by], 'grn_' || new.status, new.id || ' ' || new.status::text, 'On ' || new.so_id, '/grn/' || new.id);
  end if;
  return new;
end $$;
create trigger notify_grn after update of status on grns for each row execute function notify_grn();

create function notify_qc() returns trigger
  language plpgsql security definer set search_path = public as $$
declare o sales_orders; s so_styles; v_what text;
begin
  if tg_op = 'UPDATE' and new.result is not distinct from old.result then return new; end if;
  select * into o from sales_orders where id = new.so_id;
  select * into s from so_styles where id = new.style_id;
  v_what := initcap(new.kind::text) || ' inspection ' || new.id || ' · ' || coalesce(nullif(s.name, ''), 'style') || coalesce(' (' || nullif(s.colour, '') || ')', '');
  if new.result = 'fail' then
    perform notify(array[o.merchandiser_id, o.manager_id] || people_with_role('{owner}'), 'qc_fail', 'QC failed: ' || v_what,
      o.id || ' · ' || new.critical || ' critical, ' || new.major || ' major, ' || new.minor || ' minor in ' || new.sample_size || ' pieces',
      '/qc/' || new.id);
  end if;
  perform notify(factory_people(o.factory_id), 'qc_result', initcap(new.result::text) || ': ' || v_what,
    o.id || ' · ' || new.major || ' major, ' || new.minor || ' minor defects', '/factory/' || o.id);
  return new;
end $$;
create trigger notify_qc after insert or update of result on qc_inspections for each row execute function notify_qc();

create function notify_received_po() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'new' then
    perform notify(people_with_role('{owner,manager,merchandiser}'), 'po_received',
      'New buyer PO ' || new.po_number, (select code from buyers where id = new.buyer_id) || ' · convert it into a sales order', '/pos/' || new.id);
  end if;
  return new;
end $$;
create trigger notify_received_po after insert on received_pos for each row execute function notify_received_po();

create function notify_sample() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_what text := coalesce(nullif(new.description, ''), nullif(new.fabric, ''), 'Sample') || ' (' || new.id || ')';
begin
  if new.status = 'ready' and old.status = 'with_vendor' then
    perform notify(array[new.merchandiser_id], 'sample_ready', 'Sample ready: ' || v_what,
      'Back from the vendor. Send it to the buyer' || coalesce(' by ' || to_char(new.due_date, 'DD Mon'), '') || '.', '/samples/' || new.id);
  elsif new.status = 'changes' and old.status is distinct from 'changes' then
    perform notify(array[new.merchandiser_id], 'sample_changes', 'Buyer asked for changes: ' || v_what, coalesce(new.feedback, ''), '/samples/' || new.id);
  end if;
  if new.merchandiser_id is distinct from old.merchandiser_id and new.merchandiser_id is not null then
    perform notify(array[new.merchandiser_id], 'assigned', 'Sample assigned to you: ' || v_what,
      coalesce('Due to the buyer ' || to_char(new.due_date, 'DD Mon YYYY'), 'No due date yet'), '/samples/' || new.id);
  end if;
  return new;
end $$;
create trigger notify_sample after update on samples for each row execute function notify_sample();

create function notify_inquiry() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.merchandiser_id is not null and (tg_op = 'INSERT' or new.merchandiser_id is distinct from old.merchandiser_id) then
    perform notify(array[new.merchandiser_id], 'assigned', 'Inquiry assigned to you: ' || new.product_type,
      new.id || ' · ' || (select code from buyers where id = new.buyer_id), '/inquiries?status=all&q=' || new.id);
  end if;
  return new;
end $$;
create trigger notify_inquiry after insert or update of merchandiser_id on inquiries for each row execute function notify_inquiry();

-- ───────────────────────── feedback ─────────────────────────
create table feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade default auth.uid(),
  kind        text not null default 'problem' check (kind in ('problem','idea','question')),
  message     text not null check (length(btrim(message)) between 1 and 2000),
  page        text check (length(page) <= 300),
  status      text not null default 'new' check (status in ('new','planned','done','wontfix')),
  reply       text check (length(reply) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index feedback_status_idx on feedback (status, created_at desc);
create trigger touch_feedback before update on feedback for each row execute function touch_updated_at();
alter table feedback enable row level security;
create policy "add own feedback" on feedback for insert
  with check (user_id = (select auth.uid()) and (select my_role()) is not null and status = 'new' and reply is null);
create policy "read own feedback" on feedback for select using (user_id = (select auth.uid()) or (select is_owner()));
create policy "owner answers feedback" on feedback for update using ((select is_owner())) with check ((select is_owner()));

create function notify_feedback() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_who text := (select coalesce(full_name, email) from profiles where id = new.user_id);
begin
  if tg_op = 'INSERT' then
    perform notify(people_with_role('{owner}'), 'feedback', initcap(new.kind) || ' from ' || v_who, left(new.message, 200), '/feedback');
  elsif new.status is distinct from old.status or new.reply is distinct from old.reply then
    perform notify(array[new.user_id], 'feedback_reply', 'Your ' || new.kind || ' was answered',
      coalesce(new.reply, 'Marked ' || new.status), '/settings#feedback');
  end if;
  return new;
end $$;
create trigger notify_feedback after insert or update on feedback for each row execute function notify_feedback();

-- ───────────────────────── order timeline ─────────────────────────
-- Who did what on an order, newest first: status moves, documents, QC and
-- every TNA update (draft autosaves are left out).
create function order_timeline(p_so text) returns table (at timestamptz, actor uuid, source text, action text, row_id text, old_data jsonb, new_data jsonb)
  language sql stable security definer set search_path = public as $$
  select * from (
    select a.at, a.actor, a.table_name, a.action, a.row_id, a.old_data, a.new_data
      from audit_log a
     where is_internal()
       and ((a.table_name = 'sales_orders' and a.row_id = p_so)
            or (a.table_name in ('grns','delivery_challans','factory_pos','qc_inspections') and coalesce(a.new_data->>'so_id', a.old_data->>'so_id') = p_so)
            or (a.table_name = 'so_styles' and a.action <> 'UPDATE' and coalesce(a.new_data->>'so_id', a.old_data->>'so_id') = p_so))
       and (a.action <> 'UPDATE' or a.table_name = 'qc_inspections'
            or a.old_data->>'status' is distinct from a.new_data->>'status'
            or (a.table_name = 'sales_orders' and a.old_data->>'status' in ('locked','shipped')))
    union all
    select h.changed_at, h.changed_by, 'tna_status_history', 'STATUS', h.checkpoint_id::text,
           jsonb_build_object('status', h.from_status),
           jsonb_build_object('status', h.to_status, 'note', h.note, 'delay_reason', h.delay_reason, 'name', c.name, 'style', s.name, 'colour', s.colour)
      from tna_status_history h join tna_checkpoints c on c.id = h.checkpoint_id join so_styles s on s.id = c.style_id
     where is_internal() and s.so_id = p_so
  ) t order by 1 desc limit 300
$$;
grant execute on function order_timeline(text) to authenticated;
