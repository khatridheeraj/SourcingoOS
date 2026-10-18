import { NO_COMPANY } from "@/lib/names";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { FactoryBoard } from "./factory-board";
import { FactoryList } from "./factory-list";

export default async function FactoriesPage({ searchParams }: PageProps<"/factories">) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "work";
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  if (!canEditOrders(me?.role)) redirect("/");
  const [factories, { data: lines }] = await Promise.all([
    loadFactories(),
    // Read page by page: a busy company has more than 1,000 open styles. Only the list shows the counts.
    view === "work" ? { data: [] } : fetchAll((a, z) => supabase.from("order_lines").select("factory_id, orders!inner(status)").eq("company_id", me?.companyId ?? NO_COMPANY)
      .eq("orders.status", "open").is("removed_at", null).not("factory_id", "is", null).order("id").range(a, z)),
  ]);
  const openStyles: Record<string, number> = {};
  for (const l of lines ?? []) if (l.factory_id) openStyles[l.factory_id] = (openStyles[l.factory_id] ?? 0) + 1;
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Factories</h1>
          <p className="hide-phone">
            {view === "work" ? "What each factory is making: its POs, buyers, styles and how far along they are." : "Anyone on the team can add a factory. Mark one inactive instead of deleting it."}
          </p>
        </div>
      </div>
      <nav className="seg" aria-label="Show">
        <Link href="/factories" aria-current={view === "work" ? "page" : undefined}>Work</Link>
        <Link href="/factories?view=list" aria-current={view === "list" ? "page" : undefined}>Factory list <span>{factories.length}</span></Link>
      </nav>
      {view === "work" ? <FactoryBoard factories={factories} /> : <FactoryList factories={factories} openStyles={openStyles} />}
    </>
  );
}
