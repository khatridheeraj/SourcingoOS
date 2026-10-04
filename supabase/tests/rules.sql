-- Business-rule tests. Each block raises on failure; run with ON_ERROR_STOP.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create function pg_temp.act_as(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = p_email), ''), false);
end $$;

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%" from: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'wrong error for %: %', p_sql, sqlerrm; end if;
end $$;

insert into auth.users (email) values ('owner@t'), ('merch@t'), ('buyer@t'), ('factory@t'), ('new@t'), ('accounts@t');
insert into factories (name) values ('F1');
update profiles set role = 'owner', active = true where email = 'owner@t';
update profiles set role = 'merchandiser', active = true where email = 'merch@t';
update profiles set role = 'accounts', active = true where email = 'accounts@t';
update profiles set role = 'buyer', active = true, buyer_id = (select id from buyers where code = 'BYR-AH-0001') where email = 'buyer@t';
update profiles set role = 'factory', active = true, factory_id = (select id from factories where name = 'F1') where email = 'factory@t';
insert into sales_orders (buyer_id, buyer_po_number, status) select id, 'PO-DRAFT', 'draft' from buyers where code = 'BYR-AH-0001';
insert into sales_orders (buyer_id, buyer_po_number, status) select id, 'PO-REVIEW', 'tna_review' from buyers where code = 'BYR-AH-0001';

-- New sign-ups start inactive with no role.
do $$ begin
  if exists (select 1 from profiles where email = 'new@t' and (active or role is not null)) then
    raise exception 'new sign-up should be inactive with no role';
  end if;
end $$;

set role authenticated;

-- Buyers see confirmed orders, never drafts.
select pg_temp.act_as('buyer@t');
do $$ begin
  if (select array_agg(buyer_po_number order by 1) from portal_buyer_orders) is distinct from array['PO-REVIEW'] then
    raise exception 'buyer portal should show only PO-REVIEW';
  end if;
end $$;

-- Buyers and factories can't read base tables.
do $$ begin
  if exists (select 1 from sales_orders) then raise exception 'buyer read sales_orders'; end if;
end $$;
select pg_temp.act_as('factory@t');
do $$ begin
  if exists (select 1 from sales_orders) or exists (select 1 from profiles where email <> 'factory@t') then
    raise exception 'factory read internal rows';
  end if;
end $$;

-- Only the owner can change roles; for anyone else the update touches nothing.
select pg_temp.act_as('merch@t');
update profiles set role = 'owner', active = true where email = 'new@t';
do $$ begin
  if exists (select 1 from profiles where email = 'new@t' and role is not null) then raise exception 'merchandiser changed a role'; end if;
end $$;

-- Only the owner can lock a TNA.
select pg_temp.expect_error($$select lock_sales_order('SO-000002')$$, 'Only the owner can lock%');

-- The owner approves people.
select pg_temp.act_as('owner@t');
update profiles set role = 'qc', active = true where email = 'new@t';
do $$ begin
  if not exists (select 1 from profiles where email = 'new@t' and role = 'qc' and active) then raise exception 'owner could not approve'; end if;
end $$;

-- A factory user must be linked to a factory.
select pg_temp.expect_error($$update profiles set role = 'factory' where email = 'new@t'$$, '%factory_users_have_factory%');

-- The last active owner can't remove themselves.
select pg_temp.expect_error($$update profiles set role = 'manager' where email = 'owner@t'$$, '%at least one active owner%');
select pg_temp.expect_error($$update profiles set active = false where email = 'owner@t'$$, '%at least one active owner%');

-- With a second owner, the first can step down.
update profiles set role = 'owner' where email = 'new@t';
update profiles set role = 'manager' where email = 'owner@t';

-- Adding buyers: owner only, code numbered after the seeded ones, real name private.
select pg_temp.act_as('new@t');
do $$ begin
  if create_buyer('Aurelia Home Pvt Ltd', null, '30 days') <> 'BYR-AH-0005' then raise exception 'unexpected buyer code'; end if;
  if create_buyer('Kora', 'k-r', null) <> 'BYR-KR-0006' then raise exception 'initials not cleaned'; end if;
end $$;
select pg_temp.expect_error($$select create_buyer('aurelia home pvt ltd')$$, '%already has a buyer code%');
select pg_temp.act_as('merch@t');
select pg_temp.expect_error($$select create_buyer('Someone')$$, 'Only the owner can add buyers.');
do $$ begin
  if not exists (select 1 from buyers where code = 'BYR-AH-0005') then raise exception 'merchandiser cannot see buyer codes'; end if;
  if exists (select 1 from buyer_registry) then raise exception 'merchandiser read real buyer names'; end if;
end $$;

-- Factories: owner and manager manage them; merchandisers only read.
select pg_temp.expect_error($$insert into factories (name) values ('F2')$$, '%row-level security%');
select pg_temp.act_as('owner@t');  -- now a manager
insert into factories (name, city) values ('F2', 'Jaipur');

-- Inquiries: ops log them and add follow-ups; accounts, buyers and factories can't see them.
select pg_temp.act_as('merch@t');
insert into inquiries (buyer_id, contact_person, contact_email, product_type)
  select id, 'Asha', 'asha@brand.in', 'Kurta' from buyers where code = 'BYR-AH-0005';
insert into inquiry_followups (inquiry_id, note) values ('INQ-000001', 'Sent quote');
do $$ begin
  if (select created_by from inquiries where id = 'INQ-000001') is distinct from auth.uid() then raise exception 'inquiry created_by not set'; end if;
end $$;
select pg_temp.act_as('accounts@t');
do $$ begin
  if exists (select 1 from inquiries) or exists (select 1 from inquiry_followups) then raise exception 'accounts read inquiries'; end if;
end $$;
select pg_temp.act_as('buyer@t');
do $$ begin
  if exists (select 1 from inquiries) then raise exception 'buyer read inquiries'; end if;
end $$;

-- Sales order lifecycle: create from inquiry, save draft, lock, factory updates TNA,
-- receive goods, dispatch, auto-ship.
select pg_temp.act_as('merch@t');
do $$
declare v_so text; v_buyer uuid := (select buyer_id from inquiries where id = 'INQ-000001');
        v_fac uuid := (select id from factories where name = 'F1');
        v_merch uuid := auth.uid(); v_mgr uuid := (select id from profiles where email = 'owner@t');
begin
  v_so := create_sales_order(v_buyer, 'PO-100', 'garment', 'INQ-000001');
  if (select status from inquiries where id = 'INQ-000001') <> 'converted' then raise exception 'inquiry not converted'; end if;
  perform save_sales_order(jsonb_build_object(
    'id', v_so, 'buyer_id', v_buyer, 'buyer_po_number', 'PO-100', 'order_type', 'garment', 'currency', 'INR',
    'factory_id', v_fac, 'payment_terms', '45 days', 'merchandiser_id', v_merch, 'manager_id', v_mgr,
    'buyer_date', current_date + 60, 'factory_date', current_date + 50, 'merch_date', current_date + 48, 'tags', jsonb_build_array('SS27', ' '),
    'styles', jsonb_build_array(jsonb_build_object(
      'id', '11111111-1111-1111-1111-111111111111', 'name', 'Kurta', 'code', 'K1', 'fabric', 'Cotton', 'colour', 'Blue',
      'use_sizes', true, 'sizes', jsonb_build_object('S', '10', 'M', '20', 'L', ''), 'buyer_rate', '240', 'factory_rate', '180',
      'checkpoints', jsonb_build_array(
        jsonb_build_object('id', '22222222-2222-2222-2222-222222222221', 'name', 'Cutting', 'due_date', current_date + 10),
        jsonb_build_object('id', '22222222-2222-2222-2222-222222222222', 'name', 'Packing', 'due_date', current_date + 40))))));
  if (select qty from so_styles where id = '11111111-1111-1111-1111-111111111111') <> 30 then raise exception 'size total not computed'; end if;
  if (select tags from sales_orders where id = v_so) <> array['SS27'] then raise exception 'tags not cleaned'; end if;
  update sales_orders set status = 'tna_review' where id = v_so;
end $$;
select pg_temp.expect_error($$select create_sales_order((select buyer_id from inquiries where id = 'INQ-000001'), 'PO-100')$$, '%already used%');
select pg_temp.expect_error($$select set_checkpoint_status('22222222-2222-2222-2222-222222222221', 'in_progress')$$, '%after the TNA is locked%');

-- Factory sees the order in review, but not its buyer rate.
select pg_temp.act_as('factory@t');
do $$ begin
  if not exists (select 1 from portal_factory_orders where id = 'SO-000003') then raise exception 'factory cannot see its order'; end if;
end $$;

select pg_temp.act_as('new@t');  -- owner
select lock_sales_order('SO-000003');
select pg_temp.act_as('merch@t');
select pg_temp.expect_error($$select save_sales_order('{"id":"SO-000003"}'::jsonb)$$, '%is locked%');
update sales_orders set merch_date = current_date + 49, remarks = 'Fabric booked' where id = 'SO-000003';

select pg_temp.act_as('factory@t');
select set_checkpoint_status('22222222-2222-2222-2222-222222222221', 'completed');
do $$ begin
  if (select milestone from portal_buyer_orders where id = 'SO-000003') is not null then raise exception 'factory read buyer portal'; end if;
end $$;

select pg_temp.act_as('merch@t');
insert into grns (id, so_id) values ('GRN-T1', 'SO-000003');
select pg_temp.expect_error($$insert into grn_lines (grn_id, style_id, qty) values ('GRN-T1', '11111111-1111-1111-1111-111111111111', 31)$$, '%Overshipping is not allowed%');
insert into grn_lines (grn_id, style_id, qty) values ('GRN-T1', '11111111-1111-1111-1111-111111111111', 30);
insert into delivery_challans (id, grn_id, so_id) values ('DC-T0', 'GRN-T1', 'SO-000003');
select pg_temp.expect_error($$insert into dc_lines (dc_id, style_id, qty) values ('DC-T0', '11111111-1111-1111-1111-111111111111', 1)$$, 'Submit GRN-T1%');
delete from delivery_challans where id = 'DC-T0';
update grns set status = 'pending_approval' where id = 'GRN-T1';
select pg_temp.expect_error($$update grn_lines set qty = 29 where grn_id = 'GRN-T1'$$, '%has been submitted%');
select pg_temp.expect_error($$update grns set status = 'draft' where id = 'GRN-T1'$$, '%can''t go back to draft%');
select pg_temp.act_as('new@t');
select pg_temp.expect_error($$update sales_orders set status = 'tna_review' where id = 'SO-000003'$$, '%cannot be unlocked%');
select pg_temp.expect_error($$select unlock_sales_order('SO-000003')$$, '%cannot be unlocked%');
select pg_temp.act_as('merch@t');
select pg_temp.expect_error($$select unlock_sales_order('SO-000003')$$, 'Only the owner%');
insert into delivery_challans (id, grn_id, so_id) values ('DC-T1', 'GRN-T1', 'SO-000003');
select pg_temp.expect_error($$insert into dc_lines (dc_id, style_id, qty) values ('DC-T1', '11111111-1111-1111-1111-111111111111', 31)$$, 'Only 30 available%');
insert into dc_lines (dc_id, style_id, qty) values ('DC-T1', '11111111-1111-1111-1111-111111111111', 30);
update delivery_challans set status = 'dispatched', courier = 'Delhivery', tracking = 'X1', address = 'Mumbai',
  invoice_no = 'INV-1', invoice_date = current_date, dispatched_at = now() where id = 'DC-T1';
do $$ begin
  if (select status from sales_orders where id = 'SO-000003') <> 'shipped' then raise exception 'order not marked shipped'; end if;
end $$;
select pg_temp.expect_error($$update dc_lines set qty = 1 where dc_id = 'DC-T1'$$, '%has been dispatched%');
select pg_temp.act_as('new@t');
select pg_temp.expect_error($$update grns set status = 'rejected' where id = 'GRN-T1'$$, '%can''t be rejected%');

-- Accounts can read orders but not change them.
select pg_temp.act_as('accounts@t');
do $$ begin
  if not exists (select 1 from sales_orders where id = 'SO-000003') then raise exception 'accounts cannot read orders'; end if;
  if not exists (select 1 from so_styles where so_id = 'SO-000003') then raise exception 'accounts cannot read styles'; end if;
  update sales_orders set remarks = 'x' where id = 'SO-000003';
  if found then raise exception 'accounts changed an order'; end if;
end $$;
select pg_temp.expect_error($$select save_grn('{"so_id":"SO-000003"}'::jsonb)$$, 'Only merchandisers%');

-- Second order: GRN and DC saved in one call each.
select pg_temp.act_as('merch@t');
do $$
declare v_so text; v_grn text; v_dc text; v_buyer uuid := (select id from buyers where code = 'BYR-AH-0005');
        v_st uuid := '33333333-3333-3333-3333-333333333333';
begin
  v_so := create_sales_order(v_buyer, 'PO-300');
  perform save_sales_order(jsonb_build_object(
    'id', v_so, 'buyer_id', v_buyer, 'buyer_po_number', 'PO-300', 'order_type', 'fabric', 'currency', 'USD',
    'factory_id', (select id from factories where name = 'F1'), 'payment_terms', '30 days',
    'merchandiser_id', auth.uid(), 'manager_id', auth.uid(),
    'buyer_date', current_date + 30, 'factory_date', current_date + 20, 'merch_date', current_date + 20,
    'styles', jsonb_build_array(jsonb_build_object('id', v_st, 'name', 'Poplin', 'code', 'P1', 'fabric', 'Poplin', 'colour', 'White',
      'use_sizes', true, 'qty', '500', 'buyer_rate', '2.5',
      'checkpoints', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'Weaving', 'due_date', current_date + 5))))));
  if (select qty from so_styles where id = v_st) <> 500 or (select use_sizes from so_styles where id = v_st) then raise exception 'fabric qty wrong'; end if;
  perform set_sales_order_review(v_so, true);
  if (select status from sales_orders where id = v_so) <> 'tna_review' then raise exception 'not in review'; end if;
  perform set_sales_order_review(v_so, false);
  perform set_sales_order_review(v_so, true);
end $$;
select pg_temp.act_as('new@t');
select lock_sales_order('SO-000005');
select pg_temp.expect_error($$select save_grn(jsonb_build_object('so_id','SO-000005','received_at','2020-01-01','status','approved','received_by',auth.uid()))$$, '%at least one style%');
select pg_temp.act_as('merch@t');
select pg_temp.expect_error($$select save_grn('{"so_id":"SO-000005","received_at":"2020-01-01","status":"approved"}'::jsonb)$$, 'Only the owner can approve%');
select pg_temp.expect_error($$select save_grn('{"so_id":"SO-000005","received_at":"2020-01-01","status":"pending_approval"}'::jsonb)$$, 'Choose who received%');
select pg_temp.expect_error($$select save_grn(jsonb_build_object('so_id','SO-000005','received_at', now() + interval '1 day'))$$, '%in the future%');
do $$
declare v_grn text; v_dc text; v_st uuid := '33333333-3333-3333-3333-333333333333';
begin
  v_grn := save_grn(jsonb_build_object('so_id', 'SO-000005', 'received_at', now() - interval '2 hours',
    'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '100'))));
  if (select status from grns where id = v_grn) <> 'draft' then raise exception 'grn not draft'; end if;
  perform save_grn(jsonb_build_object('id', v_grn, 'so_id', 'SO-000005', 'received_at', now() - interval '2 hours',
    'received_by', auth.uid(), 'qc_checked', true, 'status', 'pending_approval',
    'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '200', 'condition', 'damaged'))));
  if (select qty from grn_lines where grn_id = v_grn) <> 200 then raise exception 'grn lines not replaced'; end if;
  if (select status from grns where id = v_grn) <> 'pending_approval' then raise exception 'grn not submitted'; end if;
  v_dc := save_dc(jsonb_build_object('grn_id', v_grn, 'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '150'))));
  begin
    perform save_dc(jsonb_build_object('id', v_dc, 'grn_id', v_grn, 'status', 'dispatched',
      'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '150'))));
    raise exception 'dispatch without courier allowed';
  exception when others then if sqlerrm not like 'Enter the courier%' then raise; end if;
  end;
  begin
    perform save_dc(jsonb_build_object('id', v_dc, 'grn_id', v_grn, 'status', 'dispatched', 'courier', 'VRL', 'tracking', 'LR1',
      'address', 'Delhi', 'invoice_no', 'INV-2', 'invoice_date', current_date, 'dispatched_at', now() - interval '3 hours',
      'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '150'))));
    raise exception 'dispatch before receipt allowed';
  exception when others then if sqlerrm not like '%before the goods were received%' then raise; end if;
  end;
  perform save_dc(jsonb_build_object('id', v_dc, 'grn_id', v_grn, 'status', 'dispatched', 'courier', 'VRL', 'tracking', 'LR1',
    'address', 'Delhi', 'invoice_no', 'INV-2', 'invoice_date', current_date, 'dispatched_at', now(),
    'lines', jsonb_build_array(jsonb_build_object('style_id', v_st, 'qty', '200'))));
  if (select status from delivery_challans where id = v_dc) <> 'dispatched' then raise exception 'dc not dispatched'; end if;
  if (select status from sales_orders where id = 'SO-000005') <> 'locked' then raise exception 'partial dispatch shipped the order'; end if;
end $$;

-- Deleting a draft frees its inquiry.
insert into inquiries (id, buyer_id, contact_person, contact_email, product_type)
  select 'INQ-T2', id, 'B', 'b@b.in', 'Shirt' from buyers where code = 'BYR-AH-0005';
do $$ declare v text; begin
  v := create_sales_order((select buyer_id from inquiries where id = 'INQ-T2'), 'PO-200', 'garment', 'INQ-T2');
  perform delete_draft_sales_order(v);
  if (select so_id from inquiries where id = 'INQ-T2') is not null then raise exception 'inquiry still linked'; end if;
end $$;
select pg_temp.expect_error($$select delete_draft_sales_order('SO-000003')$$, 'Only draft%');

-- Files: the row comes first, storage follows it; factories see their own order's files.
select pg_temp.act_as('merch@t');
do $$ declare v_st uuid := (select id from so_styles where so_id = 'SO-000005' order by position limit 1); begin
  insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
    values ('tech_pack', v_st, 'style/' || v_st || '/a1/tp.pdf', 'tp.pdf', 'application/pdf', 1000);
  insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
    values ('other', v_st, 'style/' || v_st || '/a2/costing.xlsx', 'costing.xlsx', 'application/vnd.ms-excel', 1000);
  insert into storage.objects (bucket_id, name) values ('files', 'style/' || v_st || '/a1/tp.pdf');
  if (select uploaded_by from files where file_name = 'tp.pdf') is distinct from auth.uid() then raise exception 'uploader not recorded'; end if;
  begin
    insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
      values ('tech_pack', v_st, 'grn/GRN-T1/a3/x.pdf', 'x.pdf', 'application/pdf', 10);
    raise exception 'mismatched path allowed';
  exception when others then if sqlerrm not like 'File path does not match%' then raise; end if;
  end;
  begin
    insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
      values ('grn_photo', v_st, 'style/' || v_st || '/a4/x.jpg', 'x.jpg', 'image/jpeg', 10);
    raise exception 'wrong category allowed';
  exception when others then if sqlerrm not like '%can''t be attached here%' then raise; end if;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('files', 'style/' || v_st || '/zz/no-row.pdf');
    raise exception 'upload without a files row allowed';
  exception when others then if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
select pg_temp.expect_error($$update files set file_name = 'y.pdf' where file_name = 'tp.pdf'$$, 'Files can''t be changed%');

select pg_temp.act_as('accounts@t');
do $$ begin
  if (select count(*) from files) <> 2 then raise exception 'accounts should read all files'; end if;
end $$;

select pg_temp.act_as('buyer@t');
do $$ begin
  if exists (select 1 from files) or exists (select 1 from storage.objects) then raise exception 'buyer read files'; end if;
end $$;

select pg_temp.act_as('factory@t');
do $$ declare v_st uuid := (select style_id from portal_factory_checkpoints where so_id = 'SO-000005' limit 1); begin
  if (select array_agg(file_name) from files) is distinct from array['tp.pdf'] then raise exception 'factory should see only the tech pack'; end if;
  if not exists (select 1 from storage.objects where name like '%/tp.pdf') then raise exception 'factory cannot open the tech pack'; end if;
  if (select name from portal_factory_profile) <> 'F1' then raise exception 'factory profile missing'; end if;
  if not exists (select 1 from portal_factory_receipts where so_id = 'SO-000005') then raise exception 'factory receipts missing'; end if;
  insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
    values ('style_photo', v_st, 'style/' || v_st || '/f1/line.jpg', 'line.jpg', 'image/jpeg', 2000);
  insert into storage.objects (bucket_id, name) values ('files', 'style/' || v_st || '/f1/line.jpg');
  begin
    insert into files (category, style_id, storage_path, file_name, mime_type, size_bytes)
      values ('tech_pack', v_st, 'style/' || v_st || '/f2/tp2.pdf', 'tp2.pdf', 'application/pdf', 10);
    raise exception 'factory added a tech pack';
  exception when others then if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  delete from files where file_name = 'tp.pdf';
  if not exists (select 1 from files where file_name = 'tp.pdf') then raise exception 'factory deleted a tech pack'; end if;
  delete from storage.objects where name like '%/f1/line.jpg';
  delete from files where file_name = 'line.jpg';
  if exists (select 1 from files where file_name = 'line.jpg') then raise exception 'factory could not delete its photo'; end if;
end $$;

-- A factory must say why a checkpoint is delayed; the reason reaches ops.
do $$ declare v_cp uuid := (select id from portal_factory_checkpoints where so_id = 'SO-000005' order by position limit 1); begin
  begin
    perform set_checkpoint_status(v_cp, 'delayed');
    raise exception 'delay without reason allowed';
  exception when others then if sqlerrm not like 'Say why it is delayed%' then raise; end if;
  end;
  perform set_checkpoint_status(v_cp, 'delayed', '  Fabric late from mill ');
  if (select status_note from portal_factory_checkpoints where id = v_cp) <> 'Fabric late from mill' then raise exception 'note not saved'; end if;
end $$;
select pg_temp.act_as('merch@t');
do $$ begin
  if not exists (select 1 from tna_status_history where note = 'Fabric late from mill') then raise exception 'note not in history'; end if;
end $$;

-- POs received: staff only; inquiry and sales order come from the PO.
select pg_temp.act_as('merch@t');
do $$ declare v_b uuid := (select id from buyers where code = 'BYR-AH-0001'); v_po text; v_inq text; v_so text; begin
  insert into received_pos (buyer_id, po_number, po_date, delivery_date, sender_name, sender_email, email_thread_id, attachments, lines)
    values (v_b, ' KFT-1 ', '2026-10-01', '2026-11-15', 'Asha', 'asha@brand.in', 't1', '{po.pdf}',
            '[{"style_code":"A1","description":"Cord set","colour":"Red","qty":100,"rate":740},{"style_code":"A2","description":"Cord set","colour":"Blue","qty":50,"rate":740}]')
    returning id into v_po;
  if (select po_number from received_pos where id = v_po) <> 'KFT-1' then raise exception 'po number not trimmed'; end if;
  begin
    insert into received_pos (buyer_id, po_number, email_thread_id) values (v_b, 'KFT-1', 't2');
    raise exception 'duplicate PO allowed';
  exception when unique_violation then null;
  end;
  begin
    update received_pos set status = 'rejected' where id = v_po;
    raise exception 'reject without reason allowed';
  exception when check_violation then null;
  end;
  v_inq := received_po_to_inquiry(v_po);
  if (select est_qty from inquiries where id = v_inq) <> 150 or (select budget_inr from inquiries where id = v_inq) <> 111000
     or (select status from received_pos where id = v_po) <> 'in_progress' then raise exception 'inquiry from PO wrong'; end if;
  v_so := convert_received_po(v_po);
  if (select count(*) from so_styles where so_id = v_so) <> 2 or (select buyer_date from sales_orders where id = v_so) <> '2026-11-15'
     or (select count(*) from tna_checkpoints c join so_styles s on s.id = c.style_id where s.so_id = v_so) <> 12
     or (select status from received_pos where id = v_po) <> 'converted'
     or (select so_id from inquiries where id = v_inq) <> v_so then raise exception 'conversion wrong'; end if;
  -- An order deleted while still a draft sends the PO back to the team.
  perform delete_draft_sales_order(v_so);
  if (select status from received_pos where id = v_po) <> 'in_progress' then raise exception 'PO not reopened'; end if;
  -- A PO whose order already exists is linked on arrival.
  insert into received_pos (buyer_id, po_number, email_thread_id) values (v_b, 'PO-DRAFT', 't3') returning id into v_po;
  if (select status from received_pos where id = v_po) <> 'converted' then raise exception 'existing order not linked'; end if;
  insert into received_pos (buyer_id, po_number, email_thread_id) values (v_b, 'KFT-2', 't4') returning id into v_po;
  update received_pos set status = 'rejected', reject_reason = 'Duplicate of KFT-1' where id = v_po;
  v_so := convert_received_po(v_po);
  if (select count(*) from so_styles where so_id = v_so) <> 1 or (select reject_reason from received_pos where id = v_po) is not null then raise exception 'header-only conversion wrong'; end if;
end $$;
select pg_temp.expect_error($$select convert_received_po((select id from received_pos where po_number = 'KFT-2'))$$, '%already sales order%');
select pg_temp.act_as('accounts@t');
do $$ begin if exists (select 1 from received_pos) then raise exception 'accounts read POs'; end if; end $$;
select pg_temp.expect_error($$select received_po_to_inquiry('RPO-000001')$$, 'Only merchandisers%');
select pg_temp.act_as('factory@t');
do $$ begin if exists (select 1 from received_pos) then raise exception 'factory read POs'; end if; end $$;

reset role;
\o
\echo 'All rule tests passed.'
