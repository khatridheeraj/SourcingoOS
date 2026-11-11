import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSheet, cleanSheet, sheetFrom, sheetProblem, totals, type Sheet } from "./costing.ts";

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  fabrics: [{ name: "Cotton cambric", metres: "2.4", rate: "180" }, { name: "Lining", metres: "0.8", rate: "60" }],
  costs: [{ name: "Trims", amount: "35" }, { name: "Stitching (CMT)", amount: "120" }, { name: "Packing", amount: "" }],
  margin: "15",
  ...over,
});

test("fabric is metres × rate; the price is cost plus margin, rounded up to the rupee", () => {
  const t = totals(sheet());
  assert.equal(t.fabric, 480); // 2.4 × 180 + 0.8 × 60
  assert.equal(t.other, 155);
  assert.equal(t.cost, 635);
  assert.equal(t.price, 731); // 635 × 1.15 = 730.25
});

test("numbers are read the way people type them", () => {
  const t = totals(sheet({ fabrics: [{ name: "Rayon", metres: "2.5 m", rate: "₹ 1,20" }], costs: [{ name: "CMT", amount: "Rs. 100" }], margin: "10%" }));
  assert.equal(t.fabric, 300);
  assert.equal(t.price, 440);
});

test("a costing with nothing in it, a price below cost or a minus sign can't be sent", () => {
  assert.match(sheetProblem(blankSheet(), "100")!, /Fill in/);
  assert.match(sheetProblem(sheet(), "600")!, /below the cost/);
  assert.match(sheetProblem(sheet({ margin: "-5" }), "800")!, /margin/);
  assert.match(sheetProblem(sheet({ fabrics: [{ name: "Silk", metres: "240", rate: "10" }] }), "9999")!, /one piece/);
  assert.match(sheetProblem(sheet(), "")!, /price/);
  assert.equal(sheetProblem(sheet(), "731"), null);
});

test("empty rows are left out when stored, and a stored sheet fills the boxes again", () => {
  const c = cleanSheet(sheet());
  assert.equal(c.costs.length, 2);
  assert.deepEqual(c.fabrics[0], { name: "Cotton cambric", metres: 2.4, rate: 180 });
  const back = sheetFrom(c);
  assert.equal(totals(back).cost, 635);
  assert.equal(sheetFrom(null).fabrics.length, 1);
});
