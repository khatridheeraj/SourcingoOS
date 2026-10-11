-- AI key rules. Every block either passes quietly or raises.
\set ON_ERROR_STOP 1
\set QUIET 1

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
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  perform public.set_ai_key('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  raise exception 'merchandiser set the AI key';
exception when others then
  if sqlerrm <> 'Only the owner can set the AI key.' then raise; end if;
end $$;
do $$ begin
  if public.ai_key_status() <> '{"set": false}'::jsonb then raise exception 'status wrong before the key is set'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  perform public.set_ai_key('hello');
  raise exception 'a junk key was accepted';
exception when others then
  if sqlerrm not like 'That doesn''t look like an AI key%' then raise; end if;
end $$;
select public.set_ai_key('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  ');
select public.set_ai_key('sk-ant-api03-zyxwvutsrqponmlkjihgfedcba');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if public.ai_key_status() ->> 'last4' <> 'dcba' then raise exception 'status does not show the new key'; end if;
end $$;
-- Nobody in the app can read the key itself.
do $$ begin
  perform public.get_ai_key((select id from public.companies));
  raise exception 'the key could be read from the app';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from private.ai_keys;
  raise exception 'the key table could be read from the app';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', false);
do $$ begin
  if public.ai_key_status() is not null then raise exception 'Quality sees the AI key status'; end if;
end $$;

reset role;
select set_config('test.company', (select id::text from public.companies), false);
set role service_role;
do $$ begin
  if public.get_ai_key(current_setting('test.company')::uuid) <> 'sk-ant-api03-zyxwvutsrqponmlkjihgfedcba' then raise exception 'reader cannot fetch the key'; end if;
end $$;
