-- The PO email's HTML table had its columns shifted (24 Oct 2026, SO-0012): the sizes sat under Qty and the pieces
-- under Total. Now each column holds what its heading says: Sizes, Rate, Qty (pcs) and Value (qty x rate), with
-- the total pieces and value on the last row. The plain-text email was right and is unchanged.

create or replace function public.po_mail_content(p_order uuid, p_factory uuid, p_kind text) returns jsonb
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
      || '</b></td><td style="border:1px solid #999;padding:6px">' || public.html_text(l->>'colour') || '</td><td style="border:1px solid #999;padding:6px">' || public.html_text(coalesce(v_sizes, 'Size-wise qty will be confirmed before cutting'))
      || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || coalesce('Rs ' || public.inr((l->>'rate')::numeric), '') || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || public.inr((l->>'qty')::numeric)
      || '</td><td style="border:1px solid #999;padding:6px;text-align:right">' || coalesce('Rs ' || public.inr((l->>'qty')::numeric * (l->>'rate')::numeric), '') || '</td></tr>';
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
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Article</th><th style="border:1px solid #999;padding:6px;text-align:left">Design no.</th><th style="border:1px solid #999;padding:6px;text-align:left">Colour</th>'
      || '<th style="border:1px solid #999;padding:6px;text-align:left">Sizes</th><th style="border:1px solid #999;padding:6px;text-align:right">Rate</th><th style="border:1px solid #999;padding:6px;text-align:right">Qty (pcs)</th><th style="border:1px solid #999;padding:6px;text-align:right">Value</th></tr>' || v_rows
      || '<tr><td colspan="5" style="border:1px solid #999;padding:6px"><b>Total</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>' || public.inr(v_total)
      || '</b></td><td style="border:1px solid #999;padding:6px;text-align:right"><b>Rs ' || public.inr(v_value) || '</b> + GST</td></tr></table><p><b>Payment terms:</b> ' || (d->>'payment_days') || ' days from GRN<br><b>Delivery date:</b> ' || public.html_text(coalesce(d->>'delivery', 'As agreed')) || '</p>'
      || '<p style="margin:18px 0"><a href="' || v_link || '" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">'
      || 'Open the PO with style photos</a></p><p>Please <b>accept this PO by replying "Accepted"</b> to this email, or tap Accept on the PO link. No signature is needed. '
      || 'The PO link also has our terms and conditions and a Save as PDF button.</p><p>Regards,<br>' || public.html_text(d->'company'->>'name') || coalesce('<br>' || public.html_text(d->'company'->>'phone'), '') || '</p></div>'
  );
end $$;
