-- Team notes can carry short screen recordings as well as photos and PDF/Excel/Word/CSV files (Dheeraj, 20 Oct 2026):
-- without them a problem is hard to understand. The app keeps each video to 30 MB; the bucket's 50 MB limit stays.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets
       set allowed_mime_types = (select array_agg(distinct t order by t)
                                 from unnest(allowed_mime_types || array['video/mp4', 'video/quicktime', 'video/webm']) t)
     where id = 'order-photos';
  end if;
end $$;
