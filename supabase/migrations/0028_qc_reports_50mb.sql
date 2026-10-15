-- QC inspection reports are often scanned PDFs of 10 MB or more. Allow up to 50 MB each (the most Supabase's free plan takes).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set file_size_limit = 52428800 where id = 'order-photos';
  end if;
end $$;
