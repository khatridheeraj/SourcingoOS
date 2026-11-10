// Factory claims (debit notes): money taken back from a factory for short, failed, reworked or late goods.
// Accounts raises a claim in the app and books the same debit note in Tally by hand (the app never writes to Tally).
// Until Tally has it, Bills to pay takes the claim off what to pay; once Tally has it, Tally's own figures already do.

export type ClaimReason = "short" | "quality" | "rework" | "late" | "other";
export const CLAIM_REASON: Record<ClaimReason, string> = {
  short: "Short delivery", quality: "Failed quality", rework: "Rework at our cost", late: "Late delivery", other: "Other",
};
export const CLAIM_REASONS = Object.keys(CLAIM_REASON) as ClaimReason[];

export type Claim = {
  id: string; claim_no: string; ledger: string; bill: string | null; order_id: string | null; claim_date: string;
  reason: ClaimReason; pieces: number | null; amount: number; note: string; created_at: string;
  cancelled_at: string | null; cancel_reason: string | null;
};
// A debit note read from Tally: its party (ledger), date, number, amount, and the bills it is set against.
export type TallyDebit = { party: string | null; vdate: string; number: string | null; amount: number | null; bills: { name: string; amount: number }[] | null };

export type ClaimState = "cancelled" | "booked" | "open";
export type ClaimRow = Claim & { state: ClaimState; booked?: { on: string; number: string | null } };

const close = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= 1;

// Matches each live claim to a debit note in Tally for the same supplier: one against the same bill for the same
// amount (to a rupee), else any debit note of that amount on or after the claim date. Each Tally entry matches once,
// oldest claim first.
export function matchClaims(claims: Claim[], debits: TallyDebit[]): ClaimRow[] {
  const used = new Set<number>();
  const rows = new Map<string, ClaimRow>();
  const live = claims.filter((c) => !c.cancelled_at).sort((a, z) => a.claim_date.localeCompare(z.claim_date) || a.claim_no.localeCompare(z.claim_no));
  const pass = (onBill: boolean) => {
    for (const c of live) {
      if (rows.has(c.id)) continue;
      const i = debits.findIndex((d, k) => {
        if (used.has(k) || d.party !== c.ledger || d.vdate < c.claim_date) return false;
        if (onBill) return !!c.bill && (d.bills ?? []).some((b) => b.name === c.bill && close(Number(b.amount), c.amount));
        return close(Number(d.amount ?? 0), c.amount);
      });
      if (i >= 0) {
        used.add(i);
        rows.set(c.id, { ...c, state: "booked", booked: { on: debits[i].vdate, number: debits[i].number } });
      }
    }
  };
  pass(true);
  pass(false);
  return claims.map((c) => rows.get(c.id) ?? { ...c, state: c.cancelled_at ? "cancelled" : "open" });
}

// What open claims take off each bill, keyed `${ledger}\u0000${bill}`; claims with no bill are keyed by ledger alone.
export const billKey = (ledger: string, bill: string | null) => (bill ? `${ledger}\u0000${bill}` : ledger);
export function openByBill(rows: ClaimRow[]) {
  const m = new Map<string, { amount: number; claims: ClaimRow[] }>();
  for (const r of rows) {
    if (r.state !== "open") continue;
    const k = billKey(r.ledger, r.bill);
    const e = m.get(k) ?? { amount: 0, claims: [] };
    e.amount = Math.round((e.amount + Number(r.amount)) * 100) / 100;
    e.claims.push(r);
    m.set(k, e);
  }
  return m;
}

// "Rs 12,000 or Rs 40 a piece for 300 pieces": a claim amount as typed, or pieces times a rate.
export function claimAmount(amount: string, pieces: string, rate: string): number | null {
  const a = Number(amount.replace(/[^\d.]/g, ""));
  if (amount.trim() && Number.isFinite(a) && a > 0) return Math.round(a * 100) / 100;
  const p = Number(pieces), r = Number(rate.replace(/[^\d.]/g, ""));
  if (Number.isInteger(p) && p > 0 && Number.isFinite(r) && r > 0) return Math.round(p * r * 100) / 100;
  return null;
}
