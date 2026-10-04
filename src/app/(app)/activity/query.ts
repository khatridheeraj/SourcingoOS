import { AREAS, ENTRY_COLUMNS } from "@/lib/activity";
import type { createClient } from "@/lib/supabase/server";

export type Filters = { who: string; area: string; action: string; from: string; to: string; q: string };
const one = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : v ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const from = one(sp.from), to = one(sp.to);
  return { who: one(sp.who), area: AREAS[one(sp.area)] ? one(sp.area) : "", action: one(sp.action).toUpperCase(),
    from: DATE.test(from) ? from : "", to: DATE.test(to) ? to : "", q: one(sp.q).slice(0, 80) };
}

export const filterQuery = (f: Filters) =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

// The activity log with the screen's filters applied, newest first. Dates are India dates.
export function queryActivity(supabase: Awaited<ReturnType<typeof createClient>>, f: Filters) {
  let q = supabase.from("audit_log").select(ENTRY_COLUMNS);
  if (f.who === "app" || f.who === "database" || f.who === "api" || f.who === "server") q = q.is("actor", null).eq("source", f.who);
  else if (f.who) q = q.eq("actor", f.who);
  if (f.area) q = q.in("table_name", AREAS[f.area].tables);
  if (f.action) q = q.eq("action", f.action);
  if (f.from) q = q.gte("at", `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lt("at", new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86400000).toISOString());
  if (f.q) q = q.ilike("row_id", `%${f.q.replace(/[%_]/g, "")}%`);
  return q.order("id", { ascending: false });
}
