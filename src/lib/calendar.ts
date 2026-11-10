// The team's calendar: what falls on each of the coming days, across every open order (and money, for the owner and
// Accounts). Home's To do says what is late and what to do now; this says what is coming, day by day, so a visit,
// a courier or a payment can be planned.

export type CalKind = "ship" | "qc" | "sample" | "steps" | "plan" | "pay" | "cheque";
export type CalItem = { key: string; kind: CalKind; label: string; code?: string; title: string; detail: string; href: string };
export type CalDay = { date: string; items: CalItem[] };

export const CAL_KIND: Record<CalKind, string> = {
  ship: "Ships", qc: "Inspection", sample: "Sample", steps: "Production", plan: "Factory plan", pay: "Bill to pay", cheque: "Cheque to deposit",
};
const ORDER: CalKind[] = ["ship", "qc", "sample", "plan", "steps", "pay", "cheque"];

export const QC_STEPS: Record<string, string> = { inline: "Inline QC", midline: "Mid-line QC", final_qc: "Final QC" };
export const SAMPLE_STEPS: Record<string, string> = { fit_sample: "Fit sample", strike_off: "Strike off", pp_sample: "PP sample", size_set: "Size set" };

export type CalOrder = { id: string; code: string; title: string; due: string | null; pieces: string };
export type CalStep = { order_id: string; line_id: string; stage: string; label: string; planned_on: string; factory: string };
export type CalPlan = { order_id: string; factory: string; due_on: string };
export type CalBill = { key: string; supplier: string; bill: string | null; due_on: string; amount: string; href: string };
export type CalCheque = { id: string; buyer: string; cheque_no: string; on: string; amount: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

export function buildCalendar(input: {
  today: string; days: number; orders: CalOrder[]; steps: CalStep[]; plans: CalPlan[]; bills?: CalBill[]; cheques?: CalCheque[];
}): CalDay[] {
  const { today, days } = input;
  const last = addDays(today, days - 1);
  const inRange = (d: string | null | undefined): d is string => !!d && d >= today && d <= last;
  const byId = new Map(input.orders.map((o) => [o.id, o]));
  const out = new Map<string, CalItem[]>();
  const put = (date: string, item: CalItem) => out.set(date, [...(out.get(date) ?? []), item]);

  for (const o of input.orders) {
    if (inRange(o.due)) put(o.due, { key: `ship:${o.id}`, kind: "ship", label: CAL_KIND.ship, code: o.code, title: o.title, detail: o.pieces, href: `/orders/${o.id}` });
  }
  // Steps due on one day are grouped per order and kind: "Final QC · 3 styles at Kkora", never one line per style.
  const groups = new Map<string, { date: string; order: CalOrder; kind: CalKind; names: Set<string>; styles: Set<string>; factories: Set<string> }>();
  for (const s of input.steps) {
    const o = byId.get(s.order_id);
    if (!o || !inRange(s.planned_on)) continue;
    const kind: CalKind = QC_STEPS[s.stage] ? "qc" : SAMPLE_STEPS[s.stage] ? "sample" : "steps";
    const k = `${s.planned_on}|${s.order_id}|${kind}`;
    const g = groups.get(k) ?? { date: s.planned_on, order: o, kind, names: new Set(), styles: new Set(), factories: new Set() };
    g.names.add(QC_STEPS[s.stage] ?? SAMPLE_STEPS[s.stage] ?? s.label);
    g.styles.add(s.line_id);
    if (s.factory) g.factories.add(s.factory);
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    const at = g.factories.size ? ` at ${[...g.factories].join(", ")}` : "";
    const tab = g.kind === "sample" ? "samples" : "tna";
    put(g.date, {
      key: k, kind: g.kind, label: g.kind === "steps" ? CAL_KIND.steps : [...g.names].join(", "), code: g.order.code, title: g.order.title,
      detail: `${g.kind === "steps" ? `${[...g.names].join(", ")} · ` : ""}${plural(g.styles.size, "style")}${at}`, href: `/orders/${g.order.id}#${tab}`,
    });
  }
  for (const p of input.plans) {
    const o = byId.get(p.order_id);
    if (o && inRange(p.due_on)) put(p.due_on, { key: `plan:${p.order_id}:${p.factory}`, kind: "plan", label: CAL_KIND.plan, code: o.code, title: o.title, detail: `${p.factory} owes its TNA dates`, href: `/orders/${o.id}#tna` });
  }
  for (const b of input.bills ?? []) {
    if (inRange(b.due_on)) put(b.due_on, { key: `pay:${b.key}`, kind: "pay", label: CAL_KIND.pay, title: b.supplier, detail: `${b.bill ? `Bill ${b.bill} · ` : ""}${b.amount}`, href: b.href });
  }
  for (const c of input.cheques ?? []) {
    // A cheque dated today or earlier can go to the bank today; a post-dated one on its date.
    const on = c.on < today ? today : c.on;
    if (inRange(on)) put(on, { key: `chq:${c.id}`, kind: "cheque", label: CAL_KIND.cheque, title: c.buyer, detail: `Cheque ${c.cheque_no} · ${c.amount}`, href: `/payments/cheques/${c.id}` });
  }

  const result: CalDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const items = (out.get(date) ?? []).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.code ?? a.title).localeCompare(b.code ?? b.title));
    result.push({ date, items });
  }
  return result;
}
