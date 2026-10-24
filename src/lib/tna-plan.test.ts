import { test } from "node:test";
import assert from "node:assert/strict";
import { fillEmptyTargets, FABRIC_STEP_DAYS, stepDays } from "./tna-plan.ts";

const FABRIC = ["greige", "printing", "strike_off", "finishing", "packed", "final_qc", "ex_factory"];
const empty = (stages: string[]) => stages.map((stage) => ({ stage, on: null }));

test("a fabric style gets its own targets over about three weeks, in order, ending on the target date", () => {
  const plan = fillEmptyTargets(empty(FABRIC), "2026-11-30", "2026-10-01", stepDays(true));
  assert.deepEqual(Object.keys(plan), FABRIC);
  assert.equal(plan.greige, "2026-11-09");
  assert.equal(plan.ex_factory, "2026-11-30");
  const dates = FABRIC.map((s) => plan[s]);
  assert.deepEqual([...dates].sort(), dates);
});

test("with less time than usual the fabric steps squeeze into the days left, never before today", () => {
  const plan = fillEmptyTargets(empty(FABRIC), "2026-10-31", "2026-10-24", FABRIC_STEP_DAYS);
  for (const s of FABRIC) assert.ok(plan[s] >= "2026-10-24" && plan[s] <= "2026-10-31", `${s} ${plan[s]}`);
  assert.equal(plan.greige, "2026-10-24");
});

test("a garment keeps the garment standard days", () => {
  const plan = fillEmptyTargets(empty(["greige", "ex_factory"]), "2026-12-30", "2026-10-01");
  assert.equal(plan.greige, "2026-11-05");
});
