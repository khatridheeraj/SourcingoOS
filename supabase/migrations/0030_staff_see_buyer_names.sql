-- Staff see buyers by their real name, so nobody mixes them up (Dheeraj, 15 Oct 2026). Codes may come back later.
-- Factory logins still can't read them: is_member() is false for a factory.
-- Only the owner can still add or change a name, and the change log of names stays with the owner.
drop policy buyer_names_owner_read on public.buyer_names;
create policy buyer_names_staff_read on public.buyer_names for select to authenticated using (public.is_member(company_id));
