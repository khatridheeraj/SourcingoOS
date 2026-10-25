-- A new ship date moves the plan (0069): unfinished targets move by the same days, even after release, for the
-- orders team only; done and not-needed steps stay; an earlier date or a reason change moves nothing.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
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
select public.save_buyer('{"code":"BYR-NV","real_name":"Nova"}') as nv \gset
reset role;
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Flavia' from public.companies;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.save_order(jsonb_build_object('buyer_id', :'nv', 'buyer_po', 'NV-1', 'po_date', (current_date - 60)::text, 'ship_date', (current_date - 5)::text),
  '[{"style":"NV-SHIRT","description":"Shirt","qty":300,"factory_id":"20000000-0000-0000-0000-000000000001"}]') as o \gset
reset role;
select id as l from public.order_lines where order_id = :'o' \gset

-- Released PO with a plan: cutting done, stitching and packed late, size set not needed. Loaded without a person.
select pg_temp.as_user(null);
insert into public.factory_pos (company_id, order_id, factory_id, released_at)
select company_id, :'o', '20000000-0000-0000-0000-000000000001', now() - interval '30 days' from public.orders where id = :'o';
insert into public.line_stages (company_id, order_id, line_id, stage, planned_on, done_on)
select l.company_id, l.order_id, l.id, v.stage, v.planned_on, v.done_on from public.order_lines l,
  (values ('cutting', current_date - 20, current_date - 19), ('stitching', current_date - 12, null::date), ('packed', current_date - 8, null::date)) v (stage, planned_on, done_on)
where l.id = :'l'
on conflict (line_id, stage) do update set planned_on = excluded.planned_on, done_on = excluded.done_on;
select pg_temp.expect((select count(*) = 3 from public.line_stages where line_id = :'l' and planned_on is not null), 'the plan was not loaded');

-- ================================================================ who may
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect_error(format($$select public.move_ship_date('%s', current_date + 25, 'Fabric late')$$, :'o'), 'Only the orders team can change orders.');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.move_ship_date('%s', current_date + 25, ' ')$$, :'o'), 'Say why the ship date moved%');
-- Released targets are still locked when moved by hand.
select pg_temp.expect_error(format($$update public.line_stages set planned_on = planned_on + 1 where line_id = '%s' and stage = 'stitching'$$, :'l'),
  'Targets are locked once the factory PO is released.%');

-- ================================================================ a later date moves the unfinished targets
select public.move_ship_date(:'o', current_date + 25, 'Fabric came late') as moved \gset
reset role;
select pg_temp.expect(:moved = 2, format('expected 2 targets moved, got %s', :moved));
select pg_temp.expect((select revised_ship_date = current_date + 25 and delay_reason = 'Fabric came late' from public.orders where id = :'o'), 'the new ship date was not saved');
select pg_temp.expect((select planned_on = current_date + 18 and baseline_on = current_date - 12 and target_note like 'Ship date moved to %: Fabric came late'
  from public.line_stages where line_id = :'l' and stage = 'stitching'), 'stitching did not move 30 days with its note and original date');
select pg_temp.expect((select planned_on = current_date + 22 from public.line_stages where line_id = :'l' and stage = 'packed'), 'packed did not move 30 days');
select pg_temp.expect((select planned_on = current_date - 20 and done_on = current_date - 19 from public.line_stages where line_id = :'l' and stage = 'cutting'),
  'a done step moved');
select pg_temp.expect(coalesce(current_setting('sourcingo.ship_move', true), '') = '', 'the move flag stayed on');

-- An earlier date, or only a new reason, moves nothing.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.move_ship_date(:'o', current_date + 20, 'Buyer wants it sooner') as moved \gset
select pg_temp.expect(:moved = 0, 'an earlier date moved targets');
select public.move_ship_date(:'o', current_date + 20, 'Buyer asked') as moved \gset
select pg_temp.expect(:moved = 0, 'a reason change moved targets');
-- Cleared: back to the buyer's date, plan untouched.
select public.move_ship_date(:'o', null, '') as moved \gset
reset role;
select pg_temp.expect((select revised_ship_date is null from public.orders where id = :'o'), 'clearing kept the new date');
select pg_temp.expect((select planned_on = current_date + 18 from public.line_stages where line_id = :'l' and stage = 'stitching'), 'clearing moved targets');

-- A closed order can't be moved.
update public.orders set status = 'cancelled' where id = :'o';
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$select public.move_ship_date('%s', current_date + 40, 'Late')$$, :'o'), 'Only open orders can be updated here.%');
reset role;
