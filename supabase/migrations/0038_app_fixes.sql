-- App fixes from the review of 16 Oct 2026.

-- 1. Quality could download dispatch papers (e-way bill, LR, GRN, goods photos), which carry purchase and sale values:
--    any member could read every file in the company's folder. Files under <company>/<order>/dispatch/ are now
--    open only to the orders team and Accounts, the same people who see the dispatch itself. QC photos, reports and
--    style photos stay open to every member. (The payments screens show no dispatch files; Accounts reads them
--    through the order page, and the owner and Accounts are both on the orders team rule.)
create or replace function public.can_read_order_file(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if not public.is_member(v_parts[1]::uuid) then
    return false;
  end if;
  return v_parts[3] is distinct from 'dispatch' or public.can_edit_orders(v_parts[1]::uuid);
exception when invalid_text_representation then
  return false;
end $$;
revoke execute on function public.can_read_order_file(text) from public, anon;
grant execute on function public.can_read_order_file(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $p$alter policy "order photos read" on storage.objects
      using (bucket_id = 'order-photos' and public.can_read_order_file(name))$p$;
  end if;
end $$;

-- 2. An order's activity list looks up history entries by the order they belong to (a style, a step, a QC check).
--    That scanned the whole company's history on every open of an order page. An index on the JSON field alone
--    isn't used for staff, because the history read rule must run before a JSON lookup is allowed to; a plain
--    column is, so the entry's order is kept in its own column (filled in by the database) and indexed.
alter table public.history add column if not exists order_id text
  generated always as (coalesce(after ->> 'order_id', before ->> 'order_id')) stored;
create index if not exists history_order_idx on public.history (company_id, order_id);
