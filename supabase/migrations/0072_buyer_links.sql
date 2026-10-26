-- A private link for each buyer: tapping it opens the buyer's live order status with no password, the same way a
-- factory's WhatsApp link opens its panel. Behind the link is a buyer login nobody types; the link's secret is its
-- password. The buyer sees only what the buyer panel already shows: its own orders, never factories or prices.

create table public.buyer_links (
  buyer_id uuid primary key,
  company_id uuid not null default public.current_company() references public.companies (id),
  user_id uuid not null unique,
  secret text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  renewed_at timestamptz,
  foreign key (company_id, buyer_id) references public.buyers (company_id, id)
);
alter table public.buyer_links enable row level security;
create policy buyer_links_read on public.buyer_links for select to authenticated using (public.can_edit_orders(company_id));
revoke all on public.buyer_links from anon, authenticated;
grant select on public.buyer_links to authenticated;

-- The buyer's link (made the first time it is asked for), or a fresh one when p_renew is true, which signs out
-- every phone still using the old one. Returns the secret; the app builds the address from it.
create function public.buyer_link(p_buyer uuid, p_renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := public.current_company();
  v_link public.buyer_links%rowtype;
  v_name text;
  v_active boolean;
  v_secret text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_user uuid := gen_random_uuid();
  v_email text;
begin
  if not public.can_edit_orders(v_company) then
    raise exception 'Only the orders team can send a buyer its link.';
  end if;
  select coalesce((select n.real_name from public.buyer_names n where n.buyer_id = b.id), b.code), b.active
    into v_name, v_active from public.buyers b where b.id = p_buyer and b.company_id = v_company;
  select * into v_link from public.buyer_links where buyer_id = p_buyer;
  if v_name is null or (not v_active and not (p_renew and v_link.buyer_id is not null)) then
    raise exception 'Pick one of your active buyers.';
  end if;
  if v_link.buyer_id is not null and not p_renew then
    if not exists (select 1 from public.members where user_id = v_link.user_id and company_id = v_link.company_id and active) then
      raise exception 'This link was switched off in Team. Make a new link to switch it back on.';
    end if;
    return v_link.secret;
  end if;
  if v_link.buyer_id is not null then
    update auth.users set encrypted_password = extensions.crypt(v_secret, extensions.gen_salt('bf')), updated_at = now()
    where id = v_link.user_id;
    update auth.sessions set not_after = now() where user_id = v_link.user_id and (not_after is null or not_after > now());
    update auth.refresh_tokens set revoked = true where user_id = v_link.user_id::text and not coalesce(revoked, false);
    update public.buyer_links set secret = v_secret, renewed_at = now() where buyer_id = p_buyer;
    update public.members set active = true where user_id = v_link.user_id and company_id = v_link.company_id and not active;
    return v_secret;
  end if;
  -- A login nobody types: no mail is ever sent to this address.
  v_email := 'buyer-' || replace(v_user::text, '-', '') || '@links.sourcingo.in';
  insert into public.invites (company_id, email, role, buyer_id, created_by)
  values (v_company, v_email, 'buyer', p_buyer, auth.uid());
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
          extensions.crypt(v_secret, extensions.gen_salt('bf')), now(),
          '{"provider": "email", "providers": ["email"]}', jsonb_build_object('full_name', v_name || ' (status link)'),
          now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  if not exists (select 1 from public.members where user_id = v_user and company_id = v_company and role = 'buyer' and buyer_id = p_buyer) then
    raise exception 'The buyer login could not be set up.';
  end if;
  insert into public.buyer_links (buyer_id, company_id, user_id, secret) values (p_buyer, v_company, v_user, v_secret);
  return v_secret;
end $$;
revoke execute on function public.buyer_link(uuid, boolean) from public, anon;
grant execute on function public.buyer_link(uuid, boolean) to authenticated;

-- The sign-in address behind a link, for the app to sign the buyer in. Knowing the secret is the proof.
create function public.buyer_link_login(p_secret text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', u.email, 'user_id', k.user_id)
  from public.buyer_links k
  join auth.users u on u.id = k.user_id
  join public.buyers b on b.id = k.buyer_id and b.active
  join public.members m on m.user_id = k.user_id and m.company_id = k.company_id and m.active
  where length(p_secret) >= 24 and k.secret = p_secret
$$;
revoke execute on function public.buyer_link_login(text) from public;
grant execute on function public.buyer_link_login(text) to anon, authenticated;
