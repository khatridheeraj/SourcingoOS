import { test } from "node:test";
import assert from "node:assert/strict";
import { leadFor, leadLine, quoteVsLead, type LeadRow } from "./lead-time.ts";
import { capacityFit, fitLine, mondayOf, type FactoryCap } from "./capacity.ts";

const rows: LeadRow[] = [
  { factory_id: "k", product: "garment", orders: 6, mid: 38, slow: 45 },
  { factory_id: "s", product: "garment", orders: 2, mid: 20, slow: 22 },
  { factory_id: null, product: "garment", orders: 9, mid: 35, slow: 44 },
  { factory_id: null, product: "fabric", orders: 1, mid: 12, slow: 12 },
];

test("a factory with enough orders promises its own lead time; a new one borrows ours", () => {
  assert.deepEqual(leadFor(rows, "k", "garment"), { orders: 6, mid: 38, slow: 45, scope: "factory" });
  assert.equal(leadFor(rows, "s", "garment")?.scope, "company");
  assert.equal(leadFor(rows, null, "fabric"), null, "one fabric order is not a promise");
  assert.equal(leadLine(leadFor(rows, "k", "garment")), "Usually ships 38 days after the PO, 45 at the latest, across 6 orders");
  assert.equal(leadLine(leadFor(rows, "s", "garment")), "Usually ships 35 days after the PO, 44 at the latest, across 9 of our orders");
  assert.match(leadLine(null, "fabric"), /Not enough fabric orders/);
});

test("a quote much faster than the factory has ever delivered is flagged", () => {
  const k = leadFor(rows, "k", "garment");
  assert.equal(quoteVsLead(k, "2026-12-01", "2026-12-20"), "fast");
  assert.equal(quoteVsLead(k, "2026-12-01", "2027-01-05"), "usual");
  assert.equal(quoteVsLead(leadFor(rows, "s", "garment"), "2026-12-01", "2026-12-05"), null, "no flag on borrowed numbers");
});

test("capacity adds the free weeks up to the ready week and ignores stale numbers", () => {
  assert.equal(mondayOf("2026-11-29"), "2026-11-23");
  assert.equal(mondayOf("2026-11-30"), "2026-11-30");
  const cap: FactoryCap = { factory_id: "k", weeks: [
    { week: "2026-11-23", free: 500, note: null, due_pcs: 0, due_m: 0, said_at: "2026-11-25T10:00:00Z" },
    { week: "2026-11-30", free: 700, note: null, due_pcs: 300, due_m: 0, said_at: "2026-11-25T10:00:00Z" },
    { week: "2026-12-07", free: null, note: null, due_pcs: 0, due_m: 0, said_at: null },
    { week: "2026-12-14", free: 4000, note: null, due_pcs: 0, due_m: 0, said_at: "2026-10-01T10:00:00Z" },
  ] };
  assert.deepEqual(capacityFit(cap, "2026-12-08", 1000, "2026-11-27"), { state: "fits", free: 1200, week: "2026-12-07" });
  assert.equal(capacityFit(cap, "2026-12-08", 2000, "2026-11-27").state, "tight");
  assert.equal(capacityFit(cap, "2026-12-08", 5000, "2026-11-27").state, "full");
  assert.equal(capacityFit(cap, "2026-12-18", 5000, "2026-12-10").state, "unknown", "a number from October is stale");
  assert.equal(capacityFit(undefined, "2026-12-18", 5, "2026-12-10").state, "unknown");
  assert.equal(fitLine({ state: "tight", free: 1200, week: "" }, 2000), "Tight: 1,200 pcs free by then, needs 2,000");
});
