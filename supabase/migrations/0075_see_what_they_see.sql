-- "See what they see": the orders team opens any buyer's or factory's own page from inside the app, read-only,
-- without signing out. The app asks for the preview with a request header (x-preview-buyer / x-preview-factory);
-- the page's read functions answer for that buyer or factory, but only when the caller is a team member of the
-- same company. A buyer or factory login always sees only itself, header or not. Every write still checks
-- my_buyer() / my_factory(), so nothing can be done in someone else's name.
-- Also: the buyer's shipments (date, pieces, cartons, transporter, LR and invoice number) for its page.

create function public.preview_header(p_name text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
begin
  begin
    v := current_setting('request.headers', true)::json ->> p_name;
  exception when others then
    return null;
  end;
  if v is null or v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v::uuid;
end $$;

-- The buyer this page is for: the buyer's own login, else the buyer a team member is previewing.
create function public.viewing_buyer() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_buyer(),
    (select b.id from public.buyers b
     where b.id = public.preview_header('x-preview-buyer') and b.company_id = public.current_company()
       and public.is_member(b.company_id)))
$$;

-- The factory this page is for: the factory's own login, else the factory a team member is previewing.
create function public.viewing_factory() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_factory(),
    (select f.id from public.factories f
     where f.id = public.preview_header('x-preview-factory') and f.company_id = public.current_company()
       and public.is_member(f.company_id)))
$$;

revoke execute on function public.preview_header(text) from public, anon;
revoke execute on function public.viewing_buyer() from public, anon;
revoke execute on function public.viewing_factory() from public, anon;
grant execute on function public.preview_header(text), public.viewing_buyer(), public.viewing_factory() to authenticated;

-- The page read functions, unchanged except that they read viewing_buyer() / viewing_factory().
create or replace function public.buyer_orders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid := public.viewing_buyer();
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
end $function$

;

create or replace function public.buyer_samples()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid := public.viewing_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'order_id', r.order_id, 'order_no', o.order_no, 'buyer_po', o.buyer_po, 'order_open', o.status = 'open',
        'line_id', r.line_id, 'style', l.style, 'colour', l.colour, 'photo_path', l.photo_path,
        'stage', r.stage, 'round', r.round, 'status', r.status, 'photos', to_jsonb(r.photos),
        'note', r.buyer_note, 'courier', r.courier, 'awb', r.awb, 'dispatched_on', r.dispatched_on, 'sent_at', coalesce(r.forwarded_at, r.answered_at),
        'answer_note', r.answer_note, 'answer_photos', to_jsonb(r.answer_photos), 'answered_at', r.answered_at,
        'answered_for_buyer', r.answered_for_buyer, 'approved_on', r.approved_on)
      order by o.order_no, l.position, r.stage, r.round)
    from public.sample_rounds r join public.orders o on o.id = r.order_id
    join public.order_lines l on l.id = r.line_id and l.removed_at is null
    where o.company_id = public.current_company() and o.buyer_id = v_buyer and r.status in ('with_buyer', 'approved', 'changes')
      and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))), '[]'::jsonb);
end $function$

;

create or replace function public.factory_tna()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_factory uuid := public.viewing_factory();
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
end $function$

;

create or replace function public.factory_samples()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'order_id', r.order_id, 'line_id', r.line_id, 'stage', r.stage, 'round', r.round, 'status', r.status,
      'note', r.note, 'photos', to_jsonb(r.photos), 'sent_at', r.sent_at, 'sent_by_team', r.sent_by_team,
      'dispatched_on', r.dispatched_on, 'answer_note', r.answer_note, 'answer_photos', to_jsonb(r.answer_photos),
      'answered_at', r.answered_at, 'approved_on', r.approved_on)
    order by r.line_id, r.stage, r.round), '[]'::jsonb)
  from public.sample_rounds r join public.orders o on o.id = r.order_id and o.status = 'open'
  join public.order_lines l on l.id = r.line_id and l.removed_at is null and l.factory_id = r.factory_id
  where r.company_id = public.current_company() and r.factory_id = public.viewing_factory()
$function$

;

create or replace function public.factory_step_updates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'order_id', u.order_id, 'line_id', u.line_id, 'stage', u.stage, 'done_on', u.done_on,
      'status', u.status, 'review_note', u.review_note, 'photos', cardinality(u.photos), 'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
  from public.step_updates u
  where u.company_id = public.current_company() and u.factory_id = public.viewing_factory() and u.created_at > now() - interval '60 days'
$function$

;

create or replace function public.factory_line_files()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'line_id', f.line_id, 'order_id', f.order_id, 'kind', f.kind,
                                               'path', f.path, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
  from public.line_files f
  join public.order_lines l on l.id = f.line_id and l.removed_at is null
  join public.orders o on o.id = f.order_id and o.status = 'open'
  where f.removed_at is null and f.kind in ('tech_pack', 'cutting')
    and f.company_id = public.current_company() and l.factory_id = public.viewing_factory()
$function$

;

create or replace function public.factory_line_details()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'fabric', l.fabric, 'sizes', l.sizes)), '[]'::jsonb)
  from public.order_lines l
  join public.orders o on o.id = l.order_id and o.status = 'open'
  where l.removed_at is null and (l.fabric is not null or l.sizes is not null)
    and l.company_id = public.current_company() and l.factory_id = public.viewing_factory()
$function$

;

-- The buyer's shipments: each dispatch that has left, newest first, with what the buyer needs to receive it.
-- Never the factory, its bill or any rate.
create function public.buyer_shipments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'order_id', d.order_id, 'shipped_on', (d.shipped_at at time zone 'Asia/Kolkata')::date,
      'pieces', (select coalesce(sum(dl.qty), 0)::integer from public.dispatch_lines dl where dl.dispatch_id = d.id),
      'cartons', d.cartons, 'transporter', d.transporter, 'lr_no', d.lr_no, 'lr_date', d.lr_date, 'invoice_no', d.invoice_no,
      'received_on', (d.grn_at at time zone 'Asia/Kolkata')::date, 'received_qty', d.grn_received_qty)
    order by d.shipped_at desc), '[]'::jsonb)
  from public.dispatches d
  join public.orders o on o.id = d.order_id and o.company_id = d.company_id
  where d.company_id = public.current_company() and o.buyer_id = public.viewing_buyer()
    and d.cancelled_at is null and d.shipped_at is not null
    and (o.status = 'open' or (o.status = 'shipped' and o.updated_at > now() - interval '60 days'))
$$;
revoke execute on function public.buyer_shipments() from public, anon;
grant execute on function public.buyer_shipments() to authenticated;
