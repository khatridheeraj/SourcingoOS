// Quality's visit plan for the coming days: which factory to visit on which day, and why. Home's To do says which
// factories need a visit now; this lays the week out so Quality can plan the route and share it.
// Rules, per factory with open production steps:
// - an inspection (inline, mid-line, final QC) on a day is a visit that day;
// - steps already late, or no visit for VISIT_DAYS days, make a visit today;
// - every other step due in the range rides along on the last visit on or before its date, or gets a visit of its own;
// - nobody visits on Sunday: a Sunday visit moves to Monday.

export type PlanStep = { factory_id: string; order_no: string; line_id: string; stage: string; label: string; planned_on: string };
export type PlanVisit = { factoryId: string; name: string; tone: "bad" | "warn" | ""; reasons: string[]; orders: string[] };
export type PlanDay = { date: string; visits: PlanVisit[] };

const QC = new Set(["inline", "midline", "final_qc"]);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const sunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
const workday = (d: string) => (sunday(d) ? addDays(d, 1) : d);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function planVisits(input: {
  today: string; days: number; every: number; factories: { id: string; name: string }[]; steps: PlanStep[]; lastVisit: Map<string, string>;
}): PlanDay[] {
  const { today, days, every } = input;
  const last = addDays(today, days - 1);
  const start = workday(today);
  const name = new Map(input.factories.map((f) => [f.id, f.name]));
  // date -> factory -> visit
  type Draft = Omit<PlanVisit, "orders"> & { orders: Set<string> };
  const plan = new Map<string, Map<string, Draft>>();
  const visit = (date: string, f: string, tone: PlanVisit["tone"]) => {
    const d = workday(date);
    const day = plan.get(d) ?? new Map<string, Draft>();
    plan.set(d, day);
    const v: Draft = day.get(f) ?? { factoryId: f, name: name.get(f) ?? "Factory", tone: "", reasons: [], orders: new Set<string>() };
    if (tone === "bad" || (tone === "warn" && v.tone === "")) v.tone = tone;
    day.set(f, v);
    return v;
  };
  const byFactory = new Map<string, PlanStep[]>();
  for (const s of input.steps) byFactory.set(s.factory_id, [...(byFactory.get(s.factory_id) ?? []), s]);

  for (const [f, steps] of byFactory) {
    const late = steps.filter((s) => s.planned_on < today);
    const inRange = steps.filter((s) => s.planned_on >= today && s.planned_on <= last).sort((a, z) => a.planned_on.localeCompare(z.planned_on));
    const seen = input.lastVisit.get(f);
    const overdue = !seen || Math.round((Date.parse(today) - Date.parse(seen)) / 86_400_000) >= every;
    if (late.length) {
      const v = visit(start, f, "bad");
      v.reasons.push(`${plural(late.length, "step")} late: ${[...new Set(late.map((s) => s.label))].slice(0, 3).join(", ")}`);
      late.forEach((s) => v.orders.add(s.order_no));
    } else if (overdue) {
      const v = visit(start, f, "warn");
      v.reasons.push(seen ? `Not visited for ${Math.round((Date.parse(today) - Date.parse(seen)) / 86_400_000)} days` : "Not visited yet");
    }
    // Inspections fix their own days.
    const groups = new Map<string, PlanStep[]>();
    for (const s of inRange.filter((x) => QC.has(x.stage))) groups.set(workday(s.planned_on), [...(groups.get(workday(s.planned_on)) ?? []), s]);
    for (const [d, ss] of groups) {
      const v = visit(d, f, "warn");
      v.reasons.push(`${[...new Set(ss.map((s) => s.label))].join(", ")} · ${plural(new Set(ss.map((s) => s.line_id)).size, "style")}`);
      ss.forEach((s) => v.orders.add(s.order_no));
    }
    // Other steps ride on the last visit on or before their date, else get a visit of their own.
    for (const s of inRange.filter((x) => !QC.has(x.stage))) {
      const dates = [...plan.keys()].filter((d) => d <= workday(s.planned_on) && plan.get(d)!.has(f)).sort();
      const v = dates.length ? plan.get(dates[dates.length - 1])!.get(f)! : visit(s.planned_on, f, "");
      const tag = `${s.label} due`;
      if (!v.reasons.some((r) => r.startsWith(s.label))) v.reasons.push(tag);
      v.orders.add(s.order_no);
    }
  }

  const out: PlanDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (sunday(date)) continue;
    const visits = [...(plan.get(date)?.values() ?? [])]
      .map((v) => ({ factoryId: v.factoryId, name: v.name, tone: v.tone, reasons: v.reasons, orders: [...v.orders].sort() }))
      .sort((a, z) => (a.tone === "bad" ? 0 : a.tone === "warn" ? 1 : 2) - (z.tone === "bad" ? 0 : z.tone === "warn" ? 1 : 2) || a.name.localeCompare(z.name));
    out.push({ date, visits });
  }
  return out;
}

// The plan as one WhatsApp message: a line per day with the factories and why.
export function planText(days: PlanDay[], label: (d: string) => string) {
  const lines = days.filter((d) => d.visits.length).map((d) => `*${label(d.date)}*: ${d.visits.map((v) => `${v.name} (${v.reasons.join("; ")})`).join(", ")}`);
  return ["*Factory visits*", ...(lines.length ? lines : ["No visits needed."])].join("\n");
}
