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

insert into auth.users (email) values ('owner@t'), ('merch@t'), ('buyer@t'), ('factory@t'), ('new@t');
insert into factories (name) values ('F1');
update profiles set role = 'owner', active = true where email = 'owner@t';
update profiles set role = 'merchandiser', active = true where email = 'merch@t';
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

reset role;
\o
\echo 'All rule tests passed.'
