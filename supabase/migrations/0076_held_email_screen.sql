-- Held emails that plainly aren't POs are set aside the moment their files are listed (9 Nov 2026).
-- 0074 set aside the ones already held; this does the same for new mail, in the database, so it works
-- whatever version of the PO inbox function is running. The test is the PO inbox's own: the subject or a
-- file name has to mention a PO ("PO", "P.O.", "purchase order", "new order"). Anything else from an unknown
-- sender (bills, tax mail, job applications) goes to Buyer POs > Not a PO, where the owner can still bring it back.
create or replace function public.screen_held_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'held' and jsonb_array_length(coalesce(new.files, '[]'::jsonb)) > 0
     and concat_ws(' ', new.email_subject, (select string_agg(f ->> 'name', ' ') from jsonb_array_elements(new.files) f))
         !~* '(^|[^a-z])(p\.?\s?o''?s?|purchase\s*orders?|new\s*orders?)([^a-z]|$)' then
    new.status := 'not_po';
    new.closed_at := now();
  end if;
  return new;
end $$;

create or replace trigger incoming_pos_screen_held before update of files on public.incoming_pos
  for each row execute function public.screen_held_email();
