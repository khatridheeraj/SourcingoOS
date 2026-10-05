import { NO_COMPANY } from "@/lib/names";
import { getMe } from "@/lib/auth";
import { loadFactories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { FactoryList } from "./factory-list";

export default async function FactoriesPage() {
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  const [factories, { data: lines }] = await Promise.all([
    loadFactories(),
    supabase.from("order_lines").select("factory_id, orders!inner(status)").eq("company_id", me?.companyId ?? NO_COMPANY).eq("orders.status", "open").not("factory_id", "is", null),
  ]);
  const openStyles: Record<string, number> = {};
  for (const l of lines ?? []) if (l.factory_id) openStyles[l.factory_id] = (openStyles[l.factory_id] ?? 0) + 1;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Factories</h1>
          <p>Anyone on the team can add a factory. Mark one inactive instead of deleting it.</p>
        </div>
      </div>
      <FactoryList factories={factories} openStyles={openStyles} />
    </>
  );
}
