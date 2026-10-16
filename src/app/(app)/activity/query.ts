import { AREAS, ENTRY_COLUMNS, OTHER_AREA, type Names } from "@/lib/activity";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";

export type Filters = { who: string; area: string; action: string; from: string; to: string };
const SOURCES = ["key", "server", "database"];
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function readFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const p = (k: string) => String(sp[k] ?? "").trim();
  return {
    who: /^[0-9a-f-]{36}$/.test(p("who")) || SOURCES.includes(p("who")) ? p("who") : "",
    area: p("area") in AREAS || p("area") === OTHER_AREA.key ? p("area") : "",
    action: ["insert", "update", "delete"].includes(p("action")) ? p("action") : "",
    from: isDate(p("from")) ? p("from") : "",
    to: isDate(p("to")) ? p("to") : "",
  };
}

export const filterQuery = (f: Filters) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

// The company's history, newest first, narrowed by the filters.
export function queryActivity(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, f: Filters) {
  let q = supabase.from("history").select(ENTRY_COLUMNS).eq("company_id", companyId);
  if (f.who && SOURCES.includes(f.who)) q = q.is("actor", null).eq("source", f.who);
  else if (f.who) q = q.eq("actor", f.who);
  if (f.area === OTHER_AREA.key) q = q.not("table_name", "in", `(${OTHER_AREA.known.join(",")})`);
  else if (f.area) q = q.in("table_name", AREAS[f.area].tables);
  if (f.action) q = q.eq("action", f.action);
  if (f.from) q = q.gte("at", `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lt("at", new Date(Date.parse(`${f.to}T00:00:00+05:30`) + 86_400_000).toISOString());
  return q.order("id", { ascending: false });
}

export async function loadNames(companyId: string): Promise<Names> {
  const supabase = await createClient();
  const [team, buyers, factories, { data: orders }] = await Promise.all([
    loadTeam(), loadBuyers(), loadFactories(),
    // Every order, page by page, so entries of older orders still show the order number.
    fetchAll((a, z) => supabase.from("orders").select("id, order_no").eq("company_id", companyId).order("id").range(a, z)),
  ]);
  return {
    people: new Map(team.map((m) => [m.user_id, personName(m)])),
    buyers: new Map(buyers.map((b) => [b.id, buyerName(b)])),
    factories: new Map(factories.map((x) => [x.id, x.name])),
    orders: new Map(orders.map((o) => [o.id as string, o.order_no as string])),
  };
}
