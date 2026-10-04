-- Adding a buyer: the code and the private real name are written together,
-- by the owner only, with the code numbered from buyer_seq.

-- 0001 seeded BYR-...-0001 to 0004 without using the sequence.
do $$ begin
  perform setval('buyer_seq', greatest(
    (select coalesce(max((regexp_match(code, '(\d+)$'))[1]::int), 0) from buyers), 1));
end $$;

create function create_buyer(p_real_name text, p_initials text default null,
                             p_payment_terms text default null, p_address text default null)
  returns text
  language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(p_real_name); v_init text; v_id uuid; v_code text;
begin
  if not is_owner() then raise exception 'Only the owner can add buyers.'; end if;
  if v_name is null or v_name = '' then raise exception 'Enter the buyer''s real name.'; end if;
  if exists (select 1 from buyer_registry where lower(real_name) = lower(v_name)) then
    raise exception '% already has a buyer code.', v_name;
  end if;
  v_init := upper(regexp_replace(coalesce(p_initials, ''), '[^A-Za-z]', '', 'g'));
  if v_init = '' then
    select upper(string_agg(left(w, 1), '')) into v_init
      from regexp_split_to_table(v_name, '\s+') w
     where w !~* '^(pvt\.?|private|ltd\.?|limited|llp|the|&)$';
  end if;
  v_init := left(coalesce(nullif(v_init, ''), 'BY'), 5);
  v_code := 'BYR-' || v_init || '-' || lpad(nextval('buyer_seq')::text, 4, '0');
  insert into buyers (code, default_payment_terms, default_address)
    values (v_code, nullif(btrim(p_payment_terms), ''), nullif(btrim(p_address), '')) returning id into v_id;
  insert into buyer_registry (buyer_id, real_name) values (v_id, v_name);
  return v_code;
end $$;

grant execute on function create_buyer(text, text, text, text) to authenticated;
