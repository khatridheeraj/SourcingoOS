-- Incoming POs: the team's own sent mail is not a buyer's PO. The Gmail script reads every email with an attachment,
-- sent ones too, so the owner's investor emails and the merchandiser's POs to factories and vendor agreements were
-- held as "unknown sender" and buried the real buyer POs (21 held on 21 Oct, none of them a buyer's PO).
-- Now an email from someone on the team is skipped, unless it is a forward ("Fwd:"/"Fw:"): the team forwarding a
-- buyer's PO is read straight away, without waiting for the owner to accept the sender.

create or replace function public.receive_email_po(p_key text, p_email jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_id uuid;
  v_hold boolean;
  v_team boolean;
begin
  select company_id into v_company from public.inbound_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if v_company is null then
    raise exception 'Unknown mailbox key.';
  end if;
  if coalesce(btrim(p_email ->> 'email_id'), '') = '' then
    raise exception 'The email has no id.';
  end if;
  v_team := public.team_sender(v_company, p_email ->> 'from');
  if v_team and coalesce(p_email ->> 'subject', '') !~* '^\s*(fwd?|fw)\s*:' then
    return null;
  end if;
  v_hold := not v_team
            and exists (select 1 from public.buyers where company_id = v_company and cardinality(po_senders) > 0)
            and not public.po_sender_known(v_company, p_email ->> 'from');
  insert into public.incoming_pos (company_id, source, email_id, email_from, email_subject, email_body, received_at, status,
                                   sender_unknown, created_by)
  values (v_company, 'email', p_email ->> 'email_id', left(p_email ->> 'from', 300), left(p_email ->> 'subject', 500),
          left(p_email ->> 'body', 8000), coalesce((p_email ->> 'received_at')::timestamptz, now()),
          case when v_hold then 'held' else 'receiving' end, v_hold, null)
  on conflict (company_id, email_id, part) where email_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- True when the sender is someone on the company's own team (not a factory or buyer login).
create or replace function public.team_sender(p_company uuid, p_from text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.email_address(p_from) is not null and exists (
    select 1 from public.members m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.role not in ('factory', 'buyer') and lower(p.email) = public.email_address(p_from))
$$;
revoke execute on function public.team_sender(uuid, text) from public, anon, authenticated;

-- The team's own mail already held is set aside, still private to the owner (as if ignored); forwards are left
-- for the owner to accept, since accepting reads them.
update public.incoming_pos i set status = 'not_po'
where i.status = 'held' and public.team_sender(i.company_id, i.email_from)
  and coalesce(i.email_subject, '') !~* '^\s*(fwd?|fw)\s*:';
