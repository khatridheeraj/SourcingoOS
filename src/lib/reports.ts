// Reports: how factories and steps keep to the TNA, pass QC, send plans and ship on time, over a date range.
// One source for the Reports page and its CSV download.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buyerName, type Buyer } from "./data";
import { fetchAll } from "./fetch-all";
import { daysBetween, PLAN_HOURS, SHIP_QC, TNA_STEPS } from "./format";

export const RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
];

type Tally = { done: number; onTime: number; lateDays: number };
export type FactoryScore = {
  id: string; name: string;
  steps: Tally; openLate: number;
  qc: { checked: number; passed: number };
  plans: { asked: number; inTime: number; hours: number; sent: number };
  lots: { shipped: number; onTime: number; pcs: number };
};
export type StepScore = { key: string; label: string } & Tally;
export type BuyerScore = { id: string; name: string; lots: number; onTime: number; pcs: number; grnLate: number };
export type Report = { from: string; today: string; factories: FactoryScore[]; steps: StepScore[]; buyers: BuyerScore[]; total: FactoryScore };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
export const percent = (a: number, b: number) => { const p = pct(a, b); return p == null ? "–" : `${p}%`; };
const istDay = (t: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(t));
const blank = (id: string, name: string): FactoryScore => ({
  id, name, steps: { done: 0, onTime: 0, lateDays: 0 }, openLate: 0, qc: { checked: 0, passed: 0 }, plans: { asked: 0, inTime: 0, hours: 0, sent: 0 }, lots: { shipped: 0, onTime: 0, pcs: 0 },
});

export async function buildReport(supabase: SupabaseClient, companyId: string, from: string, today: string,
  buyers: Buyer[], factories: { id: string; name: string }[]): Promise<Report> {
  const fromTs = `${from}T00:00:00+05:30`;
  const [{ data: lines }, { data: stages }, { data: qc }, { data: pos }, { data: disp }] = await Promise.all([
    fetchAll<{ id: string; factory_id: string | null; order_id: string }>((a, z) => supabase.from("order_lines").select("id, factory_id, order_id")
      .eq("company_id", companyId).is("removed_at", null).order("id").range(a, z)),
    fetchAll<{ line_id: string; stage: string; label: string | null; planned_on: string | null; done_on: string | null }>((a, z) => supabase.from("line_stages")
      .select("line_id, stage, label, planned_on, done_on").eq("company_id", companyId).eq("not_needed", false).not("planned_on", "is", null)
      .or(`done_on.gte.${from},done_on.is.null`).order("line_id").order("stage").range(a, z)),
    fetchAll<{ line_id: string; kind: string; result: string; checked_on: string }>((a, z) => supabase.from("qc_checks").select("line_id, kind, result, checked_on")
      .eq("company_id", companyId).is("cancelled_at", null).in("kind", SHIP_QC).gte("checked_on", from).order("id").range(a, z)),
    fetchAll<{ factory_id: string; plan_requested_at: string | null; factory_sent_at: string | null }>((a, z) => supabase.from("factory_pos")
      .select("factory_id, plan_requested_at, factory_sent_at").eq("company_id", companyId).gte("plan_requested_at", fromTs).order("id").range(a, z)),
    fetchAll<{ id: string; order_id: string; factory_id: string; shipped_at: string; grn_due_on: string | null; grn_at: string | null }>((a, z) => supabase.from("dispatches")
      .select("id, order_id, factory_id, shipped_at, grn_due_on, grn_at").eq("company_id", companyId).is("cancelled_at", null).gte("shipped_at", fromTs).order("id").range(a, z)),
  ]);
  const ids = (disp ?? []).map((d) => d.id);
  const orderIds = [...new Set((disp ?? []).map((d) => d.order_id))];
  const [{ data: dl }, { data: orders }] = ids.length
    ? await Promise.all([
        supabase.from("dispatch_lines").select("dispatch_id, qty").in("dispatch_id", ids),
        supabase.from("orders").select("id, buyer_id, ship_date, revised_ship_date").in("id", orderIds),
      ])
    : [{ data: [] }, { data: [] }];

  const factoryOfLine = new Map((lines ?? []).map((l) => [l.id, l.factory_id]));
  const nameOf = new Map(factories.map((f) => [f.id, f.name]));
  const scores = new Map<string, FactoryScore>();
  const score = (id: string | null | undefined) => {
    if (!id) return null;
    if (!scores.has(id)) scores.set(id, blank(id, nameOf.get(id) ?? "Factory"));
    return scores.get(id)!;
  };
  const steps = new Map<string, StepScore>();
  const total = blank("all", "All factories");

  for (const s of stages ?? []) {
    const f = score(factoryOfLine.get(s.line_id));
    if (!factoryOfLine.has(s.line_id)) continue;
    if (!s.done_on) {
      if (s.planned_on! < today) { if (f) f.openLate++; total.openLate++; }
      continue;
    }
    const late = Math.max(0, daysBetween(s.planned_on!, s.done_on));
    const key = s.stage.startsWith("extra_") ? "extra" : s.stage;
    const st = steps.get(key) ?? { key, label: key === "extra" ? "Extra steps" : TNA_STEPS.find((t) => t.key === key)?.label ?? s.label ?? key, done: 0, onTime: 0, lateDays: 0 };
    for (const t of [f?.steps, total.steps, st]) {
      if (!t) continue;
      t.done++;
      if (!late) t.onTime++;
      t.lateDays += late;
    }
    steps.set(key, st);
  }
  for (const c of qc ?? []) {
    const f = score(factoryOfLine.get(c.line_id));
    for (const t of [f?.qc, total.qc]) if (t) { t.checked++; if (c.result === "pass") t.passed++; }
  }
  for (const p of pos ?? []) {
    if (!p.plan_requested_at) continue;
    const f = score(p.factory_id);
    const sent = p.factory_sent_at && p.factory_sent_at >= p.plan_requested_at ? p.factory_sent_at : null;
    const hours = sent ? (Date.parse(sent) - Date.parse(p.plan_requested_at)) / 3_600_000 : null;
    for (const t of [f?.plans, total.plans]) {
      if (!t) continue;
      t.asked++;
      if (hours != null) { t.sent++; t.hours += hours; if (hours <= PLAN_HOURS) t.inTime++; }
    }
  }
  const orderOf = new Map((orders ?? []).map((o) => [o.id, o]));
  const buyerScores = new Map<string, BuyerScore>();
  const bName = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  for (const d of disp ?? []) {
    const o = orderOf.get(d.order_id);
    const due = o?.revised_ship_date || o?.ship_date;
    const onTime = !!due && istDay(d.shipped_at) <= due;
    const pcs = (dl ?? []).filter((x) => x.dispatch_id === d.id).reduce((s, x) => s + x.qty, 0);
    const f = score(d.factory_id);
    for (const t of [f?.lots, total.lots]) if (t) { t.shipped++; if (onTime) t.onTime++; t.pcs += pcs; }
    if (o) {
      const b = buyerScores.get(o.buyer_id) ?? { id: o.buyer_id, name: bName.get(o.buyer_id) ?? "Buyer", lots: 0, onTime: 0, pcs: 0, grnLate: 0 };
      b.lots++;
      if (onTime) b.onTime++;
      b.pcs += pcs;
      if (!d.grn_at && d.grn_due_on && d.grn_due_on < today) b.grnLate++;
      buyerScores.set(o.buyer_id, b);
    }
  }
  const order = TNA_STEPS.map((t) => t.key);
  return {
    from, today, total,
    factories: [...scores.values()].sort((a, b) => b.steps.done + b.lots.shipped - (a.steps.done + a.lots.shipped) || a.name.localeCompare(b.name)),
    steps: [...steps.values()].sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99)),
    buyers: [...buyerScores.values()].sort((a, b) => b.pcs - a.pcs),
  };
}

// The factory scorecard as CSV, for Excel.
export function reportCsv(r: Report): string {
  const head = ["Factory", "Steps done", "Steps on time %", "Avg days late (late steps)", "Steps overdue now", "Final QC checks", "Final QC passed %",
    "Plans asked", `Plans sent within ${PLAN_HOURS}h %`, "Lots shipped", "Lots on time %", "Pieces shipped"];
  const row = (f: FactoryScore) => [f.name, f.steps.done, pct(f.steps.onTime, f.steps.done) ?? "", f.steps.done - f.steps.onTime ? (f.steps.lateDays / (f.steps.done - f.steps.onTime)).toFixed(1) : "",
    f.openLate, f.qc.checked, pct(f.qc.passed, f.qc.checked) ?? "", f.plans.asked, pct(f.plans.inTime, f.plans.asked) ?? "", f.lots.shipped, pct(f.lots.onTime, f.lots.shipped) ?? "", f.lots.pcs];
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...r.factories.map(row), row(r.total)].map((x) => x.map(cell).join(",")).join("\n");
}
