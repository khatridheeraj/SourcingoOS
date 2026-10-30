import assert from "node:assert/strict";
import { test } from "node:test";
import { dayAtNear, dayNear, dayTimeAt, dayTimeNear, qtyTotal, qtyU, unitOf, unitOfAll } from "./format.ts";

test("fabric is counted in metres, garments in pieces", () => {
  assert.equal(unitOf("fabric"), "m");
  assert.equal(unitOf("garment"), "pcs");
  assert.equal(unitOf(null), "pcs");
  assert.equal(qtyU(2500, "fabric"), "2,500 m");
  assert.equal(qtyU(500, "garment"), "500 pcs");
});

test("totals keep metres and pieces apart", () => {
  assert.equal(qtyTotal([{ qty: 150, product: "fabric" }, { qty: 250, product: "fabric" }]), "400 m");
  assert.equal(qtyTotal([{ qty: 500, product: "garment" }, { qty: 250, product: "fabric" }]), "500 pcs + 250 m");
  assert.equal(qtyTotal([]), "0 pcs");
  assert.equal(unitOfAll([{ product: "fabric" }]), "m");
  assert.equal(unitOfAll([{ product: "fabric" }, { product: "garment" }]), "units");
  assert.equal(unitOfAll([{ product: "garment" }]), "pcs");
});

test("near dates drop the year, other years keep it", () => {
  assert.equal(dayNear("2026-10-24", "2026-10-26"), "24 Oct");
  assert.equal(dayNear("2025-12-05", "2026-01-10"), "5 Dec 2025");
  assert.equal(dayNear(null, "2026-10-26"), "");
  // 20:00 UTC on 5 Oct is already 6 Oct in India.
  assert.equal(dayAtNear("2026-10-05T20:00:00Z", "2026-10-26"), "6 Oct");
  assert.equal(dayAtNear("2025-10-05T20:00:00Z", "2026-10-26"), "6 Oct 2025");
  assert.equal(dayTimeNear("2026-10-23T22:19:00Z", "2026-10-26"), "24 Oct, 3:49 am");
  assert.equal(dayTimeNear("2025-10-23T22:19:00Z", "2026-10-26"), "24 Oct 2025, 3:49 am");
  assert.equal(dayTimeNear(null, "2026-10-26"), "");
  // September is "Sep" like every other date, and a time from last year keeps its year (31 Dec 2025 seen on 2 Jan 2026).
  assert.equal(dayTimeAt(new Date("2026-09-30T08:00:00Z"), "2026-10-30"), "30 Sep, 1:30 pm");
  assert.equal(dayTimeAt(new Date("2025-12-31T12:00:00Z"), "2026-01-02"), "31 Dec 2025, 5:30 pm");
});
