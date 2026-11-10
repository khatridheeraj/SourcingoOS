-- Team notes on an order (0080): the team writes, tags colleagues and clears its own tags; nobody else gets in.
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
  ('00000000-0000-0000-0000-0000000000a9', 'qc@sourcingo.in'),
  ('00000000-0000-0000-0000-0000000000f1', 'factory@links.sourcingo.in');
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
insert into public.members (company_id, user_id, role, factory_id)
select c.id, u.id, u.role, u.factory from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner', null::uuid), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser', null),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality', null),
          ('00000000-0000-0000-0000-0000000000f1'::uuid, 'factory', '20000000-0000-0000-0000-000000000001'::uuid)) u (id, role, factory);
update public.profiles set current_company_id = (select id from public.companies);
select id as company from public.companies \gset

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.save_buyer('{"code":"BYR-AH","real_name":"Areeba Fashion House"}') as ah \gset
select public.save_order(jsonb_build_object('buyer_id', :'ah', 'buyer_po', 'AFH07', 'po_date', current_date, 'ship_date', current_date + 60),
  '[{"style":"K-1","qty":"100","buyer_rate":"555","factory_id":"20000000-0000-0000-0000-000000000001","factory_rate":"450"}]'::jsonb) as ord \gset

-- The owner tags Vidhi and Quality, with a photo in the note's own folder.
select public.post_order_note('40000000-0000-0000-0000-000000000001', :'ord', '  Check the buttons on K-1  ',
  array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000000a']::uuid[],
  array[:'company' || '/' || :'ord' || '/notes/40000000-0000-0000-0000-000000000001/p.jpg']) as n1 \gset
select pg_temp.expect((select body = 'Check the buttons on K-1' and cardinality(mentions) = 2 and not ('00000000-0000-0000-0000-00000000000a' = any (mentions))
  from public.order_notes where id = :'n1'), 'note not saved trimmed, or the writer tagged themselves');

-- Wrong photos, empty notes, outsiders tagged: all refused.
select pg_temp.expect_error(format($$select public.post_order_note(null, '%s', 'x', '{}', array['%s/%s/qc/a/p.jpg'])$$, :'ord', :'company', :'ord'), 'Those photos belong to another note.%');
select pg_temp.expect_error(format($$select public.post_order_note(null, '%s', '   ', '{}', '{}')$$, :'ord'), 'Write the note first.');
select pg_temp.expect_error(format($$select public.post_order_note(null, '%s', 'hi', array['00000000-0000-0000-0000-0000000000f1']::uuid[], '{}')$$, :'ord'), 'You can only tag people on the team.');

-- Nobody writes or changes the table directly.
select pg_temp.expect_error(format($$insert into public.order_notes (company_id, order_id, body) values ('%s', '%s', 'x')$$, :'company', :'ord'), 'permission denied%');
select pg_temp.expect_error(format($$update public.order_notes set body = 'y' where id = '%s'$$, :'n1'), 'permission denied%');

-- Quality clears its tag with Done; Vidhi clears hers by replying on the order.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.clear_mentions(:'ord', :'n1') = 1, 'Done did not clear Quality''s tag');
select pg_temp.expect(public.clear_mentions(:'ord', :'n1') = 0, 'Done cleared twice');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 1 from public.order_notes where '00000000-0000-0000-0000-00000000000b' = any (mentions) and not ('00000000-0000-0000-0000-00000000000b' = any (done_by))), 'Vidhi''s tag not open');
select public.post_order_note(null, :'ord', 'Done, buttons are fine', array['00000000-0000-0000-0000-00000000000a']::uuid[], '{}') as n2 \gset
select pg_temp.expect((select count(*) = 0 from public.order_notes where '00000000-0000-0000-0000-00000000000b' = any (mentions) and not ('00000000-0000-0000-0000-00000000000b' = any (done_by))), 'replying did not clear Vidhi''s tag');
select pg_temp.expect((select count(*) = 1 from public.order_notes where '00000000-0000-0000-0000-00000000000a' = any (mentions) and not ('00000000-0000-0000-0000-00000000000a' = any (done_by))), 'the owner''s new tag is missing');

-- A factory login reads nothing and writes nothing; the notes folder is open to the team, Quality included.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) = 0 from public.order_notes), 'a factory reads team notes');
select pg_temp.expect_error(format($$select public.post_order_note(null, '%s', 'hi', '{}', '{}')$$, :'ord'), 'Only the team can write notes on an order.');
select pg_temp.expect(not public.can_upload_photo(:'company' || '/' || :'ord' || '/notes/x/p.jpg'), 'a factory uploads note photos');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.can_upload_photo(:'company' || '/' || :'ord' || '/notes/x/p.jpg'), 'Quality can''t upload note photos');
select pg_temp.expect(not public.can_upload_photo(:'company' || '/' || :'ord' || '/notes/p.jpg'), 'a photo outside a note folder is allowed');
