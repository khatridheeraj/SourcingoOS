-- There must always be at least one active owner, or nobody can approve
-- people, lock TNAs or approve GRNs.

create function guard_last_owner() returns trigger
  language plpgsql set search_path = public as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role is distinct from 'owner' or not new.active)
     and not exists (select 1 from profiles where id <> old.id and role = 'owner' and active) then
    raise exception 'Sourcingo OS needs at least one active owner. Make someone else an owner first.';
  end if;
  return coalesce(new, old);
end $$;
create trigger guard_last_owner before update or delete on profiles for each row execute function guard_last_owner();
