-- Fabric is bought by the metre (25 Oct 2026, SO-0020-1 was queued as "250 pcs" of cambric). The factory PO and its
-- email now carry each style's product and say "m" for fabric and "pcs" for garments, with totals kept apart by unit.
-- Fabric has no sizes, so its row doesn't promise a size-wise split. Nothing else changes.

create or replace function public.factory_po_doc(p_token uuid) returns jsonb
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
          'fabric', l.fabric, 'qty', l.qty, 'sizes', l.sizes, 'rate', l.factory_rate, 'photo_path', l.photo_path, 'product', l.product) order by l.position), '[]'::jsonb)
        from public.order_lines l where l.order_id = fp.order_id and l.factory_id = fp.factory_id and l.removed_at is null)
    )
    from public.orders o, public.companies c, public.factories f
      left join public.tally_ledgers tl on tl.company_id = f.company_id and tl.name = f.tally_ledger
    where o.id = fp.order_id and c.id = fp.company_id and f.id = fp.factory_id
  );
end $$;
revoke execute on function public.factory_po_doc(uuid) from public, anon, authenticated;
grant execute on function public.factory_po_doc(uuid) to service_role;

create or replace function public.po_mail_content(p_order uuid, p_factory uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  fp public.factory_pos;
  d jsonb;
  v_link text;
  v_rows text := '';
  v_text text := '';
  v_pcs integer := 0;
  v_m integer := 0;
  v_unit text;
  v_totals text;
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
    v_unit := case when l->>'product' = 'fabric' then 'm' else 'pcs' end;
    if v_unit = 'm' then v_m := v_m + (l->>'qty')::integer; else v_pcs := v_pcs + (l->>'qty')::integer; end if;
    v_value := v_value + (l->>'qty')::numeric * coalesce((l->>'rate')::numeric, 0);
    v_rows := v_rows || '<tr><td style="border:1px solid #999;padding:6px">' || public.html_text(l->>'description') || '</td><td style="border:1px solid #999;padding:6px"><b>' || public.html_text(l->>'style')
      || '</b></td><td style="border:1px solid #999;padding:6px">' || public.html_text(l->>'colour') || '</td><td style="border:1px solid #999;padding:6px">' || public.html_text(coalesce(v_sizes, case when v_unit = 'm' then '-' else 'Size-wise qty will be confirmed before cutting' end))
      || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || coalesce('Rs ' || public.inr((l->>'rate')::numeric), '') || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || public.inr((l->>'qty')::numeric) || ' ' || v_unit
      || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || coalesce('Rs ' || public.inr((l->>'qty')::numeric * (l->>'rate')::numeric), '') || '</td></tr>';
    v_text := v_text || '- ' || (l->>'style') || coalesce(' (' || (l->>'description') || ')', '') || coalesce(', ' || (l->>'colour'), '') || ': '
      || (l->>'qty') || ' ' || v_unit || coalesce(' @ Rs ' || public.inr((l->>'rate')::numeric), '') || coalesce(', sizes ' || v_sizes, '') || E'\n';
  end loop;
  v_totals := concat_ws(' + ', case when v_pcs > 0 or v_m = 0 then public.inr(v_pcs) || ' pcs' end, case when v_m > 0 then public.inr(v_m) || ' m' end);
  return jsonb_build_object(
    'subject', 'Purchase order ' || (d->>'po_no') || ' from ' || (d->'company'->>'name'),
    'text', v_greet || E'\n\nPlease find our purchase order ' || (d->>'po_no') || ' dated ' || (d->>'date') || E'.\n\n' || v_text
      || E'\nTotal: ' || v_totals || ', Rs ' || public.inr(v_value) || E' + GST\nPayment terms: ' || (d->>'payment_days') || E' days from GRN\nDelivery date: ' || coalesce(d->>'delivery', 'As agreed')
      || E'\n\nThe full PO with the style photos and our terms and conditions:\n' || v_link
      || E'\n\nPlease accept this PO by replying "Accepted" to this email, or tap Accept on the link. No signature is needed.'
      || E'\n\nRegards,\n' || (d->'company'->>'name') || coalesce(E'\n' || (d->'company'->>'phone'), ''),
    'html', '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>' || public.html_text(v_greet) || '</p><p>Please find our purchase order <b>' || public.html_text(d->>'po_no')
      || '</b> dated ' || (d->>'date') || '.</p><table style="border-collapse:collapse;font-size:13px"><tr style="background:#f2f2f2">'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Article</th><th style="border:1px solid #999;padding:6px;text-align:left">Design no.</th><th style="border:1px solid #999;padding:6px;text-align:left">Colour</th>'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Sizes</th><th style="border:1px solid #999;padding:6px;text-align:right">Rate</th><th style="border:1px solid #999;padding:6px;text-align:right">Qty</th><th style="border:1px solid #999;padding:6px;text-align:right">Value</th></tr>' || v_rows
      || '<tr><td colspan="5" style="border:1px solid #999;padding:6px"><b>Total</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>' || v_totals
      || '</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>Rs ' || public.inr(v_value) || '</b> + GST</td></tr></table><p><b>Payment terms:</b> ' || (d->>'payment_days') || ' days from GRN<br><b>Delivery date:</b> ' || public.html_text(coalesce(d->>'delivery', 'As agreed')) || '</p>'
      || '<p style="margin:18px 0"><a href="' || v_link || '" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">'
      || 'Open the PO with style photos</a></p><p>Please <b>accept this PO by replying "Accepted"</b> to this email, or tap Accept on the PO link. No signature is needed. '
      || 'The PO link also has our terms and conditions and a Save as PDF button.</p><p>Regards,<br>' || public.html_text(d->'company'->>'name') || coalesce('<br>' || public.html_text(d->'company'->>'phone'), '') || '</p></div>'
  );
end $$;

-- The factory panel says metres for a fabric style too.
create or replace function public.factory_tna() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  return jsonb_build_object('factory', (select name from public.factories where id = v_factory), 'orders', coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'order_no', o.order_no, 'ship_date', coalesce(o.revised_ship_date, o.ship_date),
      'plan_requested_on', f.plan_requested_on, 'sent_at', f.factory_sent_at, 'released_at', f.released_at,
      'plan_due_at', f.plan_requested_at + interval '24 hours', 'target', public.factory_target(o.id, v_factory),
      'lines', (select jsonb_agg(jsonb_build_object(
          'id', l.id, 'style', l.style, 'colour', l.colour, 'qty', l.qty, 'rate', l.factory_rate, 'product', l.product,
          'stages', (select coalesce(jsonb_agg(jsonb_build_object(
              'stage', s.stage, 'label', s.label, 'factory_on', s.factory_on, 'planned_on', s.planned_on,
              'done_on', case when f.released_at is not null then s.done_on end) order by s.pos), '[]'::jsonb)
            from public.style_steps(l.id) s)) order by l.position)
        from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null))
      order by f.released_at is not null, coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
    from public.orders o
    join public.factory_pos f on f.order_id = o.id and f.factory_id = v_factory
      and (f.plan_requested_at is not null or f.plan_requested_on is not null or f.released_at is not null)
    where o.company_id = public.current_company() and o.status = 'open'
      and exists (select 1 from public.order_lines l where l.order_id = o.id and l.factory_id = v_factory and l.removed_at is null)
  ), '[]'::jsonb));
end $$;

-- And the buyer's orders page.
create or replace function public.buyer_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return jsonb_build_object(
    'buyer', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = v_buyer), (select code from public.buyers where id = v_buyer)),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'po_date', o.po_date, 'status', o.status,
        'ship_date', o.ship_date, 'revised_ship_date', o.revised_ship_date, 'closed_short', o.closed_short_at is not null,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'style', l.style, 'colour', l.colour, 'description', l.description, 'qty', l.qty, 'photo_path', l.photo_path, 'product', l.product,
            'shipped', (select coalesce(sum(dl.qty), 0)::integer from public.dispatch_lines dl
                        join public.dispatches d on d.id = dl.dispatch_id
                        where dl.line_id = l.id and d.cancelled_at is null and d.shipped_at is not null),
            'steps', (select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'label', s.label, 'planned_on', s.planned_on, 'done_on', s.done_on)
                        order by s.pos), '[]'::jsonb) from public.style_steps(l.id) s),
            'final_qc', (select jsonb_build_object('result', q.result, 'checked_on', q.checked_on, 'pieces_checked', q.pieces_checked,
                           'photos', (select coalesce(jsonb_agg(p.path order by p.created_at), '[]'::jsonb) from public.qc_photos p
                                      where p.qc_id = q.id and p.kind = 'photo' and p.removed_at is null))
                         from public.qc_checks q where q.line_id = l.id and q.kind in ('final', 'recheck') and q.cancelled_at is null
                         order by q.checked_on desc, q.created_at desc limit 1))
          order by l.position), '[]'::jsonb)
          from public.order_lines l where l.order_id = o.id and l.removed_at is null))
        order by o.status <> 'open', coalesce(o.revised_ship_date, o.ship_date) nulls last, o.order_no)
      from public.orders o
      where o.company_id = public.current_company() and o.buyer_id = v_buyer
        and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
    ), '[]'::jsonb));
end $$;
