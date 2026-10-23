-- Factory POs go to the factory by email and are accepted by reply, not signed (Dheeraj, 23 Oct 2026).
-- The team taps "Email PO to factory" on a locked PO whose every style has a photo; a scheduled Claude task sends it
-- from the owner's Gmail, follows up every 2 hours (9 am to 9 pm, Mon to Sat) until the factory accepts, and reads
-- replies: an acceptance closes it, a question pauses the follow-ups for the team to answer. The factory can also
-- accept on the PO's own link, which shows the PO with its photos. The team can mark it accepted by hand.

alter table public.factory_pos
  add column accept_token uuid not null default gen_random_uuid(),
  add column mail_to text check (mail_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column mail_cc text check (length(mail_cc) <= 300),
  add column mail_requested_at timestamptz,
  add column mail_requested_by uuid,
  add column mail_thread_id text,
  add column mailed_at timestamptz,
  add column last_mailed_at timestamptz,
  add column follow_ups integer not null default 0,
  add column reply_at timestamptz,
  add column reply_text text check (length(reply_text) <= 1000),
  add column accepted_at timestamptz,
  add column accepted_via text check (accepted_via in ('email', 'link', 'team')),
  add column accepted_by uuid,
  add column accept_note text check (length(accept_note) <= 1000);
create unique index factory_pos_accept_token_key on public.factory_pos (accept_token);
-- Everyone in the company may see where a PO stands; the token (it opens the PO with its rates) is never handed out
-- as a column, only through factory_po_link to the orders team.
grant select (mail_to, mail_cc, mail_requested_at, mail_requested_by, mailed_at, last_mailed_at, follow_ups, reply_at, reply_text,
  accepted_at, accepted_via, accepted_by, accept_note) on public.factory_pos to authenticated;

-- Company setting: while set, every PO email goes to this inbox instead of the factory (testing).
alter table public.companies add column po_mail_test_to text check (po_mail_test_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');

-- The PO number printed and emailed: the team's own number, else the order's SO/n/yyyy number when it has one,
-- else the order number; with several factories each gets -1, -2 in the order they were added.
create function public.factory_po_no(p_order uuid, p_factory uuid) returns text
language sql stable security definer set search_path = '' as $$
  with f as (
    select factory_id, po_no, row_number() over (order by created_at, factory_id) as n, count(*) over () as total
    from public.factory_pos where order_id = p_order
  ), o as (
    select case when buyer_po ~* '^SO/[0-9]+/[0-9]{4}$' then upper(buyer_po) else order_no end as base
    from public.orders where id = p_order
  )
  select coalesce(f.po_no, o.base || case when f.total > 1 then '-' || f.n else '' end)
  from f, o where f.factory_id = p_factory;
$$;
revoke execute on function public.factory_po_no(uuid, uuid) from public, anon;
grant execute on function public.factory_po_no(uuid, uuid) to authenticated;

-- What stops a PO from being emailed, or null when it can go.
create function public.po_mail_blocker(p_order uuid, p_factory uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text;
begin
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null) then
    return 'Lock and release this factory''s PO first.';
  end if;
  select string_agg(style, ', ' order by position) into v_missing from public.order_lines
  where order_id = p_order and factory_id = p_factory and removed_at is null and photo_path is null;
  if v_missing is not null then
    return 'Add the style photo first: ' || v_missing || '. The factory works from the picture.';
  end if;
  return null;
end $$;
revoke execute on function public.po_mail_blocker(uuid, uuid) from public, anon;
grant execute on function public.po_mail_blocker(uuid, uuid) to authenticated;

-- The PO's own link, for the orders team to open or share.
create function public.factory_po_link(p_order uuid, p_factory uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_token uuid;
begin
  select company_id, accept_token into v_company, v_token from public.factory_pos where order_id = p_order and factory_id = p_factory;
  if v_company is null or not public.can_edit_orders(v_company) then return null; end if;
  return v_token;
end $$;
revoke execute on function public.factory_po_link(uuid, uuid) from public, anon;
grant execute on function public.factory_po_link(uuid, uuid) to authenticated;

-- "Email PO to factory": queues the email (sent within half an hour) and starts the follow-ups. Sending again
-- after a change goes in the same email thread and restarts the follow-ups.
create function public.request_po_mail(p_order uuid, p_factory uuid, p_to text, p_cc text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_block text;
  v_to text := lower(btrim(p_to));
  v_cc text := nullif(lower(regexp_replace(btrim(coalesce(p_cc, '')), '\s*[,;]\s*', ', ', 'g')), '');
begin
  select company_id into v_company from public.factory_pos where order_id = p_order and factory_id = p_factory;
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can email a factory PO.';
  end if;
  v_block := public.po_mail_blocker(p_order, p_factory);
  if v_block is not null then raise exception '%', v_block; end if;
  if v_to is null or v_to !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Enter the factory''s email address.';
  end if;
  if v_cc is not null and exists (select 1 from unnest(string_to_array(v_cc, ', ')) e where e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'One of the CC addresses doesn''t look right.';
  end if;
  if exists (select 1 from public.factory_pos where order_id = p_order and factory_id = p_factory and accepted_at is not null) then
    raise exception 'The factory has already accepted this PO.';
  end if;
  update public.factory_pos set mail_to = v_to, mail_cc = v_cc, mail_requested_at = now(), mail_requested_by = auth.uid(),
    reply_at = null, reply_text = null, updated_at = now()
  where order_id = p_order and factory_id = p_factory;
  -- Kept on the factory for its next POs.
  update public.factories set email = v_to where id = p_factory and email is distinct from v_to;
end $$;
revoke execute on function public.request_po_mail(uuid, uuid, text, text) from public, anon;
grant execute on function public.request_po_mail(uuid, uuid, text, text) to authenticated;

-- The factory said yes on the phone or WhatsApp: the team marks it, with a note.
create function public.mark_po_accepted(p_order uuid, p_factory uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.factory_pos where order_id = p_order and factory_id = p_factory and released_at is not null;
  if v_company is null or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can mark a released factory PO accepted.';
  end if;
  update public.factory_pos set accepted_at = coalesce(accepted_at, now()), accepted_via = coalesce(accepted_via, 'team'),
    accepted_by = coalesce(accepted_by, auth.uid()), accept_note = coalesce(nullif(btrim(p_note), ''), accept_note), updated_at = now()
  where order_id = p_order and factory_id = p_factory;
end $$;
revoke execute on function public.mark_po_accepted(uuid, uuid, text) from public, anon;
grant execute on function public.mark_po_accepted(uuid, uuid, text) to authenticated;

-- Everything on one factory PO, for its public link (through the po-inbox function, which adds photo links)
-- and for the email. Never names the buyer or the buyer's rates.
create function public.factory_po_doc(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  fp public.factory_pos;
  v_days integer;
begin
  select * into fp from public.factory_pos where accept_token = p_token and released_at is not null;
  if fp.id is null then return null; end if;
  select coalesce(t.days, 60) into v_days from public.factories f
    left join public.supplier_terms t on t.company_id = f.company_id and t.ledger = f.tally_ledger where f.id = fp.factory_id;
  return (
    select jsonb_build_object(
      'po_no', public.factory_po_no(fp.order_id, fp.factory_id),
      'order_id', fp.order_id, 'factory_id', fp.factory_id,
      'date', to_char(fp.released_at at time zone 'Asia/Kolkata', 'DD/MM/YY'),
      'delivery', coalesce(fp.delivery_note, to_char(coalesce(o.revised_ship_date, o.ship_date) - coalesce(fp.buffer_days, 0), 'DD/MM/YY')),
      'payment_days', coalesce(v_days, 60),
      'accepted_at', fp.accepted_at, 'accepted_via', fp.accepted_via, 'accept_note', fp.accept_note,
      'company', jsonb_build_object('name', coalesce(c.legal_name, c.name), 'address', c.address, 'ship_address', coalesce(c.ship_address, c.address),
        'gstin', c.gstin, 'phone', c.phone, 'email', c.email),
      'factory', jsonb_build_object('name', f.name, 'address', coalesce(f.address, f.city), 'gstin', coalesce(f.gstin, tl.gstin),
        'phone', f.phone, 'contact', f.contact_name, 'email', f.email),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'style', l.style, 'description', l.description, 'colour', l.colour,
          'fabric', l.fabric, 'qty', l.qty, 'sizes', l.sizes, 'rate', l.factory_rate, 'photo_path', l.photo_path) order by l.position), '[]'::jsonb)
        from public.order_lines l where l.order_id = fp.order_id and l.factory_id = fp.factory_id and l.removed_at is null)
    )
    from public.orders o, public.companies c, public.factories f
      left join public.tally_ledgers tl on tl.company_id = f.company_id and tl.name = f.tally_ledger
    where o.id = fp.order_id and c.id = fp.company_id and f.id = fp.factory_id
  );
end $$;
revoke execute on function public.factory_po_doc(uuid) from public, anon, authenticated;
grant execute on function public.factory_po_doc(uuid) to service_role;

-- The factory taps Accept on the PO's link.
create function public.accept_po_by_token(p_token uuid, p_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.factory_pos set accepted_at = now(), accepted_via = 'link',
    accept_note = 'Accepted on the PO link' || coalesce(' by ' || nullif(left(btrim(p_name), 80), ''), ''), updated_at = now()
  where accept_token = p_token and released_at is not null and accepted_at is null;
  return found or exists (select 1 from public.factory_pos where accept_token = p_token and accepted_at is not null);
end $$;
revoke execute on function public.accept_po_by_token(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_po_by_token(uuid, text) to service_role;

-- ---------------------------------------------------------------- for the scheduled email task (runs as postgres)

-- The POs whose email or follow-up is due now, with what to send. Follow-ups wait 2 hours after the last email,
-- stop once accepted, and pause while a factory reply waits for the team.
create function public.po_mail_due() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', fp.order_id, 'factory_id', fp.factory_id, 'thread_id', fp.mail_thread_id,
      'kind', case when fp.last_mailed_at is null or fp.mail_requested_at > fp.last_mailed_at then 'po' else 'follow_up' end,
      'follow_ups', fp.follow_ups,
      'to', coalesce(c.po_mail_test_to, fp.mail_to),
      'cc', case when c.po_mail_test_to is null then fp.mail_cc end,
      'test_for', case when c.po_mail_test_to is not null then fp.mail_to end)
    order by fp.mail_requested_at), '[]'::jsonb)
  from public.factory_pos fp join public.companies c on c.id = fp.company_id
  where fp.mail_requested_at is not null and fp.accepted_at is null and fp.released_at is not null
    and (fp.last_mailed_at is null or fp.mail_requested_at > fp.last_mailed_at
      or (fp.last_mailed_at < now() - interval '115 minutes' and (fp.reply_at is null or fp.reply_at < fp.last_mailed_at)));
$$;
revoke execute on function public.po_mail_due() from public, anon, authenticated;

-- POs emailed and not yet accepted: the email threads to read for a reply.
create function public.po_mail_waiting() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'factory_id', factory_id, 'thread_id', mail_thread_id,
      'po_no', public.factory_po_no(order_id, factory_id), 'last_mailed_at', last_mailed_at, 'reply_at', reply_at)), '[]'::jsonb)
  from public.factory_pos where mail_thread_id is not null and accepted_at is null;
$$;
revoke execute on function public.po_mail_waiting() from public, anon, authenticated;

-- Text safe inside an email's HTML.
create function public.html_text(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- Rupees the Indian way: 9,04,700 (paise only when there are any).
create function public.inr(p numeric) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_whole text := trunc(abs(p))::bigint::text;
  v_paise text := case when abs(p) <> trunc(abs(p)) then '.' || lpad((round((abs(p) - trunc(abs(p))) * 100))::int::text, 2, '0') else '' end;
begin
  if p is null then return null; end if;
  if length(v_whole) > 3 then
    v_whole := regexp_replace(left(v_whole, length(v_whole) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || right(v_whole, 3);
  end if;
  return case when p < 0 then '-' else '' end || v_whole || v_paise;
end $$;

-- The email itself: subject, plain text and HTML. kind 'po' is the PO; 'follow_up' is the short reminder.
create function public.po_mail_content(p_order uuid, p_factory uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  fp public.factory_pos;
  d jsonb;
  v_link text;
  v_rows text := '';
  v_text text := '';
  v_total integer := 0;
  v_value numeric := 0;
  l jsonb;
  v_sizes text;
  v_greet text;
begin
  select * into fp from public.factory_pos where order_id = p_order and factory_id = p_factory;
  d := public.factory_po_doc(fp.accept_token);
  if d is null then return null; end if;
  v_link := 'https://sourcingo-os.vercel.app/po/' || fp.accept_token;
  v_greet := 'Dear ' || coalesce(nullif(d->'factory'->>'contact', ''), d->'factory'->>'name') || ',';
  -- Names typed by the team go into the HTML escaped.
  if p_kind = 'follow_up' then
    return jsonb_build_object(
      'subject', 'Re: Purchase order ' || (d->>'po_no') || ' from ' || (d->'company'->>'name'),
      'text', v_greet || E'\n\nA reminder: please accept our purchase order ' || (d->>'po_no') || ' by replying "Accepted" to this email, '
        || E'or tap Accept on the PO link:\n' || v_link || E'\n\nIf anything on the PO needs a change, reply and tell us.\n\nRegards,\n' || (d->'company'->>'name'),
      'html', '<p>' || public.html_text(v_greet) || '</p><p>A reminder: please accept our purchase order <b>' || public.html_text(d->>'po_no') || '</b> by replying <b>"Accepted"</b> to this email, '
        || 'or tap <b>Accept</b> on the PO link: <a href="' || v_link || '">' || v_link || '</a></p><p>If anything on the PO needs a change, reply and tell us.</p><p>Regards,<br>'
        || public.html_text(d->'company'->>'name') || '</p>');
  end if;
  for l in select * from jsonb_array_elements(d->'lines') loop
    select string_agg(k || ' ' || v, ', ' order by coalesce(array_position(array['XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL'], upper(k)), 99), k) into v_sizes from jsonb_each_text(coalesce(nullif(l->'sizes', 'null'::jsonb), '{}'::jsonb)) x (k, v) where v::numeric > 0;
    v_total := v_total + (l->>'qty')::integer;
    v_value := v_value + (l->>'qty')::numeric * coalesce((l->>'rate')::numeric, 0);
    v_rows := v_rows || '<tr><td style="border:1px solid #999;padding:6px">' || public.html_text(l->>'description') || '</td><td style="border:1px solid #999;padding:6px"><b>' || public.html_text(l->>'style')
      || '</b></td><td style="border:1px solid #999;padding:6px">' || public.html_text(l->>'colour') || '</td><td style="border:1px solid #999;padding:6px;text-align:right">'
      || coalesce('Rs ' || public.inr((l->>'rate')::numeric), '') || '</td><td style="border:1px solid #999;padding:6px">' || public.html_text(coalesce(v_sizes, 'Size-wise qty will be confirmed before cutting'))
      || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || (l->>'qty') || '</td></tr>';
    v_text := v_text || '- ' || (l->>'style') || coalesce(' (' || (l->>'description') || ')', '') || coalesce(', ' || (l->>'colour'), '') || ': '
      || (l->>'qty') || ' pcs' || coalesce(' @ Rs ' || public.inr((l->>'rate')::numeric), '') || coalesce(', sizes ' || v_sizes, '') || E'\n';
  end loop;
  return jsonb_build_object(
    'subject', 'Purchase order ' || (d->>'po_no') || ' from ' || (d->'company'->>'name'),
    'text', v_greet || E'\n\nPlease find our purchase order ' || (d->>'po_no') || ' dated ' || (d->>'date') || E'.\n\n' || v_text
      || E'\nTotal: ' || public.inr(v_total) || ' pcs, Rs ' || public.inr(v_value) || E' + GST\nPayment terms: ' || (d->>'payment_days') || E' days from GRN\nDelivery date: ' || coalesce(d->>'delivery', 'As agreed')
      || E'\n\nThe full PO with the style photos and our terms and conditions:\n' || v_link
      || E'\n\nPlease accept this PO by replying "Accepted" to this email, or tap Accept on the link. No signature is needed.'
      || E'\n\nRegards,\n' || (d->'company'->>'name') || coalesce(E'\n' || (d->'company'->>'phone'), ''),
    'html', '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>' || public.html_text(v_greet) || '</p><p>Please find our purchase order <b>' || public.html_text(d->>'po_no')
      || '</b> dated ' || (d->>'date') || '.</p><table style="border-collapse:collapse;font-size:13px"><tr style="background:#f2f2f2">'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Article</th><th style="border:1px solid #999;padding:6px;text-align:left">Design no.</th>'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Colour</th><th style="border:1px solid #999;padding:6px">Rate</th>'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Qty</th><th style="border:1px solid #999;padding:6px">Total</th></tr>' || v_rows
      || '<tr><td colspan="5" style="border:1px solid #999;padding:6px"><b>Total</b> (value Rs ' || public.inr(v_value) || ' + GST)</td><td style="border:1px solid #999;padding:6px;text-align:right"><b>'
      || public.inr(v_total) || '</b></td></tr></table><p><b>Payment terms:</b> ' || (d->>'payment_days') || ' days from GRN<br><b>Delivery date:</b> ' || public.html_text(coalesce(d->>'delivery', 'As agreed')) || '</p>'
      || '<p style="margin:18px 0"><a href="' || v_link || '" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">'
      || 'Open the PO with style photos</a></p><p>Please <b>accept this PO by replying "Accepted"</b> to this email, or tap Accept on the PO link. No signature is needed. '
      || 'The PO link also has our terms and conditions and a Save as PDF button.</p><p>Regards,<br>' || (d->'company'->>'name') || coalesce('<br>' || (d->'company'->>'phone'), '') || '</p></div>'
  );
end $$;
revoke execute on function public.po_mail_content(uuid, uuid, text) from public, anon, authenticated;

-- The task sent the PO or a follow-up.
create function public.po_mail_sent(p_order uuid, p_factory uuid, p_thread text, p_kind text) returns void
language sql security definer set search_path = '' as $$
  update public.factory_pos set mail_thread_id = coalesce(p_thread, mail_thread_id), mailed_at = coalesce(mailed_at, now()), last_mailed_at = now(),
    follow_ups = case when p_kind = 'follow_up' then follow_ups + 1 else 0 end
  where order_id = p_order and factory_id = p_factory;
$$;
revoke execute on function public.po_mail_sent(uuid, uuid, text, text) from public, anon, authenticated;

-- The task read the factory's reply: accepted, or a question for the team (follow-ups pause until the team sends again).
create function public.po_mail_reply(p_order uuid, p_factory uuid, p_accepted boolean, p_text text) returns void
language sql security definer set search_path = '' as $$
  update public.factory_pos set
    accepted_at = case when p_accepted then coalesce(accepted_at, now()) else accepted_at end,
    accepted_via = case when p_accepted then coalesce(accepted_via, 'email') else accepted_via end,
    accept_note = case when p_accepted then coalesce(left(btrim(p_text), 1000), accept_note) else accept_note end,
    reply_at = case when p_accepted then reply_at else now() end,
    reply_text = case when p_accepted then reply_text else left(btrim(p_text), 1000) end
  where order_id = p_order and factory_id = p_factory;
$$;
revoke execute on function public.po_mail_reply(uuid, uuid, boolean, text) from public, anon, authenticated;
