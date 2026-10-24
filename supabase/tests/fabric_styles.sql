-- Fabric styles (0065): typed in as Fabric they skip the garment steps; the switch both ways; the rules around it.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
create function pg_temp.expect(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_what; end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like "%", but it passed: %', p_like, p_sql;
exception when others then
  if sqlerrm not like p_like then raise exception 'expected "%", got "%" from %', p_like, sqlerrm, p_sql; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@sourcingo.in'),
  ('00000000-0000-0000-0000-00000000000b', 'merch@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in');
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
update public.profiles set current_company_id = (select id from public.companies);

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-KF","real_name":"Kaftanize"}') as kf \gset
reset role;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Mill' from public.companies;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'kf', 'buyer_po', 'KFT-88', 'ship_date', (current_date + 20)::text),
  '[{"style":"Cotton Cambric","description":"Fabric","qty":150,"factory_id":"20000000-0000-0000-0000-000000000001"},{"style":"KAFTAN-1","description":"Kaftan","qty":100,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o \gset
reset role;
select id as fab from public.order_lines where order_id = :'o' and style = 'Cotton Cambric' \gset
select id as gar from public.order_lines where order_id = :'o' and style = 'KAFTAN-1' \gset

-- ================================================================ typed in as Fabric
select pg_temp.expect((select product = 'fabric' from public.order_lines where id = :'fab'), 'a style described as Fabric was not made fabric');
select pg_temp.expect((select product = 'garment' from public.order_lines where id = :'gar'), 'a kaftan became fabric');
select pg_temp.expect((select count(*) = 8 from public.line_stages where line_id = :'fab' and not_needed), 'the 8 garment steps were not dropped');
select pg_temp.expect((select array_agg(stage order by pos) = array['greige','printing','strike_off','finishing','packed','final_qc','ex_factory'] from public.style_steps(:'fab')),
  'the fabric TNA is not greige, printing, strike off, finishing, packed, final QC, ex-factory');
select pg_temp.expect((select count(*) = 15 from public.style_steps(:'gar')), 'the garment lost steps');

-- A garment can't drop a standard step, and fabric can't drop the steps it keeps.
select pg_temp.expect_error(format($$insert into public.line_stages (company_id, order_id, line_id, stage, not_needed) select company_id, order_id, id, 'cutting', true from public.order_lines where id = '%s'$$, :'gar'),
  'Every garment style goes through all the standard steps.');
select pg_temp.expect_error(format($$insert into public.line_stages (company_id, order_id, line_id, stage, not_needed) select company_id, order_id, id, 'greige', true from public.order_lines where id = '%s'$$, :'fab'),
  'Every garment style goes through all the standard steps.');

-- ================================================================ the switch
set role authenticated;
select public.set_line_product(:'gar', 'fabric');
reset role;
select pg_temp.expect((select count(*) = 7 from public.style_steps(:'gar')), 'switching to fabric left garment steps');
set role authenticated;
select public.set_line_product(:'gar', 'garment');
reset role;
select pg_temp.expect((select count(*) = 15 from public.style_steps(:'gar')) and (select product = 'garment' from public.order_lines where id = :'gar'), 'switching back did not bring every step back');
set role authenticated;
select public.set_line_product(:'gar', 'garment');
select pg_temp.expect_error(format($$select public.set_line_product('%s', 'trims')$$, :'gar'), 'A style is a garment or fabric.');

-- Quality can't switch.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.set_line_product('%s', 'garment')$$, :'fab'), 'Only the orders team%');

-- Not after release.
reset role;
insert into public.factory_pos (company_id, order_id, factory_id, released_at) select company_id, :'o', '20000000-0000-0000-0000-000000000001', now() from public.orders where id = :'o';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.set_line_product('%s', 'garment')$$, :'fab'), 'This factory''s PO is already released%');

-- The helper is not callable by the app.
select pg_temp.expect_error(format($$select public.apply_line_product('%s', 'garment')$$, :'fab'), 'permission denied%');
