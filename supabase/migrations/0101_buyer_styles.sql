-- Your styles and order again (0101, Dheeraj, 28 Nov 2026). Repeat orders are where sourcing pays, so a buyer's page
-- now keeps every style it has ever ordered with us, with its approved samples and final QC, and one button to order
-- it again. A reorder ask becomes an inquiry (ENQ-xxxx) due today for the merchandiser of that style's order, who
-- confirms price and date the usual way. The buyer never sees factories or rates here either.
-- Nothing here is ever deleted.

-- The style an inquiry asks to make again.
alter table public.inquiries add column reorder_of uuid references public.order_lines (id);
create index inquiries_reorder_idx on public.inquiries (reorder_of) where reorder_of is not null;

-- Every style the buyer has ordered (all orders that weren't cancelled or deleted), newest first, one entry per
-- style and colour: its latest photo and description, how often and how much it was ordered, its approved samples,
-- its latest final QC result, and any reorder still being priced.
create function public.buyer_styles() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_buyer uuid := public.viewing_buyer();
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  return coalesce((
    with lines as (
      select l.id, l.style, l.colour, l.description, l.product, l.qty, l.photo_path, o.id as order_id, o.order_no, o.buyer_po,
             coalesce(o.po_date, o.created_at::date) as ordered_on, o.status,
             lower(btrim(l.style)) || '|' || lower(btrim(coalesce(l.colour, ''))) as k
      from public.order_lines l
      join public.orders o on o.id = l.order_id
      where o.company_id = public.current_company() and o.buyer_id = v_buyer and o.removed_at is null
        and o.status <> 'cancelled' and l.removed_at is null
    ), latest as (
      select distinct on (k) * from lines order by k, ordered_on desc, order_no desc
    )
    select jsonb_agg(jsonb_build_object(
        'line_id', x.id, 'style', x.style, 'colour', x.colour, 'description', x.description, 'product', x.product,
        'photo_path', coalesce(x.photo_path, (select l2.photo_path from lines l2 where l2.k = x.k and l2.photo_path is not null order by l2.ordered_on desc limit 1)),
        'last_po', coalesce(x.buyer_po, x.order_no), 'last_on', x.ordered_on, 'last_qty', x.qty, 'open', x.status = 'open',
        'times', (select count(distinct l2.order_id) from lines l2 where l2.k = x.k),
        'total', (select sum(l2.qty) from lines l2 where l2.k = x.k),
        'samples', (select coalesce(jsonb_agg(jsonb_build_object('stage', r.stage, 'round', r.round, 'on', coalesce(r.approved_on, r.answered_at::date),
                                                            'photo', r.photos[1]) order by r.answered_at desc), '[]'::jsonb)
                    from public.sample_rounds r join lines l2 on l2.id = r.line_id
                    where l2.k = x.k and r.status = 'approved'),
        'final_qc', (select jsonb_build_object('result', q.result, 'on', q.checked_on)
                     from public.qc_checks q join lines l2 on l2.id = q.line_id
                     where l2.k = x.k and q.kind in ('final', 'recheck') and q.cancelled_at is null
                     order by q.checked_on desc, q.created_at desc limit 1),
        'asked', (select jsonb_build_object('no', i.inquiry_no, 'on', (i.created_at at time zone 'Asia/Kolkata')::date, 'status', i.status,
                                            'qty', i.est_qty, 'price', i.quoted_price)
                  from public.inquiries i join lines l2 on l2.id = i.reorder_of
                  where l2.k = x.k and i.buyer_id = v_buyer and i.status in ('new', 'quoted')
                  order by i.created_at desc limit 1))
      order by x.ordered_on desc, x.order_no desc, x.style)
    from latest x
  ), '[]'::jsonb);
end $$;
revoke execute on function public.buyer_styles() from public, anon;
grant execute on function public.buyer_styles() to authenticated;

-- The buyer asks to make one of its styles again: how many, by when, and anything to change.
create function public.buyer_reorder(p_line uuid, p_qty integer, p_by date default null, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_buyer uuid := public.my_buyer();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_l record;
  v_name text;
  v_no text;
begin
  if v_buyer is null then
    raise exception 'This login is not set up for a buyer.';
  end if;
  select l.id, l.style, l.colour, l.description, l.product, o.order_no, o.buyer_po, o.merchandiser_id into v_l
  from public.order_lines l join public.orders o on o.id = l.order_id
  where l.id = p_line and o.company_id = v_company and o.buyer_id = v_buyer and o.removed_at is null and l.removed_at is null;
  if v_l.id is null then
    raise exception 'Pick one of your styles.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000000 then
    raise exception 'Enter how many % you need.', case when v_l.product = 'fabric' then 'metres' else 'pieces' end;
  end if;
  if p_by is not null and (p_by < v_today + 7 or p_by > v_today + 730) then
    raise exception 'Pick a date at least a week from today, or leave it empty.';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1,000 characters.';
  end if;
  if exists (select 1 from public.inquiries i join public.order_lines l on l.id = i.reorder_of
             where i.buyer_id = v_buyer and i.status in ('new', 'quoted')
               and lower(btrim(l.style)) = lower(btrim(v_l.style)) and lower(btrim(coalesce(l.colour, ''))) = lower(btrim(coalesce(v_l.colour, '')))) then
    raise exception 'You already asked to make % again. Your merchandiser will come back with the price and date.', v_l.style;
  end if;
  if (select count(*) from public.inquiries where buyer_id = v_buyer and reorder_of is not null and created_at > now() - interval '1 day') >= 30 then
    raise exception 'That is a lot of reorders for one day. Message your Sourcingo merchandiser.';
  end if;
  select n.real_name into v_name from public.buyer_names n where n.buyer_id = v_buyer;
  insert into public.inquiries (company_id, buyer_id, contact_name, source, product, est_qty, unit, merchandiser_id, next_follow_up,
                                notes, reorder_of, created_by)
  values (v_company, v_buyer, left(coalesce((select p.name from public.buyer_people p where p.user_id = auth.uid()), v_name), 120), 'other',
          left('Reorder: ' || v_l.style || coalesce(' ' || v_l.colour, '') || coalesce(' · ' || v_l.description, ''), 200),
          p_qty, case when v_l.product = 'fabric' then 'm' else 'pcs' end, v_l.merchandiser_id, v_today,
          'Asked on the buyer''s page to make again, as in PO ' || coalesce(v_l.buyer_po, v_l.order_no) || ' (' || v_l.order_no || ').'
            || coalesce(' Needed by ' || to_char(p_by, 'FMDD Mon YYYY') || '.', '') || coalesce(E'\n' || v_note, ''),
          v_l.id, auth.uid())
  returning inquiry_no into v_no;
  return v_no;
end $$;
revoke execute on function public.buyer_reorder(uuid, integer, date, text) from public, anon;
grant execute on function public.buyer_reorder(uuid, integer, date, text) to authenticated;
