-- Factory bills and due dates. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000ac', 'accounts@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-0000000000ac'::uuid, 'accounts'),
          ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

-- Tally's copy, as the reader leaves it. Today is pinned by passing dates to payables_for.
insert into public.factories (company_id, name, tally_ledger)
select id, 'Anya', 'A NYA ( PURCHASES )' from public.companies union all
select id, 'Shreeji Arts', 'SHREE JI ARTS ( PURCHASE )' from public.companies;
insert into public.tally_ledgers (company_id, name, parent, balance, seen_at)
select c.id, l.name, 'Sundry Creditors', l.balance, now() from public.companies c,
  (values ('A NYA ( PURCHASES )', -150000), ('SHREE JI ARTS ( PURCHASE )', -330000), ('DHRUVI MILL INDIA', -50000), ('NISHORAMA PVT LTD', 20000)) l (name, balance);
insert into public.tally_vouchers (company_id, guid, vtype, kind, number, vdate, party, amount, bills, seen_at)
select c.id, v.guid, v.vtype, v.kind, v.number, v.vdate::date, v.party, v.amount, v.bills::jsonb, now() from public.companies c,
  (values
    -- Anya: three bills; one paid by name, then 1,00,000 paid on account with no bill named.
    ('a1', 'PURCHASE', 'purchase', 'INV-50', '2026-06-01', 'A NYA ( PURCHASES )', 100000, '[{"name":"INV-50","amount":100000}]'),
    ('a2', 'PURCHASE', 'purchase', 'INV-51', '2026-07-01', 'A NYA ( PURCHASES )', 120000, '[{"name":"INV-51","amount":120000}]'),
    ('a3', 'PURCHASE', 'purchase', 'INV-52', '2026-09-01', 'A NYA ( PURCHASES )', 80000, '[{"name":"INV-52","amount":80000}]'),
    ('a4', 'Payment', 'payment', 'NEFT', '2026-07-10', 'A NYA ( PURCHASES )', 50000, '[{"name":"INV-50","amount":50000}]'),
    ('a5', 'Payment', 'payment', 'NEFT', '2026-08-10', 'A NYA ( PURCHASES )', 100000, '[]'),
    -- Shreeji: one bill less a debit note, and 25,000 more owed from before Tally was read.
    ('s1', 'PURCHASE', 'purchase', 'SJ/39', '2026-09-15', 'SHREE JI ARTS ( PURCHASE )', 310000, '[{"name":"SJ/39","amount":310000}]'),
    ('s2', 'Debit Note', 'debit_note', 'DN/1', '2026-09-20', 'SHREE JI ARTS ( PURCHASE )', 5000, '[{"name":"SJ/39","amount":5000}]'),
    -- Dhruvi: a mill, micro enterprise, 60 days agreed.
    ('d1', 'PURCHASE', 'purchase', 'DM-7', '2026-09-01', 'DHRUVI MILL INDIA', 50000, '[{"name":"DM-7","amount":50000}]'),
    -- Nishorama: paid in advance, nothing owed.
    ('n1', 'PURCHASE', 'purchase', 'NP-1', '2026-09-23', 'NISHORAMA PVT LTD', 114030, '[{"name":"NP-1","amount":114030}]'),
    -- A purchase gone from Tally doesn't count.
    ('g1', 'PURCHASE', 'purchase', 'OLD-1', '2026-05-01', 'DHRUVI MILL INDIA', 9999, '[{"name":"OLD-1","amount":9999}]')
  ) v (guid, vtype, kind, number, vdate, party, amount, bills);
update public.tally_vouchers set gone_at = now() where guid = 'g1';

-- ---------------------------------------------------------------- the bills, worked out
do $$
declare
  c uuid := (select id from public.companies);
  r record;
begin
  -- Anya owes 1,50,000. By bill: INV-50 50,000 left, INV-51 1,20,000, INV-52 80,000 = 2,50,000;
  -- the 1,00,000 on account comes off the oldest first: INV-50 cleared, INV-51 down to 70,000.
  if exists (select 1 from public.payables_for(c, '2026-10-21') where bill = 'INV-50') then raise exception 'INV-50 should be settled on account'; end if;
  select * into r from public.payables_for(c, '2026-10-21') where bill = 'INV-51';
  if r.open <> 70000 or r.on_account <> 50000 or r.settled <> 0 then raise exception 'INV-51 wrong: %', row_to_json(r); end if;
  if r.due_on <> '2026-08-30' or r.days <> 60 or r.factory <> 'Anya' then raise exception 'INV-51 due wrong: %', row_to_json(r); end if;
  select * into r from public.payables_for(c, '2026-10-21') where bill = 'INV-52';
  if r.open <> 80000 or r.due_on <> '2026-10-31' then raise exception 'INV-52 wrong: %', row_to_json(r); end if;
  if (select sum(open) from public.payables_for(c, '2026-10-21') where ledger = 'A NYA ( PURCHASES )') <> 150000 then raise exception 'Anya total is not the Tally balance'; end if;

  -- Shreeji: the debit note is set against the bill, and the older 25,000 is one row with no bill.
  select * into r from public.payables_for(c, '2026-10-21') where bill = 'SJ/39';
  if r.open <> 305000 or r.settled <> 5000 then raise exception 'SJ/39 wrong: %', row_to_json(r); end if;
  select * into r from public.payables_for(c, '2026-10-21') where ledger = 'SHREE JI ARTS ( PURCHASE )' and bill is null;
  if r.open <> 25000 or r.due_on is not null then raise exception 'older balance wrong: %', row_to_json(r); end if;

  if exists (select 1 from public.payables_for(c, '2026-10-21') where ledger = 'NISHORAMA PVT LTD') then raise exception 'an advance shows as owed'; end if;
  if exists (select 1 from public.payables_for(c, '2026-10-21') where bill = 'OLD-1') then raise exception 'a bill gone from Tally shows'; end if;
end $$;

-- ---------------------------------------------------------------- who sees and sets what
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.payables();
  raise exception 'a merchandiser sees bills to pay';
exception when raise_exception then
  if sqlerrm <> 'Only Accounts and the owner can see bills to pay.' then raise; end if;
end $$;
do $$ begin
  perform public.save_supplier_terms('DHRUVI MILL INDIA', 30, null, null);
  raise exception 'a merchandiser set terms';
exception when raise_exception then
  if sqlerrm <> 'Only Accounts and the owner can set payment terms.' then raise; end if;
end $$;
do $$ begin
  perform public.payables_for((select id from public.companies), '2026-10-21');
  raise exception 'payables_for is open to signed-in users';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if (public.brief_data() ? 'payables') then raise exception 'the merchandiser brief has payables'; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
do $$ begin
  if (select count(*) from public.payables()) <> 5 then raise exception 'accounts sees % bills', (select count(*) from public.payables()); end if;
end $$;
do $$ begin
  perform public.save_supplier_terms('DHRUVI MILL INDIA', 60, 'micro', 'udyam-rj-17-12345');
  raise exception 'a bad Udyam number was saved';
exception when raise_exception then
  if sqlerrm not like 'A Udyam number looks like%' then raise; end if;
end $$;
do $$ begin
  perform public.save_supplier_terms('DHRUVI MILL INDIA', 60, 'none', 'UDYAM-RJ-17-0012345');
  raise exception 'a Udyam number without a size was saved';
exception when raise_exception then
  if sqlerrm not like 'A supplier with a Udyam number%' then raise; end if;
end $$;
do $$ begin
  perform public.save_supplier_terms('NOBODY', 60, null, null);
  raise exception 'terms for a ledger not in Tally';
exception when raise_exception then
  if sqlerrm <> 'That supplier isn''t in Tally''s ledgers.' then raise; end if;
end $$;
select public.save_supplier_terms('DHRUVI MILL INDIA', 60, 'micro', ' udyam-rj-17-0012345 ');
select public.save_supplier_terms('A NYA ( PURCHASES )', 30, null, null);

-- A micro enterprise is due in 45 days even on 60-day terms; Anya now on 30 days.
reset role;
do $$
declare
  c uuid := (select id from public.companies);
  r record;
begin
  select * into r from public.payables_for(c, '2026-10-21') where bill = 'DM-7';
  if r.due_on <> '2026-10-16' or r.agreed_due <> '2026-10-31' or r.msme <> 'micro' or r.udyam_no <> 'UDYAM-RJ-17-0012345' then raise exception 'MSME due wrong: %', row_to_json(r); end if;
  select * into r from public.payables_for(c, '2026-10-21') where bill = 'INV-52';
  if r.due_on <> '2026-10-01' or r.days <> 30 then raise exception 'own terms ignored: %', row_to_json(r); end if;
end $$;

-- ---------------------------------------------------------------- holding a bill
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
do $$ begin
  perform public.save_bill_note('SHREE JI ARTS ( PURCHASE )', 'SJ/39', true, '  ');
  raise exception 'held without a reason';
exception when raise_exception then
  if sqlerrm not like 'Say why the bill is on hold%' then raise; end if;
end $$;
do $$ begin
  perform public.save_bill_note('SHREE JI ARTS ( PURCHASE )', 'NOPE', false, 'x');
  raise exception 'a note on a bill not in Tally';
exception when raise_exception then
  if sqlerrm <> 'That bill isn''t in Tally.' then raise; end if;
end $$;
select public.save_bill_note('SHREE JI ARTS ( PURCHASE )', 'SJ/39', true, 'Short by 120 pcs, debit note to come');

-- The owner's brief: Anya and Dhruvi are late; Shreeji's bill is on hold and its older balance has no date, so it isn't listed.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  p jsonb := public.brief_data() -> 'payables';
begin
  if p is null then raise exception 'the owner brief has no payables'; end if;
  if jsonb_array_length(p) <> 2 then raise exception 'brief payables: %', p; end if;
  if (p -> 0 ->> 'name') <> 'DHRUVI MILL INDIA' or not (p -> 0 ->> 'msme_late')::boolean then raise exception 'MSME late should come first: %', p; end if;
  if (p -> 1 ->> 'name') <> 'Anya' or (p -> 1 ->> 'overdue')::numeric <> 150000 then raise exception 'Anya line wrong: %', p; end if;
  if (select hold from public.payables() where bill = 'SJ/39') is not true then raise exception 'hold not shown'; end if;
end $$;

-- Terms and notes are kept in the activity log, and only finance reads them.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.supplier_terms) or exists (select 1 from public.bill_notes) then raise exception 'merchandiser reads terms or notes'; end if;
  if exists (select 1 from public.history where table_name in ('supplier_terms', 'bill_notes')) then raise exception 'merchandiser reads their history'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
do $$ begin
  if (select count(*) from public.history where table_name in ('supplier_terms', 'bill_notes')) < 3 then raise exception 'terms and notes not in the activity log'; end if;
end $$;
