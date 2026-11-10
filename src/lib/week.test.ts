import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf } from "./week.ts";
import { buildBoard } from "./team-board.ts";

test("weeks run Monday to Sunday", () => {
  assert.deepEqual(weekOf("2026-11-10"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(weekOf("2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(weekOf("2026-11-09", 1), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(weekOf("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
});

test("the team board puts whoever has a late order first and flags quiet people", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const rows = buildBoard({
    people: [{ id: "a", name: "Asha", role: "merchandiser" }, { id: "v", name: "Vidhi", role: "merchandiser" }, { id: "q", name: "QC", role: "quality" }],
    orders: [{ id: "1", merchandiser_id: "v", due: "2026-11-01", late: true, overdueSteps: 3 }, { id: "2", merchandiser_id: "a", due: "2026-12-01", late: false, overdueSteps: 0 }],
    tags: new Map(), edits7: new Map([["a", 4]]), lastAt: new Map([["a", "2026-11-10T09:00:00Z"], ["q", "2026-11-01T09:00:00Z"]]),
    floor7: new Map(), qc7: new Map(), now,
  });
  assert.deepEqual(rows.map((r) => [r.id, r.tone]), [["v", "bad"], ["q", "warn"], ["a", ""]]);
  assert.equal(rows[0].overdueSteps, 3);
});
