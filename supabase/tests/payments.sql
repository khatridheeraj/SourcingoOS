-- Payment rule tests. Every block either passes quietly or raises.
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

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia"}') as oz \gset
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset

-- ---------------------------------------------------------------- accounts records invoices and cheques
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
select public.set_buyer_credit_days(:'oz', 60);
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/001', 'buyer_id', :'oz', 'invoice_date', '2026-06-01', 'amount', 100000)) as inv1 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/002', 'buyer_id', :'oz', 'invoice_date', '2026-06-10', 'amount', 50000)) as inv2 \gset
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/003', 'buyer_id', :'ah', 'invoice_date', '2026-06-10', 'amount', 20000)) as inv3 \gset

do $$ begin
  if (select credit_days from public.buyers where code = 'BYR-OZ') <> 60 then raise exception 'credit days not set'; end if;
  perform public.save_invoice(jsonb_build_object('invoice_no', ' spl/001 ', 'buyer_id', (select id from public.buyers where code = 'BYR-OZ'),
    'invoice_date', '2026-06-01', 'amount', 1));
  raise exception 'duplicate invoice number accepted';
exception when unique_violation then null;
end $$;

-- A credit note lowers what is owed.
select public.save_credit_note(jsonb_build_object('credit_note_no', 'CN/001', 'invoice_id', :'inv1', 'note_date', '2026-06-05', 'amount', 10000)) as cn1 \gset
do $$ begin
  if public.invoice_net((select id from public.invoices where invoice_no = 'SPL/001')) <> 90000 then raise exception 'credit note not netted'; end if;
end $$;

-- One cheque pays two invoices.
select public.save_cheque(jsonb_build_object('buyer_id', :'oz', 'cheque_no', '349892', 'cheque_date', '2026-07-27', 'amount', 140000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv1', 'amount', 90000), jsonb_build_object('invoice_id', :'inv2', 'amount', 50000)))) as chq1 \gset
do $$ begin
  if public.invoice_covered((select id from public.invoices where invoice_no = 'SPL/002')) <> 50000 then raise exception 'cheque not set against invoice'; end if;
end $$;

-- Rules that keep the money right.
do $$ begin
  perform public.save_cheque(jsonb_build_object('buyer_id', (select id from public.buyers where code = 'BYR-AH'), 'cheque_no', 'X1',
    'cheque_date', '2026-07-01', 'amount', 1000,
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', (select id from public.invoices where invoice_no = 'SPL/001'), 'amount', 1000))));
  raise exception 'cheque paid another buyer''s invoice';
exception when raise_exception then
  if sqlerrm not like '%different buyers%' then raise; end if;
end $$;
do $$ begin
  perform public.save_cheque(jsonb_build_object('buyer_id', (select id from public.buyers where code = 'BYR-AH'), 'cheque_no', 'X2',
    'cheque_date', '2026-07-01', 'amount', 1000,
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', (select id from public.invoices where invoice_no = 'SPL/003'), 'amount', 5000))));
  raise exception 'cheque split for more than its amount';
exception when raise_exception then
  if sqlerrm not like '%is set against invoices%' then raise; end if;
end $$;
do $$ begin
  perform public.save_cheque(jsonb_build_object('buyer_id', (select id from public.buyers where code = 'BYR-AH'), 'cheque_no', 'X3',
    'cheque_date', '2026-07-01', 'amount', 30000,
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', (select id from public.invoices where invoice_no = 'SPL/003'), 'amount', 25000))));
  raise exception 'invoice overpaid';
exception when raise_exception then
  if sqlerrm not like 'Cheques pay%' then raise; end if;
end $$;
do $$ begin
  if exists (select 1 from public.cheques where cheque_no like 'X%') then raise exception 'a failed save left a cheque behind'; end if;
  perform public.save_credit_note(jsonb_build_object('credit_note_no', 'CN/002', 'invoice_id', (select id from public.invoices where invoice_no = 'SPL/002'),
    'note_date', '2026-06-12', 'amount', 5000));
  raise exception 'credit note below what cheques already pay';
exception when raise_exception then
  if sqlerrm not like 'Cheques pay%' then raise; end if;
end $$;
do $$ begin
  perform public.save_invoice(jsonb_build_object('id', (select id from public.invoices where invoice_no = 'SPL/002'), 'invoice_no', 'SPL/002',
    'buyer_id', (select id from public.buyers where code = 'BYR-OZ'), 'invoice_date', '2026-06-10', 'amount', 50000, 'cancelled', true));
  raise exception 'invoice with a cheque was cancelled';
exception when raise_exception then
  if sqlerrm not like 'Cheques are set against%' then raise; end if;
end $$;

-- Changing the split takes an invoice off the cheque (kept, marked removed) and adds it back later.
select public.save_cheque(jsonb_build_object('id', :'chq1', 'buyer_id', :'oz', 'cheque_no', '349892', 'cheque_date', '2026-07-27', 'amount', 140000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv1', 'amount', 90000))));
do $$ begin
  if public.invoice_covered((select id from public.invoices where invoice_no = 'SPL/002')) <> 0 then raise exception 'invoice not taken off cheque'; end if;
  if (select count(*) from public.cheque_allocations) <> 2 then raise exception 'removed split should be kept, marked removed'; end if;
end $$;
select public.save_cheque(jsonb_build_object('id', :'chq1', 'buyer_id', :'oz', 'cheque_no', '349892', 'cheque_date', '2026-07-27', 'amount', 140000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv1', 'amount', 90000), jsonb_build_object('invoice_id', :'inv2', 'amount', 50000))));

-- Status: deposited then cleared; a cheque can't be deposited before its date.
do $$ begin
  perform public.set_cheque_status(array[(select id from public.cheques where cheque_no = '349892')], 'deposited', '2026-07-20');
  raise exception 'deposited before the cheque date';
exception when raise_exception then
  if sqlerrm not like '%can''t be deposited before%' then raise; end if;
end $$;
select public.set_cheque_status(array[:'chq1'::uuid], 'deposited', '2026-07-28');
select public.set_cheque_status(array[:'chq1'::uuid], 'cleared', '2026-07-30');
do $$ begin
  if (select deposited_on || ' ' || cleared_on from public.cheques where cheque_no = '349892') <> '2026-07-28 2026-07-30' then
    raise exception 'status dates not kept';
  end if;
  perform public.set_cheque_status(array[(select id from public.cheques where cheque_no = '349892')], 'in_hand');
  raise exception 'accounts moved a cleared cheque back';
exception when raise_exception then
  if sqlerrm not like 'A cleared cheque can''t be marked%' then raise; end if;
end $$;

-- A bounced cheque stops paying, and the invoice can take a new cheque.
select public.save_cheque(jsonb_build_object('buyer_id', :'ah', 'cheque_no', '25', 'cheque_date', '2026-07-01', 'amount', 20000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv3', 'amount', 20000)))) as chq2 \gset
select public.set_cheque_status(array[:'chq2'::uuid], 'deposited', '2026-07-02');
select public.set_cheque_status(array[:'chq2'::uuid], 'bounced', '2026-07-05', 'Insufficient funds');
do $$ begin
  if public.invoice_covered((select id from public.invoices where invoice_no = 'SPL/003')) <> 0 then raise exception 'bounced cheque still pays'; end if;
  if (select notes from public.cheques where cheque_no = '25') <> 'Insufficient funds' then raise exception 'note not kept'; end if;
end $$;
select public.save_cheque(jsonb_build_object('buyer_id', :'ah', 'cheque_no', '26', 'cheque_date', '2026-07-10', 'amount', 20000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', :'inv3', 'amount', 20000))));

-- Nobody deletes money records.
do $$ begin
  delete from public.cheques;
  raise exception 'accounts deleted a cheque';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- the merchandiser sees no money
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.invoices) or exists (select 1 from public.cheques) or exists (select 1 from public.cheque_allocations)
     or exists (select 1 from public.credit_notes) then
    raise exception 'merchandiser can see payments';
  end if;
  if exists (select 1 from public.history where table_name in ('invoices', 'cheques', 'cheque_allocations', 'credit_notes')) then
    raise exception 'merchandiser can see payment history';
  end if;
end $$;
do $$ begin
  perform public.save_invoice('{"invoice_no":"X","buyer_id":"00000000-0000-0000-0000-000000000000","invoice_date":"2026-01-01","amount":1}');
  raise exception 'merchandiser saved an invoice';
exception when raise_exception then
  if sqlerrm <> 'Only Accounts and the owner can change invoices.' then raise; end if;
end $$;
do $$ begin
  perform public.set_buyer_credit_days((select id from public.buyers where code = 'BYR-OZ'), 1);
  raise exception 'merchandiser set credit days';
exception when raise_exception then null;
end $$;

-- ---------------------------------------------------------------- the owner can correct anything and sees the history
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_cheque_status(array[:'chq1'::uuid], 'deposited');
do $$ begin
  if (select status from public.cheques where cheque_no = '349892') <> 'deposited' then raise exception 'owner could not correct a status'; end if;
  if not exists (select 1 from public.history where table_name = 'cheques' and action = 'update') then raise exception 'cheque changes not in history'; end if;
end $$;
reset role;
