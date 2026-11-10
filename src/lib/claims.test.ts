import { test } from "node:test";
import assert from "node:assert/strict";
import { billKey, type Claim, claimAmount, matchClaims, openByBill } from "./claims.ts";

const c = (id: string, over: Partial<Claim> = {}): Claim => ({
  id, claim_no: `CL-000${id}`, ledger: "KKORA (PURCHASE)", bill: "KK/101", order_id: null, claim_date: "2026-11-01",
  reason: "short", pieces: 20, amount: 4000, note: "Short by 20 pcs", created_at: "2026-11-01T10:00:00Z", cancelled_at: null, cancel_reason: null, ...over,
});

test("a claim is booked once Tally has a debit note against the same bill for the same amount", () => {
  const rows = matchClaims([c("1")], [{ party: "KKORA (PURCHASE)", vdate: "2026-11-03", number: "DN-7", amount: -4000, bills: [{ name: "KK/101", amount: -4000.4 }] }]);
  assert.equal(rows[0].state, "booked");
  assert.deepEqual(rows[0].booked, { on: "2026-11-03", number: "DN-7" });
});

test("a debit note before the claim, for another supplier or another amount does not book it", () => {
  const rows = matchClaims([c("1")], [
    { party: "KKORA (PURCHASE)", vdate: "2026-10-30", number: "DN-1", amount: 4000, bills: null },
    { party: "OTHER", vdate: "2026-11-03", number: "DN-2", amount: 4000, bills: null },
    { party: "KKORA (PURCHASE)", vdate: "2026-11-03", number: "DN-3", amount: 3000, bills: null },
  ]);
  assert.equal(rows[0].state, "open");
});

test("each Tally debit note books one claim; a bill match wins over an amount match", () => {
  const rows = matchClaims([c("1", { bill: null }), c("2")], [{ party: "KKORA (PURCHASE)", vdate: "2026-11-05", number: "DN-9", amount: 4000, bills: [{ name: "KK/101", amount: 4000 }] }]);
  assert.equal(rows.find((r) => r.id === "2")!.state, "booked");
  assert.equal(rows.find((r) => r.id === "1")!.state, "open");
});

test("cancelled claims stay cancelled and take nothing off a bill", () => {
  const rows = matchClaims([c("1", { cancelled_at: "2026-11-02T00:00:00Z" }), c("2", { amount: 1500.5 }), c("3", { amount: 500 })], []);
  assert.equal(rows[0].state, "cancelled");
  const m = openByBill(rows);
  assert.equal(m.get(billKey("KKORA (PURCHASE)", "KK/101"))!.amount, 2000.5);
  assert.equal(m.get(billKey("KKORA (PURCHASE)", "KK/101"))!.claims.length, 2);
});

test("the amount is typed, or pieces times the rate", () => {
  assert.equal(claimAmount("Rs 12,000", "", ""), 12000);
  assert.equal(claimAmount("", "300", "40.5"), 12150);
  assert.equal(claimAmount("", "3.5", "40"), null);
  assert.equal(claimAmount("0", "", ""), null);
});
