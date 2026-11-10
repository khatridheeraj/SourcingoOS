import { test } from "node:test";
import assert from "node:assert/strict";
import { planText, planVisits, type PlanStep } from "./visit-plan.ts";

const st = (f: string, stage: string, label: string, on: string, line = "l1", order = "SO-1"): PlanStep => ({ factory_id: f, order_no: order, line_id: line, stage, label, planned_on: on });
const factories = [{ id: "k", name: "Kkora" }, { id: "s", name: "Shree" }, { id: "f", name: "Flavia" }];

// 10 Nov 2026 is a Tuesday; 15 Nov is a Sunday.
test("late steps and overdue visits go today; inspections on their day; other steps ride along", () => {
  const days = planVisits({
    today: "2026-11-10", days: 7, every: 3, factories,
    lastVisit: new Map([["k", "2026-11-09"], ["s", "2026-11-09"], ["f", "2026-11-01"]]),
    steps: [
      st("k", "stitching", "Stitching", "2026-11-08"), st("f", "cutting", "Cutting", "2026-12-01", "l9", "SO-9"),
      st("s", "final_qc", "Final QC", "2026-11-12", "l2", "SO-2"), st("s", "final_qc", "Final QC", "2026-11-12", "l3", "SO-2"),
      st("s", "packing", "Packing", "2026-11-13", "l2", "SO-2"),
      st("s", "inline", "Inline QC", "2026-11-15", "l4", "SO-3"),
    ],
  });
  assert.equal(days.length, 6, "Sunday is left out");
  const today = days[0].visits;
  assert.deepEqual(today.map((v) => [v.name, v.tone]), [["Kkora", "bad"], ["Flavia", "warn"]]);
  assert.match(today[0].reasons[0], /1 step late: Stitching/);
  assert.equal(today[1].reasons[0], "Not visited for 9 days");
  const thu = days.find((d) => d.date === "2026-11-12")!.visits;
  assert.deepEqual(thu[0].reasons, ["Final QC · 2 styles", "Packing due"]);
  assert.deepEqual(thu[0].orders, ["SO-2"]);
  const mon = days.find((d) => d.date === "2026-11-16")!.visits;
  assert.equal(mon[0].name, "Shree", "a Sunday inspection moves to Monday");
  assert.match(planText(days, (d) => d), /\*2026-11-12\*: Shree \(Final QC · 2 styles; Packing due\)/);
});

test("a recent visit and nothing due means no visit", () => {
  const days = planVisits({ today: "2026-11-10", days: 6, every: 3, factories, lastVisit: new Map([["k", "2026-11-10"]]), steps: [st("k", "cutting", "Cutting", "2026-12-01")] });
  assert.equal(days.every((d) => d.visits.length === 0), true);
});
