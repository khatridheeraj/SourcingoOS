import assert from "node:assert/strict";
import { test } from "node:test";
import { qtyTotal, qtyU, unitOf, unitOfAll } from "./format.ts";

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
