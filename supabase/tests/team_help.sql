-- Help and team notes (0044). Every block either passes quietly or raises.
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
  ('00000000-0000-0000-0000-0000000000f1', 'kkora@factory.in'),
  ('00000000-0000-0000-0000-0000000000ee', 'stranger@gmail.com');
insert into public.factories (id, company_id, name) select '20000000-0000-0000-0000-000000000001', id, 'Kkora' from public.companies;
insert into public.members (company_id, user_id, role)
select c.id, u.id, u.role from public.companies c,
  (values ('00000000-0000-0000-0000-00000000000a'::uuid, 'owner'), ('00000000-0000-0000-0000-00000000000b'::uuid, 'merchandiser'),
          ('00000000-0000-0000-0000-0000000000a9'::uuid, 'quality')) u (id, role);
insert into public.members (company_id, user_id, role, factory_id)
select c.id, '00000000-0000-0000-0000-0000000000f1', 'factory', '20000000-0000-0000-0000-000000000001' from public.companies c;
update public.profiles set current_company_id = (select id from public.companies)
where id <> '00000000-0000-0000-0000-0000000000ee';
update public.profiles set full_name = 'Vidhi Khandelwal' where id = '00000000-0000-0000-0000-00000000000b';
select id as co from public.companies \gset

set role authenticated;

-- ---------------------------------------------------------------- sending
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select (public.send_team_note('idea', 'Show the buyer name on the factory board', '/factories', 'Factories', '{}') ->> 'id') as idea \gset
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.team_notes_list())), 'the sender does not see their note');
select pg_temp.expect((select e ->> 'suggestion' is null and e ->> 'sender' is null from jsonb_array_elements(public.team_notes_list()) e),
  'the sender sees the owner-only fields');
select pg_temp.expect_error($$select public.send_team_note('rant', 'x y', null, null, '{}')$$, 'Pick what kind%');
select pg_temp.expect_error($$select public.send_team_note('problem', ' ', null, null, '{}')$$, 'Write a few words%');
select pg_temp.expect_error(format($$select public.send_team_note('problem', 'Broken', null, null, array['%s/help/00000000-0000-0000-0000-00000000000a/x.jpg'])$$, :'co'),
  'Those photos are not yours%');
select public.send_team_note('problem', 'Save button does nothing', '/orders/1', 'Order', array[:'co' || '/help/00000000-0000-0000-0000-00000000000b/a.jpg']);
-- Nobody reads or writes the tables directly.
select pg_temp.expect_error($$select * from public.team_notes$$, 'permission denied%');
select pg_temp.expect_error($$select * from public.help_asks$$, 'permission denied%');

-- A factory login can send a note too, and sees only its own.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.send_team_note('question', 'फोटो कैसे भेजें?', '/factory', 'Factory', '{}');
select pg_temp.expect((select count(*) = 1 from jsonb_array_elements(public.team_notes_list())), 'a factory sees other people''s notes');

-- Quality sees none of the merchandiser's notes.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(jsonb_array_length(public.team_notes_list()) = 0, 'Quality sees other people''s notes');
select pg_temp.expect((public.help_counts() ->> 'new') is null, 'a non-owner gets the owner''s count');
select pg_temp.expect_error(format($$select public.decide_team_note('%s', 'done', 'ok')$$, :'idea'), 'Only the owner%');

-- Someone outside the company can't send anything.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ee');
select pg_temp.expect_error($$select public.send_team_note('idea', 'hello there', null, null, '{}')$$, 'Sign in%');
select pg_temp.expect_error($$select public.log_help_ask('how', null, null)$$, 'Sign in%');

-- ---------------------------------------------------------------- the owner decides
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(jsonb_array_length(public.team_notes_list()) = 3, 'the owner does not see every note');
select pg_temp.expect((public.help_counts() ->> 'new')::int = 3, 'the owner''s count of new notes is wrong');
select pg_temp.expect((select e ->> 'sender' = 'Kkora' from jsonb_array_elements(public.team_notes_list()) e where e ->> 'kind' = 'question'),
  'a factory note does not show the factory''s name');
select pg_temp.expect((select e ->> 'sender' = 'Vidhi Khandelwal' and e ->> 'sender_role' = 'merchandiser' from jsonb_array_elements(public.team_notes_list()) e
  where e ->> 'id' = :'idea'), 'the owner does not see who sent a note');
select public.decide_team_note(:'idea', 'planned', 'Good one, doing it this week.');
select pg_temp.expect_error(format($$select public.decide_team_note('%s', 'maybe', null)$$, :'idea'), 'Pick an outcome%');
select pg_temp.expect((public.help_counts() ->> 'new')::int = 2, 'a decided note still counts as new');

-- The brief lists what is still waiting for the owner, and only for the owner.
reset role;
select pg_temp.expect(jsonb_array_length(public.brief_data_for('00000000-0000-0000-0000-00000000000a') -> 'team_notes') = 2, 'the owner''s brief misses the notes');
select pg_temp.expect(public.brief_data_for('00000000-0000-0000-0000-00000000000b') -> 'team_notes' is null, 'the merchandiser''s brief has the owner''s notes');
select pg_temp.expect(public.brief_data_for('00000000-0000-0000-0000-00000000000b') ->> 'role' = 'merchandiser', 'the brief lost its own fields');
set role authenticated;

-- The sender sees the reply as unread until they open it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((public.help_counts() ->> 'unseen')::int = 1, 'the reply does not show as unread');
select pg_temp.expect((select e ->> 'reply' = 'Good one, doing it this week.' and e ->> 'replied_by' = 'owner'
  and e ->> 'status' = 'planned' from jsonb_array_elements(public.team_notes_list()) e where e ->> 'id' = :'idea'), 'the sender does not see the reply');
select public.mark_team_notes_seen();
select pg_temp.expect((public.help_counts() ->> 'unseen')::int = 0, 'seen notes still show as unread');

-- A decision without a new reply keeps the old reply; deciding the same outcome again doesn't make it unread.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.decide_team_note(:'idea', 'planned', '');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((public.help_counts() ->> 'unseen')::int = 0, 'an unchanged decision showed as unread');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.decide_team_note(:'idea', 'done', null);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select e ->> 'reply' = 'Good one, doing it this week.' and e ->> 'status' = 'done' from jsonb_array_elements(public.team_notes_list()) e
  where e ->> 'id' = :'idea'), 'a decision without a reply lost the reply');
select pg_temp.expect((public.help_counts() ->> 'unseen')::int = 1, 'a new outcome did not show as unread');

-- ---------------------------------------------------------------- questions
select public.log_help_ask('how do I release the PO', '/orders/1', 'release-po') as ask \gset
select public.rate_help_ask(:'ask', false);
select pg_temp.expect(public.help_asks_list() is null, 'a non-owner reads the questions');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.rate_help_ask(:'ask', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select (e ->> 'helpful')::boolean = false and e ->> 'topic' = 'release-po' from jsonb_array_elements(public.help_asks_list()) e),
  'someone else could rate another person''s question');

-- ---------------------------------------------------------------- screenshots
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect(public.can_upload_photo(:'co' || '/help/00000000-0000-0000-0000-00000000000b/a.jpg'), 'the sender can''t upload a screenshot');
select pg_temp.expect(not public.can_upload_photo(:'co' || '/help/00000000-0000-0000-0000-00000000000a/a.jpg'), 'someone uploads into another person''s folder');
select pg_temp.expect(public.can_read_order_file(:'co' || '/help/00000000-0000-0000-0000-00000000000b/a.jpg'), 'the sender can''t open their screenshot');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(not public.can_read_order_file(:'co' || '/help/00000000-0000-0000-0000-00000000000b/a.jpg'), 'Quality opens another person''s screenshot');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.expect(public.can_upload_photo(:'co' || '/help/00000000-0000-0000-0000-0000000000f1/a.jpg'), 'a factory can''t upload a screenshot');
select pg_temp.expect(public.can_read_order_file(:'co' || '/help/00000000-0000-0000-0000-0000000000f1/a.jpg'), 'a factory can''t open its own screenshot');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(public.can_read_order_file(:'co' || '/help/00000000-0000-0000-0000-0000000000f1/a.jpg'), 'the owner can''t open a screenshot');
-- Order photos keep their old rules.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select pg_temp.expect(public.can_read_order_file(:'co' || '/' || gen_random_uuid() || '/qc/x/a.jpg'), 'Quality lost QC photos');
select pg_temp.expect(not public.can_read_order_file(:'co' || '/' || gen_random_uuid() || '/dispatch/x/a.jpg'), 'Quality opens dispatch files');
