-- The morning brief also lists factory POs waiting for the owner's lock (and, for the team, plans the owner
-- sent back), and inquiries whose follow-up is due. brief_data_base stays as it is; this replaces the 0044 wrapper
-- with the same team notes plus these.
create or replace function public.brief_data_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
  v_role text;
  v_base jsonb := public.brief_data_base(p_user);
  v_today date := public.india_today();
  v_extra jsonb;
begin
  select p.current_company_id into v_company from public.profiles p where p.id = p_user;
  select m.role into v_role from public.members m where m.company_id = v_company and m.user_id = p_user and m.active;
  if v_role is null or v_role not in ('owner', 'manager', 'merchandiser', 'accounts') then
    return v_base;
  end if;
  v_extra := jsonb_build_object(
    -- The owner sees every PO sent for the lock; the team sees the plans the owner sent back.
    'locks', coalesce((
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'factory', f.name,
                                          'at', coalesce(fp.lock_note_at, fp.lock_requested_at), 'note', fp.lock_note)
                       order by coalesce(fp.lock_note_at, fp.lock_requested_at))
      from public.factory_pos fp join public.orders o on o.id = fp.order_id join public.factories f on f.id = fp.factory_id
      where fp.company_id = v_company and o.status = 'open' and fp.released_at is null
        and case when v_role = 'owner' then fp.lock_requested_at is not null else fp.lock_note is not null end), '[]'::jsonb),
    -- Follow-ups due today or late: the owner sees all, the team its own and the unassigned ones.
    'inquiries_due', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'inquiry_no', i.inquiry_no, 'product', left(i.product, 80), 'on', i.next_follow_up,
                                          'who', coalesce((select n.real_name from public.buyer_names n where n.buyer_id = i.buyer_id), b.code, i.prospect))
                       order by i.next_follow_up, i.inquiry_no)
      from public.inquiries i left join public.buyers b on b.id = i.buyer_id
      where i.company_id = v_company and i.status in ('new', 'quoted') and i.next_follow_up <= v_today
        and (v_role = 'owner' or i.merchandiser_id is null or i.merchandiser_id = p_user)), '[]'::jsonb));
  if v_role = 'owner' then
    v_extra := v_extra || jsonb_build_object('team_notes', coalesce((
      select jsonb_agg(jsonb_build_object('no', n.no, 'kind', n.kind, 'body', left(n.body, 160), 'by', public.help_sender_label(n.company_id, n.created_by),
                                          'at', n.created_at, 'suggestion', left(n.suggestion, 200)) order by n.created_at)
      from public.team_notes n where n.company_id = v_company and n.status = 'new'), '[]'::jsonb));
  end if;
  return v_base || v_extra;
end $$;
revoke execute on function public.brief_data_for(uuid) from public, anon, authenticated;
grant execute on function public.brief_data_for(uuid) to service_role;
