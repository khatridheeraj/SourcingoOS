import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryPace, fillEmptyTargets, FABRIC_STEP_DAYS, project, stepDays } from "./tna-plan.ts";

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

const KEYS = ["fabric", "cutting", "stitching", "finishing", "packed", "ex_factory"];
const plan = (dates: string[], done: Record<string, string> = {}) =>
  KEYS.map((stage, i) => ({ stage, planned_on: dates[i], done_on: done[stage] ?? null }));
const DATES = ["2026-10-10", "2026-10-15", "2026-10-20", "2026-10-25", "2026-10-28", "2026-10-30"];

test("a step left open after a later step is done counts as done, so it raises no false alarm", () => {
  const p = project(plan(DATES, { stitching: "2026-10-20" }), "2026-10-22")!;
  assert.equal(p.implied, 2);
  assert.equal(p.finish, "2026-10-30");
  assert.equal(p.slip, 0);
  assert.equal(p.cause, null);
});

test("an open step past its target pushes the rest back and is named as the reason", () => {
  const p = project(plan(DATES, { fabric: "2026-10-10" }), "2026-10-24")!;
  assert.equal(p.finish, "2026-11-08");
  assert.equal(p.slip, 9);
  assert.deepEqual(p.cause, { index: 1, kind: "overdue", days: 9 });
});

test("a step finished late is the reason when it added the days", () => {
  const p = project(plan(DATES, { fabric: "2026-10-16" }), "2026-10-12")!;
  assert.equal(p.slip, 6);
  assert.equal(p.cause?.kind, "done_late");
  assert.equal(p.cause?.index, 0);
});

test("a factory that usually runs late moves the steps still to come, once, not step on step", () => {
  const p = project(plan(DATES), "2026-10-01", 3)!;
  assert.equal(p.finish, "2026-11-02");
  assert.equal(p.cause?.kind, "pace");
  assert.equal(project(plan(DATES), "2026-10-01")!.slip, 0);
});

test("a factory's pace is learnt only from enough finished steps, never early, at most 10 days", () => {
  const rows = (f: string, lates: number[]) => lates.map((n) => ({ factory_id: f, planned_on: "2026-10-01", done_on: new Date(Date.parse("2026-10-01") + n * 86_400_000).toISOString().slice(0, 10) }));
  const pace = factoryPace([...rows("a", [1, 2, 3, 3, 3, 4, 5, 9]), ...rows("b", [5, 5, 5]), ...rows("c", [-2, -1, -1, 0, 0, -3, -1, 0]), ...rows("d", Array(9).fill(30))]);
  assert.equal(pace.get("a"), 3);
  assert.equal(pace.has("b"), false);
  assert.equal(pace.has("c"), false);
  assert.equal(pace.get("d"), 10);
});
