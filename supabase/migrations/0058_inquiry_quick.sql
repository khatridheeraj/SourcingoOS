-- Inquiries that are quick to log and easy to move on (0058, Dheeraj, 22 Oct 2026).
-- A sample sent to the buyer is a step between the quote and the order: the date it went and a short note. The
-- inquiry stays open (new or quoted) while the buyer looks at it, so Home, the brief and follow-ups work as before.
-- An inquiry can come from an email the PO pickup caught that wasn't a PO; it keeps a link to that email and its files.
-- Nothing is deleted.

alter table public.inquiries
  add column sample_sent_on date,
  add column sample_note text check (length(sample_note) <= 300),
  add column incoming_po_id uuid references public.incoming_pos (id);
create unique index inquiries_incoming_po_key on public.inquiries (incoming_po_id) where incoming_po_id is not null;

-- The email an inquiry comes from must be in the same company, and stays fixed once set.
create function public.guard_inquiry_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.incoming_po_id is not null and new.incoming_po_id is distinct from old.incoming_po_id then
    raise exception 'The email this inquiry came from can''t be changed.';
  end if;
  if new.incoming_po_id is not null and (tg_op = 'INSERT' or new.incoming_po_id is distinct from old.incoming_po_id)
     and not exists (select 1 from public.incoming_pos p where p.id = new.incoming_po_id and p.company_id = new.company_id) then
    raise exception 'That email isn''t in this company.';
  end if;
  return new;
end $$;
revoke execute on function public.guard_inquiry_email() from public, anon, authenticated;
create trigger inquiries_email_guard before insert or update on public.inquiries
  for each row execute function public.guard_inquiry_email();
