-- Quality as a number (six-month plan, batch 9): defect analytics over every QC check, and the buyer's own rating of
-- each delivered order. Both feed the Factory Record: the team sees which factory makes which defect and how buyers
-- felt; the factory sees what to fix; the buyer rates in private and never sees who made the order.

-- ================================================================ defect analytics
-- Every live check with the factory (or factories, for a check saved on a whole order) whose styles it covered.
create function public.qc_by_factory(p_company uuid, p_since date) returns table (
  check_id uuid, order_id uuid, line_id uuid, factory_id uuid, product text, kind text, checked_on date, created_at timestamptz,
  result text, pieces_checked integer, defects integer)
language sql stable security definer set search_path = '' as $$
  select distinct on (q.id, l.factory_id) q.id, q.order_id, q.line_id, l.factory_id, l.product, q.kind, q.checked_on, q.created_at,
         q.result, q.pieces_checked, q.defects
  from public.qc_checks q
  join public.orders o on o.id = q.order_id and o.removed_at is null and o.status <> 'cancelled'
  join public.order_lines l on l.order_id = q.order_id and l.removed_at is null and l.factory_id is not null and (q.line_id is null or q.line_id = l.id)
  where q.company_id = p_company and q.cancelled_at is null and q.checked_on >= p_since
$$;
revoke execute on function public.qc_by_factory(uuid, date) from public, anon, authenticated;

-- The team's view: top defects, defects by factory and by kind of check, and first-time Final QC pass by month.
-- p_factory narrows it to one factory; p_days is how far back (the monthly pass rate always covers 12 months).
create function public.defect_stats(p_factory uuid default null, p_days integer default 365) returns jsonb
language sql stable security definer set search_path = '' as $$
  with q as (
    select * from public.qc_by_factory(public.current_company(), public.india_today() - least(greatest(coalesce(p_days, 365), 7), 730))
    where p_factory is null or factory_id = p_factory
  ), q12 as (
    select * from public.qc_by_factory(public.current_company(), (date_trunc('month', public.india_today()) - interval '11 months')::date)
    where p_factory is null or factory_id = p_factory
  ), d as (
    -- One row per defect line per factory; the name is grouped without case or extra spaces.
    select q.factory_id, q.product, q.kind, lower(regexp_replace(btrim(x.defect), '\s+', ' ', 'g')) as k, x.defect, x.pieces, x.severity, x.check_id
    from public.qc_defects x join q on q.check_id = x.check_id
    where x.removed_at is null
  ), top as (
    select k, mode() within group (order by defect) as defect, sum(pieces) as pieces, count(distinct check_id) as checks,
           sum(pieces) filter (where severity = 'critical') as critical, sum(pieces) filter (where severity = 'major') as major,
           sum(pieces) filter (where severity = 'minor') as minor
    from d group by k order by sum(pieces) desc, k limit 10
  ), fac as (
    select q.factory_id, count(*) as checks, count(*) filter (where q.result = 'fail') as failed,
           coalesce(sum(q.pieces_checked), 0) as pieces_checked, coalesce(sum(q.defects), 0) as defects
    from q group by 1
  ), fac_top as (
    select factory_id, jsonb_agg(jsonb_build_object('defect', defect, 'pieces', pieces) order by pieces desc, defect) filter (where rn <= 3) as top
    from (select factory_id, mode() within group (order by defect) as defect, sum(pieces) as pieces,
                 row_number() over (partition by factory_id order by sum(pieces) desc, k) as rn
          from d group by factory_id, k) z
    group by 1
  ), kinds as (
    select kind, count(*) as checks, count(*) filter (where result = 'fail') as failed,
           coalesce(sum(pieces_checked), 0) as pieces_checked, coalesce(sum(defects), 0) as defects
    from q group by 1
  ), firsts as (
    -- The first Final check of each style (or whole order) for each factory, by check date.
    select distinct on (factory_id, order_id, coalesce(line_id, factory_id)) factory_id, checked_on, result
    from q12 where kind = 'final' order by factory_id, order_id, coalesce(line_id, factory_id), checked_on, created_at
  ), months as (
    select to_char(date_trunc('month', checked_on), 'YYYY-MM') as month, count(*) as firsts, count(*) filter (where result = 'pass') as passed
    from firsts group by 1
  )
  select case when not public.is_member(public.current_company()) then null else jsonb_build_object(
    'top', (select coalesce(jsonb_agg(jsonb_build_object('defect', defect, 'pieces', pieces, 'checks', checks,
                                  'critical', coalesce(critical, 0), 'major', coalesce(major, 0), 'minor', coalesce(minor, 0)) order by pieces desc, k), '[]'::jsonb) from top),
    'factories', (select coalesce(jsonb_agg(jsonb_build_object('factory_id', fac.factory_id, 'name', f.name, 'checks', fac.checks, 'failed', fac.failed,
                                  'pieces_checked', fac.pieces_checked, 'defects', fac.defects, 'top', coalesce(ft.top, '[]'::jsonb))
                                  order by f.name), '[]'::jsonb)
                  from fac join public.factories f on f.id = fac.factory_id left join fac_top ft on ft.factory_id = fac.factory_id),
    'kinds', (select coalesce(jsonb_agg(to_jsonb(kinds) order by array_position(array['inline', 'midline', 'final', 'recheck'], kind)), '[]'::jsonb) from kinds),
    'months', (select coalesce(jsonb_agg(to_jsonb(months) order by month), '[]'::jsonb) from months),
    'since', public.india_today() - least(greatest(coalesce(p_days, 365), 7), 730)
  ) end
$$;
revoke execute on function public.defect_stats(uuid, integer) from public, anon;
grant execute on function public.defect_stats(uuid, integer) to authenticated;

-- The factory's own: the defects Sourcingo found most on its styles in the last 90 days, so it knows what to fix.
create function public.factory_defects_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('defect', defect, 'pieces', pieces, 'checks', checks) order by pieces desc, defect), '[]'::jsonb)
  from (
    select mode() within group (order by x.defect) as defect, sum(x.pieces) as pieces, count(distinct x.check_id) as checks
    from public.qc_defects x
    join public.qc_by_factory(public.current_company(), public.india_today() - 90) q on q.check_id = x.check_id
    where x.removed_at is null and q.factory_id = public.viewing_factory()
    group by lower(regexp_replace(btrim(x.defect), '\s+', ' ', 'g'))
    order by 2 desc limit 5
  ) t
  where public.viewing_factory() is not null
$$;
revoke execute on function public.defect_stats(uuid, integer), public.factory_defects_mine() from public, anon;
grant execute on function public.factory_defects_mine() to authenticated;

-- ================================================================ the buyer rates each delivered order
create table public.order_ratings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  order_id uuid not null unique references public.orders (id),
  buyer_id uuid not null references public.buyers (id),
  score integer not null check (score between 1 and 5),
  comment text check (length(comment) <= 600),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The team read a low rating and acted on it.
  seen_by uuid references public.profiles (id),
  seen_at timestamptz
);
create index order_ratings_company_idx on public.order_ratings (company_id, created_at desc);
alter table public.order_ratings enable row level security;
revoke all on public.order_ratings from public, anon, authenticated;
grant select on public.order_ratings to authenticated;
create policy order_ratings_read on public.order_ratings for select to authenticated using (public.is_member(company_id));

-- A buyer may rate an order once goods have left for it (shipped, or a part shipped), and change its rating for 30 days.
create function public.rate_order(p_order uuid, p_score integer, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := public.my_buyer();
  v_o public.orders%rowtype;
  v_r public.order_ratings%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_o from public.orders where id = p_order and company_id = public.current_company() and removed_at is null;
  if v_buyer is null or v_o.id is null or v_o.buyer_id <> v_buyer then
    raise exception 'Only the buyer of this order can rate it.';
  end if;
  if v_o.status <> 'shipped' and not exists (select 1 from public.dispatches d where d.order_id = v_o.id and d.cancelled_at is null and d.shipped_at is not null) then
    raise exception 'You can rate this order once its goods have left.';
  end if;
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'Pick 1 to 5 stars.';
  end if;
  if length(v_comment) > 600 then
    raise exception 'Keep the comment under 600 characters.';
  end if;
  select * into v_r from public.order_ratings where order_id = v_o.id;
  if v_r.id is null then
    insert into public.order_ratings (company_id, order_id, buyer_id, score, comment) values (v_o.company_id, v_o.id, v_buyer, p_score, v_comment);
  elsif v_r.created_at < now() - interval '30 days' then
    raise exception 'A rating can be changed for 30 days. Write to us on the PO instead.';
  else
    update public.order_ratings set score = p_score, comment = v_comment, updated_at = now(), seen_by = null, seen_at = null where id = v_r.id;
  end if;
end $$;

-- The buyer's own ratings (and in a team member's preview of its page, the same, with nothing to press).
create function public.buyer_ratings_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', order_id, 'score', score, 'comment', comment, 'created_at', created_at)), '[]'::jsonb)
  from public.order_ratings where buyer_id = public.viewing_buyer() and company_id = public.current_company()
$$;

-- The team marks a rating read (a low one waits on Home until then).
create function public.see_order_rating(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(public.current_company()) then
    raise exception 'Only the team can do that.';
  end if;
  update public.order_ratings set seen_by = auth.uid(), seen_at = now() where id = p_id and company_id = public.current_company() and seen_at is null;
end $$;

-- What buyers said about the orders each factory made: the team reads every rating; a factory only its own average,
-- and only once three buyers have rated, so no single buyer can be picked out.
create function public.factory_ratings(p_factory uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.is_member(public.current_company()) then '[]'::jsonb else (
    select coalesce(jsonb_agg(jsonb_build_object('factory_id', x.factory_id, 'order_id', r.order_id, 'order_no', o.order_no, 'buyer_id', r.buyer_id,
                                                 'score', r.score, 'comment', r.comment, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    from public.order_ratings r
    join public.orders o on o.id = r.order_id
    join (select distinct order_id, factory_id from public.order_lines where removed_at is null and factory_id is not null) x on x.order_id = r.order_id
    where r.company_id = public.current_company() and (p_factory is null or x.factory_id = p_factory)) end
$$;
create function public.factory_rating_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when count(*) >= 3 then jsonb_build_object('ratings', count(*), 'average', round(avg(r.score), 1)) end
  from public.order_ratings r
  where r.company_id = public.current_company() and public.viewing_factory() is not null
    and exists (select 1 from public.order_lines l where l.order_id = r.order_id and l.removed_at is null and l.factory_id = public.viewing_factory())
$$;
revoke execute on function public.rate_order(uuid, integer, text), public.buyer_ratings_mine(), public.see_order_rating(uuid),
  public.factory_ratings(uuid), public.factory_rating_mine() from public, anon;
grant execute on function public.rate_order(uuid, integer, text), public.buyer_ratings_mine(), public.see_order_rating(uuid),
  public.factory_ratings(uuid), public.factory_rating_mine() to authenticated;
