-- The factory's POs inside its own panel: each factory PO Sourcingo has sent, its number, when it was sent,
-- the link that opens it (with photos and Save as PDF), and an Accept button right there. Accepting in the panel
-- does what Accept on the PO's emailed link does, so the 2-hourly reminders stop the same way.

-- The POs sent to the factory whose panel this is (its own login, or a team member's preview).
create function public.factory_po_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', fp.order_id, 'po_no', public.factory_po_no(fp.order_id, fp.factory_id), 'token', fp.accept_token,
      'sent_at', coalesce(fp.mailed_at, fp.accepted_at), 'accepted_at', fp.accepted_at, 'accepted_via', fp.accepted_via,
      'styles', (select count(*) from public.order_lines l where l.order_id = fp.order_id and l.factory_id = fp.factory_id and l.removed_at is null))
    order by fp.mailed_at desc nulls last), '[]'::jsonb)
  from public.factory_pos fp
  join public.orders o on o.id = fp.order_id and o.status = 'open'
  where fp.company_id = public.current_company() and fp.factory_id = public.viewing_factory()
    and fp.released_at is not null and (fp.mailed_at is not null or fp.accepted_at is not null)
$$;
revoke execute on function public.factory_po_list() from public, anon;
grant execute on function public.factory_po_list() to authenticated;

-- The factory accepts one of its POs in the panel. Only the factory's own login can; a team preview cannot.
create function public.factory_accept_po(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_factory uuid := public.my_factory();
begin
  if v_factory is null then
    raise exception 'This login is not set up for a factory.';
  end if;
  if not exists (select 1 from public.factory_pos where order_id = p_order and factory_id = v_factory
                 and company_id = public.current_company() and released_at is not null
                 and (mailed_at is not null or accepted_at is not null)) then
    raise exception 'This PO has not been sent to you yet.';
  end if;
  update public.factory_pos set accepted_at = now(), accepted_via = 'link',
    accept_note = 'Accepted in the factory panel', updated_at = now()
  where order_id = p_order and factory_id = v_factory and accepted_at is null;
end $$;
revoke execute on function public.factory_accept_po(uuid) from public, anon;
grant execute on function public.factory_accept_po(uuid) to authenticated;
