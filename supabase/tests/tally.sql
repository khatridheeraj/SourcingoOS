-- Tally reading tests. Every block either passes quietly or raises.
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
select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Clothing"}') as oz \gset
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba"}') as ah \gset
insert into public.factories (name) values ('Shree Knits'), ('Nova Fab');
select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/001', 'buyer_id', :'oz', 'invoice_date', '2026-06-01', 'amount', 100000)) as inv1 \gset

-- ---------------------------------------------------------------- only the owner makes a key and changes settings
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
do $$ begin
  perform public.tally_new_key();
  raise exception 'accounts made a sync key';
exception when raise_exception then
  if sqlerrm <> 'Only the owner can make a sync key.' then raise; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.tally_new_key() as key \gset
do $$ begin
  perform public.tally_save_settings('{"enabled":true}');
  raise exception 'switched on without a company name';
exception when raise_exception then
  if sqlerrm not like 'Enter the company%' then raise; end if;
end $$;
select public.tally_save_settings('{"enabled":true,"tally_company":"SOURCINGO PRIVATE LIMITED","read_from":"2026-04-01"}');
do $$ begin
  perform key_hash from public.tally_settings;
  raise exception 'the key hash is readable';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------- the PC program, signed out
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform public.tally_bridge_hello('sgo_wrong');
  raise exception 'a wrong key was accepted';
exception when sqlstate '28000' then null;
end $$;
do $$ begin
  perform 1 from public.invoices;
  raise exception 'anon can read invoices';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.tally_import(array['x']);
  raise exception 'anon can import';
exception when insufficient_privilege then null;
end $$;

select set_config('t.hello', (public.tally_bridge_hello(:'key', '{"tally":"online"}'))::text, false) \g /dev/null
do $$ begin
  if (current_setting('t.hello')::jsonb ->> 'company') <> 'SOURCINGO PRIVATE LIMITED' or not (current_setting('t.hello')::jsonb ->> 'enabled')::boolean then
    raise exception 'hello returned %', current_setting('t.hello');
  end if;
end $$;

select set_config('t.snap', (public.tally_bridge_snapshot(:'key', jsonb_build_object(
  'from', '2026-04-01', 'to', '2026-10-10',
  'ledgers', jsonb_build_array(
    jsonb_build_object('name', 'M/s Ozia Clothing Pvt. Ltd.', 'parent', 'Sundry Debtors', 'balance', 95000, 'gstin', '27abcde1234f1z5'),
    jsonb_build_object('name', 'Shree Knits', 'parent', 'Sundry Creditors', 'balance', -42000),
    jsonb_build_object('name', 'Nova Fab', 'parent', 'Sundry Creditors', 'balance', 0),
    jsonb_build_object('name', 'Nova Fabrics', 'parent', 'Sundry Creditors', 'balance', 0),
    jsonb_build_object('name', 'Sales', 'parent', 'Sales Accounts', 'balance', -300000)),
  'items', jsonb_build_array(jsonb_build_object('name', 'Kurta K-101', 'unit', 'Pcs', 'qty', 120, 'value', 30000)),
  'vouchers', jsonb_build_array(
    jsonb_build_object('guid', 'g1', 'vtype', 'Sales', 'number', 'SPL/001', 'date', '2026-06-01', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 100000),
    jsonb_build_object('guid', 'g2', 'vtype', 'GST Sales', 'number', 'SPL/002', 'date', '2026-07-01', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 50000),
    jsonb_build_object('guid', 'g3', 'vtype', 'Credit Note', 'number', 'CN/9', 'date', '2026-07-05', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 5000,
                       'bills', jsonb_build_array(jsonb_build_object('name', 'SPL/002', 'amount', 5000))),
    jsonb_build_object('guid', 'g4', 'vtype', 'Sales', 'number', 'SPL/003', 'date', '2026-07-09', 'party', 'Someone Else', 'amount', 7000),
    jsonb_build_object('guid', 'g5', 'vtype', 'Receipt', 'number', '12', 'date', '2026-08-01', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 50000),
    jsonb_build_object('guid', 'g6', 'vtype', 'Sales Order', 'number', 'SO/1', 'date', '2026-08-01', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 1),
    jsonb_build_object('guid', 'g7', 'vtype', 'Credit Note', 'number', 'CN/10', 'date', '2026-08-02', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 100)))))::text, false) \g /dev/null
reset role;

do $$ begin
  if (current_setting('t.snap')::jsonb ->> 'linked')::int <> 3 then raise exception 'expected Ozia, Shree Knits and Nova Fab linked, got %', current_setting('t.snap'); end if;
  if (select tally_ledger from public.buyers where code = 'BYR-OZ') <> 'M/s Ozia Clothing Pvt. Ltd.' then raise exception 'buyer not linked by name'; end if;
  if (select tally_ledger from public.buyers where code = 'BYR-AH') is not null then raise exception 'buyer linked with no ledger'; end if;
  if (select tally_ledger from public.factories where name = 'Shree Knits') <> 'Shree Knits' then raise exception 'factory not linked'; end if;
  -- "Nova Fab" and "Nova Fabrics" are different names; only the exact one links.
  if (select tally_ledger from public.factories where name = 'Nova Fab') <> 'Nova Fab' then raise exception 'exact factory name not linked'; end if;
  if (select kind from public.tally_vouchers where guid = 'g2') <> 'sales' then raise exception 'GST Sales not read as sales'; end if;
  if (select kind from public.tally_vouchers where guid = 'g6') <> 'other' then raise exception 'sales order read as sales'; end if;
  if (select kind from public.tally_vouchers where guid = 'g5') <> 'receipt' then raise exception 'receipt kind'; end if;
  if (select gstin from public.tally_ledgers where name like 'M/s Ozia%') <> '27ABCDE1234F1Z5' then raise exception 'gstin not upper-cased'; end if;
  if (select snapshot_at from public.tally_settings) is null then raise exception 'snapshot time not kept'; end if;
end $$;

-- ---------------------------------------------------------------- who can see the mirror
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if exists (select 1 from public.tally_vouchers) or exists (select 1 from public.tally_ledgers) or exists (select 1 from public.tally_settings) then
    raise exception 'merchandiser can see Tally';
  end if;
  perform public.tally_import(array['g2']);
  raise exception 'merchandiser imported';
exception when raise_exception then
  if sqlerrm not like 'Only Accounts%' then raise; end if;
end $$;

-- ---------------------------------------------------------------- Accounts brings in what is only in Tally
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ac');
do $$ begin
  if (select count(*) from public.tally_vouchers) <> 7 then raise exception 'accounts can''t see the vouchers'; end if;
end $$;
select set_config('t.imp', (public.tally_import(array['g1', 'g2', 'g3', 'g4', 'g5', 'g7']))::text, false) \g /dev/null
do $$
declare r jsonb := current_setting('t.imp')::jsonb;
begin
  if (r ->> 'invoices')::int <> 1 or (r ->> 'credit_notes')::int <> 1 then raise exception 'import result %', r; end if;
  if not r -> 'skipped' @> '["Invoice SPL/001 is already in Payments."]' then raise exception 'duplicate not reported: %', r; end if;
  if not exists (select 1 from jsonb_array_elements_text(r -> 'skipped') s where s like 'SPL/003: "Someone Else" isn''t linked%') then
    raise exception 'unlinked party not reported: %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements_text(r -> 'skipped') s where s like 'Credit note CN/10: Tally doesn''t say%') then
    raise exception 'credit note with no invoice not reported: %', r;
  end if;
  if (select amount from public.invoices where invoice_no = 'SPL/002') <> 50000 then raise exception 'invoice amount'; end if;
  if (select buyer_id from public.invoices where invoice_no = 'SPL/002') <> (select id from public.buyers where code = 'BYR-OZ') then raise exception 'invoice buyer'; end if;
  if public.invoice_net((select id from public.invoices where invoice_no = 'SPL/002')) <> 45000 then raise exception 'credit note not against SPL/002'; end if;
  if (select count(*) from public.invoices) <> 2 then raise exception 'receipt or unlinked sale imported'; end if;
end $$;
-- Running it again changes nothing.
select set_config('t.imp2', (public.tally_import(array['g2', 'g3']))::text, false) \g /dev/null
do $$ begin
  if (current_setting('t.imp2')::jsonb ->> 'invoices')::int <> 0 or (current_setting('t.imp2')::jsonb ->> 'credit_notes')::int <> 0 then raise exception 'imported twice'; end if;
end $$;

-- Linking a ledger by hand, then bringing in the rest.
select public.tally_set_ledger('buyer', :'ah', 'Someone Else');
select set_config('t.imp3', (public.tally_import(array['g4']))::text, false) \g /dev/null
do $$ begin
  if (current_setting('t.imp3')::jsonb ->> 'invoices')::int <> 1 then raise exception 'linked party still skipped: %', current_setting('t.imp3'); end if;
  if (select buyer_id from public.invoices where invoice_no = 'SPL/003') <> (select id from public.buyers where code = 'BYR-AH') then raise exception 'wrong buyer'; end if;
  if not exists (select 1 from public.history where table_name = 'buyers' and after ->> 'tally_ledger' = 'Someone Else') then raise exception 'link not in history'; end if;
end $$;
do $$ begin
  perform public.tally_save_settings('{"enabled":false}');
  raise exception 'accounts changed settings';
exception when raise_exception then
  if sqlerrm not like 'Only the owner%' then raise; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- what leaves Tally is marked gone, not deleted
set role anon;
select public.tally_bridge_snapshot(:'key', jsonb_build_object(
  'from', '2026-07-01', 'to', '2026-10-10',
  'ledgers', jsonb_build_array(jsonb_build_object('name', 'M/s Ozia Clothing Pvt. Ltd.', 'balance', 45000)),
  'vouchers', jsonb_build_array(
    jsonb_build_object('guid', 'g2', 'vtype', 'Sales', 'number', 'SPL/002', 'date', '2026-07-01', 'party', 'M/s Ozia Clothing Pvt. Ltd.', 'amount', 52000))));
reset role;
do $$ begin
  if (select gone_at from public.tally_ledgers where name = 'Shree Knits') is null then raise exception 'missing ledger not marked gone'; end if;
  if (select gone_at from public.tally_ledgers where name like 'M/s Ozia%') is not null then raise exception 'present ledger marked gone'; end if;
  if (select balance from public.tally_ledgers where name like 'M/s Ozia%') <> 45000 then raise exception 'balance not updated'; end if;
  if (select amount from public.tally_vouchers where guid = 'g2') <> 52000 then raise exception 'voucher not updated'; end if;
  if (select gone_at from public.tally_vouchers where guid = 'g5') is null then raise exception 'missing voucher in range not marked gone'; end if;
  -- g1 is dated before this read's range, so it stays.
  if (select gone_at from public.tally_vouchers where guid = 'g1') is not null then raise exception 'voucher outside range marked gone'; end if;
  if (select count(*) from public.tally_ledgers) <> 5 then raise exception 'ledger rows were deleted'; end if;
end $$;

-- A new key retires the old one.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.tally_new_key() as key2 \gset
set role anon;
select set_config('t.key', :'key', false) \g /dev/null
do $$ begin
  perform public.tally_bridge_hello(current_setting('t.key'));
  raise exception 'old key still works';
exception when sqlstate '28000' then null;
end $$;
select public.tally_bridge_hello(:'key2');
reset role;
