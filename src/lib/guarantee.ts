// The Sourcingo Guarantee: what each PO's payment plan says is due, by whom and when, and how long the team has left to
// decide a buyer's claim. The database gives the facts (supabase/migrations/0095_guarantee.sql); this file turns them
// into the same plan for the team, the buyer and the factory.

export type GuaranteeTerms = { live: boolean; deposit_pct: number; pay_days: number; from?: string | null; shown?: boolean };
export type GFactory = { factory_id: string; name: string; cost: number; passed_on: string | null; paid: number };
export type GOrder = {
  order_id: string; order_no: string; buyer_po: string | null; buyer_id?: string; po_date: string | null; status: string;
  ship_date: string | null; value: number; priced: boolean; passed_on: string | null; paid_deposit: number; paid_balance: number;
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

// The buyer's two steps: the deposit, due from the PO date, and the balance, due the day the goods pass Final QC.
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
