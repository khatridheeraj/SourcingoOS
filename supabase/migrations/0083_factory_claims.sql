-- Factory claims (Dheeraj, 10 Nov 2026: complete the team panels). When goods come short, fail QC, need rework or
-- arrive late, Accounts raises a claim against the factory's bill: what went wrong, how many pieces, how much.
-- The claim prints as a debit note to send the factory, and Bills to pay takes it off what to pay until the same
-- debit note shows in Tally (Tally stays read only: Accounts books it there by hand, the app only reads it back).
-- Claims are never deleted: a wrong one is cancelled, with the reason kept.

create table public.factory_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  claim_no text not null,
  ledger text not null check (btrim(ledger) <> ''),           -- the supplier's ledger in Tally
  bill text check (bill is null or btrim(bill) <> ''),         -- the purchase bill it is against, when known
  order_id uuid,
  claim_date date not null,
  reason text not null check (reason in ('short', 'quality', 'rework', 'late', 'other')),
  pieces integer check (pieces > 0 and pieces <= 10000000),
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  note text not null check (char_length(btrim(note)) between 1 and 500),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create unique index factory_claims_no_key on public.factory_claims (company_id, claim_no);
create index factory_claims_ledger_idx on public.factory_claims (company_id, ledger) where cancelled_at is null;

alter table public.factory_claims enable row level security;
revoke all on public.factory_claims from anon, authenticated;
grant select on public.factory_claims to authenticated;
create policy factory_claims_read on public.factory_claims for select to authenticated using (public.is_finance(company_id));

-- Money stays with the owner and Accounts in the activity log too (as 0056, with factory_claims added).
alter policy history_read on public.history using (
  company_id = (select public.current_company())
  and ((select public.my_role(public.current_company())) = 'owner'
    or (table_name not in ('buyer_names', 'incoming_pos', 'inbound_keys', 'ai_keys') and (
      (select public.my_role(public.current_company())) = 'accounts'
      or ((select public.my_role(public.current_company())) in ('manager', 'merchandiser', 'quality')
          and table_name not in ('invoices', 'credit_notes', 'cheques', 'cheque_allocations', 'tally_settings', 'tally_vouchers',
                                 'buyers', 'tally_ledgers', 'tally_items', 'supplier_terms', 'bill_notes', 'factory_claims')
          and ((select public.my_role(public.current_company())) <> 'quality'
               or table_name not in ('order_lines', 'dispatch_lines', 'dispatches', 'dispatch_photos')))))));

-- Raises a claim and returns its number, CL-0001 onwards for each company.
create or replace function public.raise_factory_claim(
  p_ledger text, p_bill text, p_order uuid, p_date date, p_reason text, p_pieces integer, p_amount numeric, p_note text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_bill text := nullif(btrim(coalesce(p_bill, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_no text;
begin
  if not public.is_finance(v_company) then
    raise exception 'Only Accounts and the owner can raise factory claims.';
  end if;
  if not exists (select 1 from public.tally_vouchers where company_id = v_company and party = p_ledger and gone_at is null) then
    raise exception 'That supplier isn''t in Tally.';
  end if;
  if v_bill is not null and not exists (
    select 1 from public.tally_vouchers v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.bills) = 'array' then v.bills else '[]'::jsonb end) b
    where v.company_id = v_company and v.party = p_ledger and v.gone_at is null and v.kind = 'purchase' and b ->> 'name' = v_bill) then
    raise exception 'That bill isn''t in Tally for this supplier.';
  end if;
  if p_order is not null and not exists (select 1 from public.orders where id = p_order and company_id = v_company) then
    raise exception 'That order isn''t here any more.';
  end if;
  if p_date is null or p_date > public.india_today() then
    raise exception 'The claim date can''t be in the future.';
  end if;
  if p_reason is null or p_reason not in ('short', 'quality', 'rework', 'late', 'other') then
    raise exception 'Pick what went wrong.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Write the amount to claim.';
  end if;
  if round(p_amount, 2) <> p_amount then
    raise exception 'The amount can have at most two decimals.';
  end if;
  if v_note is null then
    raise exception 'Say what happened, so the factory knows what the claim is for.';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Keep the note under 500 letters.';
  end if;
  -- One number after another, even when two people raise a claim at the same moment.
  perform pg_advisory_xact_lock(hashtext('factory_claims:' || v_company::text));
  select 'CL-' || lpad((coalesce(max(substring(claim_no from 4)::integer), 0) + 1)::text, 4, '0') into v_no
  from public.factory_claims where company_id = v_company and claim_no ~ '^CL-[0-9]+$';
  insert into public.factory_claims (company_id, claim_no, ledger, bill, order_id, claim_date, reason, pieces, amount, note)
  values (v_company, v_no, p_ledger, v_bill, p_order, p_date, p_reason, p_pieces, p_amount, v_note);
  return v_no;
end $$;
revoke execute on function public.raise_factory_claim(text, text, uuid, date, text, integer, numeric, text) from public, anon;
grant execute on function public.raise_factory_claim(text, text, uuid, date, text, integer, numeric, text) to authenticated;

-- Cancels a claim raised by mistake. The claim stays, marked cancelled, with why.
create or replace function public.cancel_factory_claim(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.factory_claims%rowtype;
begin
  select * into v_c from public.factory_claims where id = p_id;
  if v_c.id is null or v_c.company_id is distinct from public.current_company() then
    raise exception 'That claim isn''t here any more. Reload the page.';
  end if;
  if not public.is_finance(v_c.company_id) then
    raise exception 'Only Accounts and the owner can cancel factory claims.';
  end if;
  if v_c.cancelled_at is not null then
    return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the claim is cancelled.';
  end if;
  update public.factory_claims set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(btrim(p_reason), 300)
  where id = p_id;
end $$;
revoke execute on function public.cancel_factory_claim(uuid, text) from public, anon;
grant execute on function public.cancel_factory_claim(uuid, text) to authenticated;
