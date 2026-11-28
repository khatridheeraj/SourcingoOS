import { NO_COMPANY } from "@/lib/names";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { factoryRecord, recordLine, type RecordFacts } from "@/lib/factory-record";
import { todayIST } from "@/lib/format";
import { FactoryBoard } from "./factory-board";
import { FactoryList } from "./factory-list";
import { FactoriesTabs } from "./factories-tabs";
import { AskedToJoin, type Application } from "./asked";
import type { Gaps } from "@/lib/factory-kyc";

export default async function FactoriesPage({ searchParams }: PageProps<"/factories">) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "work";
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  if (!canEditOrders(me?.role)) redirect("/");
  const [factories, { data: lines }, { data: recs }, { data: asked }, { data: gapRows }] = await Promise.all([
    loadFactories(),
    // Read page by page: a busy company has more than 1,000 open styles. Only the list shows the counts.
    view === "work" ? { data: [] } : fetchAll((a, z) => supabase.from("order_lines").select("factory_id, orders!inner(status)").eq("company_id", me?.companyId ?? NO_COMPANY)
      .eq("orders.status", "open").is("removed_at", null).not("factory_id", "is", null).order("id").range(a, z)),
    // Each factory's record, in one line per row.
    view === "work" ? { data: [] } : supabase.rpc("factory_records"),
    // Factories that asked to join on the website and are still to be called or decided.
    supabase.from("factory_applications").select("id, name, city, contact_name, phone, email, makes, pieces_month, people, message, status, created_at, ref_factory:factories!referred_by_factory(name), ref_buyer:buyers!referred_by_buyer(code)")
      .eq("company_id", me?.companyId ?? NO_COMPANY).in("status", ["new", "contacted"]).order("created_at", { ascending: false }).limit(50),
    // What each factory still lacks before it can have a PO (0135).
    view === "work" ? { data: [] } : supabase.rpc("factory_gaps"),
  ]);
  const gaps = Object.fromEntries(((gapRows ?? []) as Gaps[]).map((g) => [g.factory_id, g]));
  const today = todayIST();
  const records: Record<string, { line: string; tone: string; verified: boolean }> = {};
  for (const f of (recs ?? []) as RecordFacts[]) {
    const r = factoryRecord(f, today);
    if (f.factory_id) records[f.factory_id] = { line: recordLine(f, r), tone: r.level === "watch" ? "warn" : "", verified: !!r.visit?.current };
  }
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
      <AskedToJoin rows={(asked ?? []) as unknown as Application[]} today={today} />
      <FactoriesTabs at={view} count={factories.length} />
      {view === "work" ? <FactoryBoard factories={factories} /> : <FactoryList factories={factories} openStyles={openStyles} records={records} gaps={gaps} />}
    </>
  );
}
