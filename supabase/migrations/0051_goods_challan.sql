-- Goods with us and the delivery challan.
-- Goods bought from a factory sit with us until they ship; the app shows them on one board with a 24-hour clock.
-- Each dispatch can print a delivery challan (packing list): it gets a DC number the first time, kept for good.
-- The challan shows our address and GSTIN (set by the owner) and the buyer's delivery address (set by the orders team).

alter table public.companies add column address text check (length(address) <= 500),
  add column gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  add column next_challan_no integer not null default 1;
alter table public.buyers add column delivery_address text check (length(delivery_address) <= 500);
grant select (delivery_address) on public.buyers to authenticated;
alter table public.dispatches add column challan_no text, add column challan_at timestamptz;
create unique index dispatches_challan_key on public.dispatches (company_id, challan_no) where challan_no is not null;

-- Gives a dispatch its challan number (DC-0001 onwards), or returns the one it already has.
create function public.issue_challan(p_dispatch uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.dispatches%rowtype;
  v_no integer;
begin
  select * into v_d from public.dispatches where id = p_dispatch for update;
  if v_d.id is null or v_d.company_id is distinct from public.current_company() or not public.can_edit_orders(v_d.company_id) then
    raise exception 'Only the orders team can print a delivery challan.';
  end if;
  if v_d.cancelled_at is not null then
    raise exception 'This dispatch was cancelled, so it has no challan.';
  end if;
  if v_d.challan_no is not null then
    return v_d.challan_no;
  end if;
  update public.companies set next_challan_no = next_challan_no + 1 where id = v_d.company_id returning next_challan_no - 1 into v_no;
  update public.dispatches set challan_no = 'DC-' || lpad(v_no::text, 4, '0'), challan_at = now() where id = p_dispatch;
  return 'DC-' || lpad(v_no::text, 4, '0');
end $$;
revoke execute on function public.issue_challan(uuid) from public, anon;
grant execute on function public.issue_challan(uuid) to authenticated;

-- Where the buyer's goods are delivered. The orders team keeps it, since they print the challans.
create function public.set_buyer_delivery(p_buyer uuid, p_address text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.buyers where id = p_buyer;
  if v_company is null or v_company is distinct from public.current_company() or not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can change a buyer''s delivery address.';
  end if;
  if length(p_address) > 500 then
    raise exception 'Keep the address under 500 letters.';
  end if;
  update public.buyers set delivery_address = nullif(btrim(p_address), '') where id = p_buyer;
end $$;
revoke execute on function public.set_buyer_delivery(uuid, text) from public, anon;
grant execute on function public.set_buyer_delivery(uuid, text) to authenticated;

-- Our address and GSTIN on challans. The owner keeps them.
create function public.set_company_details(p_address text, p_gstin text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_gstin text := nullif(upper(btrim(p_gstin)), '');
begin
  if v_company is null or not public.is_owner(v_company) then
    raise exception 'Only the owner can change the company''s address and GSTIN.';
  end if;
  if length(p_address) > 500 then
    raise exception 'Keep the address under 500 letters.';
  end if;
  if v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'That GSTIN doesn''t look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5.';
  end if;
  update public.companies set address = nullif(btrim(p_address), ''), gstin = v_gstin where id = v_company;
end $$;
revoke execute on function public.set_company_details(text, text) from public, anon;
grant execute on function public.set_company_details(text, text) to authenticated;
