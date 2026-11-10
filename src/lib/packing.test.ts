import { test } from "node:test";
import assert from "node:assert/strict";
import { packGaps, packTotals, rowProblem, type PackRow } from "./packing.ts";

const r = (from: number, to: number, sizes: Record<string, number>, line = "a"): PackRow => ({ carton_from: from, carton_to: to, line_id: line, sizes, net_kg: 5, gross_kg: 5.6 });

test("totals count every carton in a run", () => {
  const rows = [r(1, 10, { S: 4, M: 8, L: 8 }), r(11, 11, { M: 10 })];
  const t = packTotals(rows);
  assert.equal(t.cartons, 11);
  assert.equal(t.pcs, 210);
  assert.equal(Math.round(t.gross * 10) / 10, 61.6);
  assert.deepEqual(packGaps(rows, [{ id: "a", style: "K-1", colour: null, sent: 200, sizes: [] }]), ["K-1: 210 packed, 200 in this lot"]);
});

test("row checks", () => {
  assert.equal(rowProblem(r(5, 3, { S: 1 }), 0, []), "Row 1: the last carton must be the same as or after the first.");
  assert.equal(rowProblem(r(1, 1, {}), 0, []), "Row 1: enter the pieces in one carton.");
  const rows = [r(1, 5, { S: 1 }), r(5, 6, { S: 1 })];
  assert.equal(rowProblem(rows[1], 1, rows), "Row 2: cartons overlap with row 1.");
});
