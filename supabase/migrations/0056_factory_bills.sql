-- Factory bills and when each falls due.
-- Every bill comes from Tally (PURCHASE vouchers) and every payment too, read only: nothing here writes to Tally.
-- A bill falls due its supplier's payment days after the bill date (60 unless set). Micro and small enterprises
-- (MSMED Act, Udyam registered) must be paid within 45 days, so their bills fall due at the earlier of the two.

-- ---------------------------------------------------------------- terms per supplier
-- Keyed by the supplier's ledger in Tally, so it covers factories and every other supplier the same way.
create table public.supplier_terms (
  company_id uuid not null references public.companies (id),
  ledger text not null,
  days integer check (days between 0 and 365),               -- null: the usual 60
  msme text check (msme in ('micro', 'small', 'medium', 'none')),  -- null: not known yet
  udyam_no text check (udyam_no ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, ledger)
);

-- A note on one bill, and whether it is held back (a quality claim, a short delivery).
create table public.bill_notes (
  company_id uuid not null references public.companies (id),
  ledger text not null,
  bill text not null,
  hold boolean not null default false,
  note text check (char_length(note) <= 300),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (company_id, ledger, bill)
);

alter table public.supplier_terms enable row level security;
alter table public.bill_notes enable row level security;
revoke all on public.supplier_terms, public.bill_notes from anon, authenticated;
grant select on public.supplier_terms, public.bill_notes to authenticated;
create policy supplier_terms_read on public.supplier_terms for select to authenticated using (public.is_finance(company_id));
create policy bill_notes_read on public.bill_notes for select to authenticated using (public.is_finance(company_id));

-- Money stays with the owner and Accounts in the activity log too.
alter policy history_read on public.history using (
  company_id = (select public.current_company())
  and ((select public.my_role(public.current_company())) = 'owner'
    or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
      (select public.my_role(public.current_company())) = 'accounts'
      or ((select public.my_role(public.current_company())) in ('manager', 'merchandiser', 'quality')
          and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                                 'buyers', 'tally_ledgers', 'tally_items', 'supplier_terms', 'bill_notes')
          and ((select public.my_role(public.current_company())) <> 'quality'
               or table_name not in ('order_lines', 'dispatch_lines', 'dispatches', 'dispatch_photos')))))));

-- The usual payment days when a supplier has none set.
create function public.default_payment_days() returns integer
language sql immutable set search_path = '' as $$ select 60 $$;
grant execute on function public.default_payment_days() to authenticated;

-- ---------------------------------------------------------------- saving
create function public.save_supplier_terms(p_ledger text, p_days integer, p_msme text, p_udyam text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_udyam text := nullif(upper(regexp_replace(coalesce(p_udyam, ''), '\s', '', 'g')), '');
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner can set payment terms.';
  end if;
  if not exists (select 1 from public.tally_ledgers where company_id = v_company and name = p_ledger) then
    raise exception 'That supplier isn''t in Tally''s ledgers.';
  end if;
  if p_days is not null and (p_days < 0 or p_days > 365) then
    raise exception 'Payment days must be between 0 and 365.';
  end if;
  if p_msme is not null and p_msme not in ('micro', 'small', 'medium', 'none') then
    raise exception 'Choose micro, small, medium or not registered.';
  end if;
  if v_udyam is not null and v_udyam !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then
    raise exception 'A Udyam number looks like UDYAM-RJ-17-0012345.';
  end if;
  if v_udyam is not null and coalesce(p_msme, 'none') = 'none' then
    raise exception 'A supplier with a Udyam number is micro, small or medium. Choose which.';
  end if;
  insert into public.supplier_terms as t (company_id, ledger, days, msme, udyam_no, updated_by, updated_at)
  values (v_company, p_ledger, p_days, p_msme, v_udyam, auth.uid(), now())
  on conflict (company_id, ledger) do update
    set days = excluded.days, msme = excluded.msme, udyam_no = excluded.udyam_no, updated_by = excluded.updated_by, updated_at = now()
    where (t.days, t.msme, t.udyam_no) is distinct from (excluded.days, excluded.msme, excluded.udyam_no);
end $$;
revoke execute on function public.save_supplier_terms(text, integer, text, text) from public, anon;
grant execute on function public.save_supplier_terms(text, integer, text, text) to authenticated;

create function public.save_bill_note(p_ledger text, p_bill text, p_hold boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner can hold a bill or add a note.';
  end if;
  if not exists (select 1 from public.tally_vouchers v, jsonb_array_elements(case when jsonb_typeof(v.bills) = 'array' then v.bills else '[]'::jsonb end) b
                 where v.company_id = v_company and v.kind = 'purchase' and v.party = p_ledger and b ->> 'name' = p_bill) then
    raise exception 'That bill isn''t in Tally.';
  end if;
  if coalesce(p_hold, false) and v_note is null then
    raise exception 'Say why the bill is on hold, so Accounts knows when to release it.';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 letters.';
  end if;
  insert into public.bill_notes as n (company_id, ledger, bill, hold, note, updated_by, updated_at)
  values (v_company, p_ledger, p_bill, coalesce(p_hold, false), v_note, auth.uid(), now())
  on conflict (company_id, ledger, bill) do update
    set hold = excluded.hold, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
    where (n.hold, n.note) is distinct from (excluded.hold, excluded.note);
end $$;
revoke execute on function public.save_bill_note(text, text, boolean, text) from public, anon;
grant execute on function public.save_bill_note(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- what is still to pay
-- One row per bill with money left on it, worked out like Tally's own bills outstanding:
-- 1. A purchase bill, less every payment, debit note or journal that Tally sets against that bill by name.
-- 2. Payments made "on account" (no bill named) still lower what is owed. Tally's ledger balance is the truth, so
--    when the bills add up to more than the balance, the difference is taken off the oldest bills first.
-- 3. When the balance is more than the bills (bills from before Tally was first read), the rest is one row with no bill.
create function public.payables_for(p_company uuid, p_today date)
returns table (
  ledger text, factory_id uuid, factory text, bill text, bill_date date, amount numeric, settled numeric, on_account numeric,
  open numeric, last_paid date, days integer, msme text, udyam_no text, agreed_due date, due_on date, hold boolean, note text,
  order_id uuid, order_no text)
language sql stable security definer set search_path = '' as $$
  with pv as (
    select v.guid, v.party, v.vdate, b ->> 'name' as bill, (b ->> 'amount')::numeric as amount
    from public.tally_vouchers v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.bills) = 'array' then v.bills else '[]'::jsonb end) b
    where v.company_id = p_company and v.gone_at is null and v.kind = 'purchase' and coalesce(b ->> 'name', '') <> ''),
  bills as (
    select party, bill, min(vdate) as bill_date, sum(amount) as amount, array_agg(guid) as guids
    from pv group by party, bill),
  refs as (
    select v.party, b ->> 'name' as bill, sum((b ->> 'amount')::numeric) as amount, max(v.vdate) filter (where v.kind = 'payment') as last_paid
    from public.tally_vouchers v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.bills) = 'array' then v.bills else '[]'::jsonb end) b
    where v.company_id = p_company and v.gone_at is null and v.kind <> 'purchase'
      and v.party in (select party from bills)
    group by v.party, b ->> 'name'),
  by_ref as (
    select b.party, b.bill, b.bill_date, b.amount, b.guids, coalesce(r.amount, 0) as settled, r.last_paid,
           greatest(b.amount - coalesce(r.amount, 0), 0) as left_ref
    from bills b left join refs r on r.party = b.party and r.bill = b.bill),
  ledgers as (
    select x.party, sum(x.left_ref) as left_sum,
           -- What Tally says is owed; a supplier with no ledger row keeps its bills as they are.
           coalesce((select greatest(-l.balance, 0) from public.tally_ledgers l
                     where l.company_id = p_company and l.name = x.party and l.gone_at is null limit 1), sum(x.left_ref)) as owed
    from by_ref x group by x.party),
  fifo as (
    select x.*, l.owed, greatest(l.left_sum - l.owed, 0) as extra,
           sum(x.left_ref) over (partition by x.party order by x.bill_date, x.bill rows between unbounded preceding and current row) - x.left_ref as before
    from by_ref x join ledgers l on l.party = x.party),
  rows_ as (
    select f.party, f.bill, f.bill_date, f.amount, f.settled, f.last_paid, f.guids,
           least(f.left_ref, greatest(f.extra - f.before, 0)) as on_account,
           f.left_ref - least(f.left_ref, greatest(f.extra - f.before, 0)) as open
    from fifo f
    union all
    select l.party, null, null, null, 0, null, null, 0, l.owed - l.left_sum
    from ledgers l where l.owed - l.left_sum > 1)
  select r.party, f.id, f.name, r.bill, r.bill_date, r.amount, r.settled, r.on_account, round(r.open, 2), r.last_paid,
         coalesce(t.days, public.default_payment_days()), t.msme, t.udyam_no,
         r.bill_date + coalesce(t.days, public.default_payment_days()),
         case when t.msme in ('micro', 'small') then r.bill_date + least(coalesce(t.days, public.default_payment_days()), 45)
              else r.bill_date + coalesce(t.days, public.default_payment_days()) end,
         coalesce(n.hold, false), n.note, o.id, o.order_no
  from rows_ r
  left join lateral (select ff.id, ff.name from public.factories ff where ff.company_id = p_company and ff.tally_ledger = r.party
                     order by ff.active desc, ff.created_at limit 1) f on true
  left join public.supplier_terms t on t.company_id = p_company and t.ledger = r.party
  left join public.bill_notes n on n.company_id = p_company and n.ledger = r.party and n.bill = r.bill
  left join lateral (select oo.id, oo.order_no from public.dispatches d join public.orders oo on oo.id = d.order_id
                     where d.company_id = p_company and d.cancelled_at is null and d.purchase_tally = any (r.guids)
                     order by d.created_at limit 1) o on true
  where r.open > 0.99
$$;
revoke execute on function public.payables_for(uuid, date) from public, anon, authenticated;

-- The bills for the signed-in owner or Accounts.
create function public.payables()
returns table (
  ledger text, factory_id uuid, factory text, bill text, bill_date date, amount numeric, settled numeric, on_account numeric,
  open numeric, last_paid date, days integer, msme text, udyam_no text, agreed_due date, due_on date, hold boolean, note text,
  order_id uuid, order_no text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_finance(public.current_company()) then
    raise exception 'Only Accounts and the owner can see bills to pay.';
  end if;
  return query select * from public.payables_for(public.current_company(), public.india_today());
end $$;
revoke execute on function public.payables() from public, anon;
grant execute on function public.payables() to authenticated;

-- ---------------------------------------------------------------- the morning brief
-- Bills overdue or due in the next 7 days, one line per supplier, for the owner and Accounts only.
create function public.brief_payables_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.current_company_id as company, m.role
    from public.profiles p join public.members m on m.company_id = p.current_company_id and m.user_id = p.id and m.active
    where p.id = p_user),
  b as (
    select x.* from me, public.payables_for(me.company, public.india_today()) x
    where me.role in ('owner', 'accounts') and x.bill is not null and not x.hold and x.due_on <= public.india_today() + 7),
  s as (
    select b.ledger, max(coalesce(b.factory, b.ledger)) as name,
           sum(b.open) filter (where b.due_on < public.india_today()) as overdue,
           sum(b.open) filter (where b.due_on >= public.india_today()) as soon,
           count(*) as bills, min(b.due_on) as first_due,
           coalesce(bool_or(b.msme in ('micro', 'small') and b.due_on < public.india_today()), false) as msme_late
    from b group by b.ledger)
  select case when (select role from me) in ('owner', 'accounts')
    then jsonb_build_object('payables', coalesce((
      select jsonb_agg(jsonb_build_object('ledger', s.ledger, 'name', s.name, 'overdue', coalesce(s.overdue, 0), 'soon', coalesce(s.soon, 0),
                                          'bills', s.bills, 'first_due', s.first_due, 'msme_late', s.msme_late)
                       order by s.msme_late desc, coalesce(s.overdue, 0) desc, s.first_due)
      from s), '[]'::jsonb))
    else '{}'::jsonb end
$$;
revoke execute on function public.brief_payables_for(uuid) from public, anon, authenticated;

create or replace function public.brief_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.brief_data_for(auth.uid()) || public.brief_payables_for(auth.uid())
$$;

create or replace function public.brief_data_for_email(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with u as (select id from public.profiles where lower(email) = lower(btrim(p_email)) limit 1)
  select public.brief_data_for((select id from u)) || coalesce(public.brief_payables_for((select id from u)), '{}'::jsonb)
$$;
