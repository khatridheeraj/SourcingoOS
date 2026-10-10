-- Quality checks: inline and final inspections on an order. A wrong check is
-- cancelled with a reason, never deleted. An order can only be marked shipped
-- once its latest final check has passed (the owner can override).

create table public.qc_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company() references public.companies (id),
  order_id uuid not null,
  kind text not null check (kind in ('inline', 'final')),
  checked_on date not null default public.india_today(),
  result text not null check (result in ('pass', 'fail')),
  pieces_checked integer check (pieces_checked > 0),
  defects integer not null default 0 check (defects >= 0),
  notes text,
  checked_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  foreign key (company_id, order_id) references public.orders (company_id, id),
  constraint qc_defects_within_checked check (pieces_checked is null or defects <= pieces_checked),
  constraint qc_fail_needs_notes check (result = 'pass' or nullif(btrim(notes), '') is not null),
  constraint qc_cancel_needs_reason check (cancelled_at is null or nullif(btrim(cancel_reason), '') is not null)
);
create index qc_checks_order_idx on public.qc_checks (order_id, checked_on desc, created_at desc);

create trigger qc_checks_history after insert or update or delete on public.qc_checks
  for each row execute function public.record_history();

-- A saved check is a record of what was seen that day: it can only be cancelled, once.
create function public.guard_qc() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.cancelled_at is not null then
    raise exception 'This QC check is already cancelled.';
  end if;
  if (new.order_id, new.kind, new.checked_on, new.result, new.pieces_checked, new.defects, new.notes, new.checked_by, new.company_id)
     is distinct from (old.order_id, old.kind, old.checked_on, old.result, old.pieces_checked, old.defects, old.notes, old.checked_by, old.company_id) then
    raise exception 'A saved QC check can''t be changed. Cancel it and record a new one.';
  end if;
  return new;
end $$;
create trigger qc_checks_guard before update on public.qc_checks for each row execute function public.guard_qc();

-- True when the order's latest final check (not cancelled) passed.
create function public.final_qc_passed(p_order uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select result = 'pass' from public.qc_checks
                   where order_id = p_order and kind = 'final' and cancelled_at is null
                   order by checked_on desc, created_at desc limit 1), false)
$$;

-- Shipping waits for a passed final check. The owner, and Claude's own loads (no signed-in person), can override.
create function public.guard_ship() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status is distinct from 'shipped')
     and auth.uid() is not null and not public.is_owner(new.company_id)
     and (tg_op = 'INSERT' or not public.final_qc_passed(new.id)) then
    raise exception 'Record a passed final QC before marking this order shipped.' using errcode = 'P0001', hint = 'final_qc_required';
  end if;
  return new;
end $$;
create trigger orders_ship_guard before insert or update on public.orders for each row execute function public.guard_ship();

alter table public.qc_checks enable row level security;
revoke all on public.qc_checks from anon, authenticated;
grant select, insert, update on public.qc_checks to authenticated;
create policy qc_checks_read on public.qc_checks for select to authenticated using (public.is_member(company_id));
create policy qc_checks_insert on public.qc_checks for insert to authenticated
  with check (public.is_member(company_id) and checked_by = auth.uid() and cancelled_at is null);
create policy qc_checks_update on public.qc_checks for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

revoke execute on function public.guard_qc(), public.guard_ship(), public.stamp_stage() from public, anon, authenticated;
revoke execute on function public.final_qc_passed(uuid) from public, anon;
grant execute on function public.final_qc_passed(uuid) to authenticated;
