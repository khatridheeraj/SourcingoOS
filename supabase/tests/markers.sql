-- Markers rules. Every block either passes quietly or raises.
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

-- The merchandiser saves a style; the owner sees it, and saving it again keeps one row stamped with the saver.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.marker_styles (doc_id, data) values ('ALHA-01_v1', '{"style": "ALHA-01"}');
insert into public.marker_styles (doc_id, data) values ('ALHA-01_v1', '{"style": "ALHA-01", "ratio": 2}')
  on conflict (company_id, doc_id) do update set data = excluded.data, company_id = excluded.company_id, doc_id = excluded.doc_id;
do $$ begin
  if (select count(*) from public.marker_styles) <> 1 then raise exception 'saving again made a second row'; end if;
  if (select data ->> 'ratio' from public.marker_styles) <> '2' then raise exception 'saving again did not replace the data'; end if;
end $$;
do $$ begin
  update public.marker_styles set saved_by = '00000000-0000-0000-0000-00000000000a', doc_id = 'other';
  if (select saved_by from public.marker_styles) <> '00000000-0000-0000-0000-00000000000b' then raise exception 'saved_by could be set by hand'; end if;
  if (select doc_id from public.marker_styles) <> 'ALHA-01_v1' then raise exception 'a saved version was renamed'; end if;
end $$;
do $$ begin
  insert into public.marker_styles (doc_id, data) values ('bad id!', '{}');
  raise exception 'a bad style name was accepted';
exception when check_violation then null;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from public.marker_styles) <> 1 then raise exception 'the owner does not see the team''s style'; end if;
end $$;

-- Quality is not on the orders team: no styles, no readings.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', false);
do $$ begin
  if (select count(*) from public.marker_styles) <> 0 then raise exception 'Quality sees saved styles'; end if;
end $$;
do $$ begin
  insert into public.marker_styles (doc_id, data) values ('QC_v1', '{}');
  raise exception 'Quality saved a style';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.marker_jobs (prompt) values ('read this');
  raise exception 'Quality started a reading';
exception when insufficient_privilege then null;
end $$;

-- The merchandiser starts a reading and adds photos while it is uploading; nobody in the app reads photos back.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into public.marker_jobs (prompt) values ('read this');
select set_config('test.job', (select id::text from public.marker_jobs), false);
insert into public.marker_job_parts (job_id, part, files)
values (current_setting('test.job')::uuid, 0, '[{"type": "image/jpeg", "data": "AAAA"}]');
do $$ begin
  perform 1 from public.marker_job_parts;
  raise exception 'photos could be read back';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.marker_jobs set status = 'done', result = '{}';
  raise exception 'a reading result could be written from the app';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.marker_jobs (prompt, status) values ('x', 'done');
  raise exception 'a finished reading could be made from the app';
exception when insufficient_privilege then null;
end $$;

-- The owner can see the reading but can't add photos to someone else's.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from public.marker_jobs) <> 1 then raise exception 'the owner does not see the reading'; end if;
end $$;
do $$ begin
  insert into public.marker_job_parts (job_id, part, files)
  values (current_setting('test.job')::uuid, 1, '[{"type": "image/jpeg", "data": "AAAA"}]');
  raise exception 'photos were added to someone else''s reading';
exception when insufficient_privilege then null;
end $$;

-- Once reading has started, no more photos go in.
reset role;
update public.marker_jobs set status = 'reading';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  insert into public.marker_job_parts (job_id, part, files)
  values (current_setting('test.job')::uuid, 2, '[{"type": "image/jpeg", "data": "AAAA"}]');
  raise exception 'photos were added after reading started';
exception when insufficient_privilege then null;
end $$;

-- Readings stay out of the activity history; saved styles are in it.
reset role;
do $$ begin
  if exists (select 1 from public.history where table_name in ('marker_jobs', 'marker_job_parts')) then raise exception 'readings went into the history'; end if;
  if not exists (select 1 from public.history where table_name = 'marker_styles') then raise exception 'saved styles are not in the history'; end if;
end $$;

-- Readings older than a day are cleared when a new one starts.
update public.marker_jobs set created_at = now() - interval '2 days';
set role authenticated;
insert into public.marker_jobs (prompt) values ('again');
reset role;
do $$ begin
  if (select count(*) from public.marker_jobs) <> 1 then raise exception 'old readings were not cleared'; end if;
  if exists (select 1 from public.marker_job_parts) then raise exception 'old photos were not cleared'; end if;
end $$;
