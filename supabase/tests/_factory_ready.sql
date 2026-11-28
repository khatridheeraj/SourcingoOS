-- Gives every factory of the signed-in user's company full details and papers (0135), so a test about something
-- else can send and approve factory POs. Run as someone on the orders team: \ir _factory_ready.sql
create or replace function pg_temp.factory_ready() returns void language plpgsql as $$
declare f record; k text;
begin
  for f in select id from public.factories where company_id = public.current_company() loop
    perform public.save_factory_details(f.id, '{"legal_name": "Test Fabrics LLP", "gstin": "08ABDFK7531J1Z4", "address": "Plot 1, Sitapura",
      "pin": "302022", "contact_name": "Mona", "phone": "9414061982", "bank_account": "123456789012", "bank_ifsc": "SBIN0001234", "pay_days": "60"}'
      || case when (select email from public.factories where id = f.id) is null then '{"email": "orders@factory.test"}'::jsonb else '{}' end);
    foreach k in array array['gst', 'pan', 'cheque', 'agreement'] loop
      if not exists (select 1 from public.factory_certificates where factory_id = f.id and kind = k and removed_at is null) then
        perform public.save_factory_document(f.id, k, null, null, public.current_company() || '/factory-files/' || f.id || '/certs/' || k || '.pdf', k || '.pdf');
      end if;
    end loop;
  end loop;
end $$;
select pg_temp.factory_ready();
