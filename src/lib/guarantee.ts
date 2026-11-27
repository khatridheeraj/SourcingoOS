// The Sourcingo Guarantee: what each PO's payment plan says is due, by whom and when, and how long the team has left to
// decide a buyer's claim. The database gives the facts (supabase/migrations/0095_guarantee.sql); this file turns them
// into the same plan for the team, the buyer and the factory.

// A milestone: a share of the PO due on an event, or a number of days after it (0113_milestone_payments.sql).
export type When = "po" | "passed" | "shipped" | "delivered";
export type PlanStep = { label: string; pct: number; when: When; days: number };
export const DEFAULT_PLAN: PlanStep[] = [
  { label: "Deposit", pct: 30, when: "po", days: 0 },
  { label: "Balance", pct: 70, when: "passed", days: 0 },
];
export const WHEN_LABEL: Record<When, string> = { po: "With the PO", passed: "Goods pass Final QC", shipped: "Goods ship", delivered: "Goods delivered" };
export const WHENS = Object.keys(WHEN_LABEL) as When[];
export const MAX_STEPS = 5;

export type GuaranteeTerms = { live: boolean; deposit_pct: number; pay_days: number; from?: string | null; shown?: boolean; plan?: PlanStep[] };
export type GFactory = { factory_id: string; name: string; cost: number; passed_on: string | null; paid: number };
export type GOrder = {
  order_id: string; order_no: string; buyer_po: string | null; buyer_id?: string; po_date: string | null; status: string;
  ship_date: string | null; value: number; priced: boolean; passed_on: string | null; paid_deposit: number; paid_balance: number;
  shipped_on?: string | null; delivered_on?: string | null; plan?: PlanStep[]; own_plan?: boolean;
  factories?: GFactory[];
};

// paid: nothing left. due: payable now. late: past its date and still owed. waiting: not payable yet (goods not passed).
export type StepState = "paid" | "due" | "late" | "waiting";
export type Step = { amount: number; paid: number; left: number; due: string | null; state: StepState };

// A buyer's payment counts as late a week after it falls due; the team chases it, the buyer only reads "due".
export const GRACE_DAYS = 7;
export const CLAIM_DAYS = 7;

const rupees = (n: number) => Math.round(n * 100) / 100;
export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function step(amount: number, paid: number, due: string | null, lateAfter: string | null, today: string): Step {
  const left = rupees(Math.max(0, amount - paid));
  // A rupee short is paid: rounding on either side shouldn't keep a step open.
  const state: StepState = left <= 1 ? "paid" : !due ? "waiting" : lateAfter && today > lateAfter ? "late" : "due";
  return { amount: rupees(amount), paid: rupees(paid), left, due, state };
}

// Why a plan can't be saved, in the team's words (the database checks the same: pay_plan_problem); null when fine.
export function planProblem(plan: PlanStep[]): string | null {
  if (!plan.length) return "Add at least one milestone.";
  if (plan.length > MAX_STEPS) return `Up to ${MAX_STEPS} milestones.`;
  for (const s of plan) {
    const label = s.label.trim();
    if (!label || label.length > 40) return "Name each milestone in up to 40 letters.";
    if (!WHENS.includes(s.when)) return "Pick when each milestone falls due.";
    if (!Number.isInteger(s.pct) || !Number.isInteger(s.days)) return "Shares and days are whole numbers.";
    if (s.pct < 1 || s.pct > 100) return "Each milestone is 1% to 100% of the PO.";
    if (s.days < 0 || s.days > 180) return "Up to 180 days after the event.";
  }
  const total = plan.reduce((n, s) => n + s.pct, 0);
  return total === 100 ? null : `The milestones add up to ${total}%. Make them 100%.`;
}

// When a milestone falls due, mid-sentence: "when the goods pass Final QC", "30 days after the goods ship".
export function whenPhrase(s: Pick<PlanStep, "when" | "days">): string {
  if (!s.days) return s.when === "po" ? "with the PO" : s.when === "passed" ? "when the goods pass Final QC" : s.when === "shipped" ? "when the goods ship" : "when the goods are delivered";
  const d = `${s.days} ${s.days === 1 ? "day" : "days"}`;
  return s.when === "po" ? `${d} after the PO` : s.when === "passed" ? `${d} after the Final QC pass` : s.when === "shipped" ? `${d} after the goods ship` : `${d} after delivery`;
}
// The same at the start of a line: "With the PO".
export const whenText = (s: Pick<PlanStep, "when" | "days">) => { const p = whenPhrase(s); return p[0].toUpperCase() + p.slice(1); };

// A plan in one line: "30% with the PO · 70% on the QC pass".
export function planLine(plan: PlanStep[]): string {
  const short: Record<When, string> = { po: "the PO", passed: "the QC pass", shipped: "shipping", delivered: "delivery" };
  return plan.map((s) => `${s.pct}% ${s.days ? `${s.days}d after ${short[s.when]}` : s.when === "po" ? "with the PO" : `on ${short[s.when]}`}`).join(" · ");
}

export type Milestone = Step & PlanStep & { event: string | null };

// The buyer's milestones for one PO. Each is its share of the PO value (the last takes the rounding), due on its
// event plus its days, and late a week after that. Whatever the buyer has paid fills the milestones in order.
export function milestones(o: GOrder, plan: PlanStep[] | undefined, today: string): Milestone[] {
  const steps = plan?.length ? plan : DEFAULT_PLAN;
  const value = Number(o.value);
  let paidLeft = Number(o.paid_deposit) + Number(o.paid_balance);
  let shared = 0;
  const event: Record<When, string | null> = { po: o.po_date ?? today, passed: o.passed_on, shipped: o.shipped_on ?? null, delivered: o.delivered_on ?? null };
  return steps.map((p, i) => {
    const amount = i === steps.length - 1 ? rupees(value - shared) : rupees((value * p.pct) / 100);
    shared += amount;
    const paid = Math.min(amount, Math.max(0, paidLeft));
    paidLeft -= paid;
    const on = event[p.when];
    const due = on ? addDays(on, p.days) : null;
    return { ...p, ...step(amount, paid, due, due && addDays(due, GRACE_DAYS), today), event: on };
  });
}

// The deposit and balance view of a plan (the first milestone and everything after it), kept for older screens.
export function buyerPlan(o: GOrder, t: Pick<GuaranteeTerms, "deposit_pct">, today: string) {
  const deposit = rupees((Number(o.value) * t.deposit_pct) / 100);
  const balance = rupees(Number(o.value) - deposit);
  const depDue = o.po_date ?? today;
  return {
    deposit: step(deposit, Number(o.paid_deposit), depDue, addDays(depDue, GRACE_DAYS), today),
    balance: step(balance, Number(o.paid_balance), o.passed_on, o.passed_on && addDays(o.passed_on, GRACE_DAYS), today),
  };
}

// The factory's step: its cost, due within pay_days of its own goods passing Final QC.
export function factoryPay(f: Pick<GFactory, "cost" | "passed_on" | "paid">, t: Pick<GuaranteeTerms, "pay_days">, today: string): Step {
  const by = f.passed_on ? addDays(f.passed_on, t.pay_days) : null;
  return step(Number(f.cost), Number(f.paid), by, by, today);
}

export type ClaimReason = "defect" | "short" | "wrong" | "late" | "other";
export const CLAIM_REASON: Record<ClaimReason, string> = {
  defect: "Defects in the goods", short: "Fewer pieces than invoiced", wrong: "Wrong colour, size or style", late: "Arrived late", other: "Something else",
};
export const CLAIM_REASONS = Object.keys(CLAIM_REASON) as ClaimReason[];
export type ClaimAsk = "remake" | "refund";
export type Decision = "remake" | "refund" | "declined";

export type BuyerClaim = {
  id: string; claim_no: string; order_id: string; style: string; reason: ClaimReason; pieces: number; ask: ClaimAsk;
  detail: string; photos: string[]; raised_at: string; decide_by: string; decision: Decision | null; amount: number | null;
  answer: string | null; decided_at: string | null;
};

// How long the team has left: "decide by" is a promise to the buyer, so the last two days are amber and past it red.
export function claimClock(c: Pick<BuyerClaim, "decide_by" | "decision">, today: string) {
  if (c.decision) return { left: null, tone: "" as const };
  const left = daysFrom(today, c.decide_by);
  return { left, tone: left < 0 ? ("bad" as const) : left <= 2 ? ("warn" as const) : ("" as const) };
}

// The decision in the buyer's words.
export function decisionText(c: Pick<BuyerClaim, "decision" | "pieces" | "amount">, money: (n: number) => string): string {
  if (c.decision === "remake") return `Agreed: we remake ${c.pieces} ${c.pieces === 1 ? "piece" : "pieces"} at our cost`;
  if (c.decision === "refund") return `Agreed: ${money(Number(c.amount ?? 0))} refunded to you`;
  if (c.decision === "declined") return "Not agreed";
  return "";
}
