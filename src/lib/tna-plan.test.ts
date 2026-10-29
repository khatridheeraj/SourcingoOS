import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySteps, factoryPace, fillEmptyTargets, FABRIC_STEP_DAYS, project, startBuffer, startTargets, STEP_DAYS, stepDays, type StartStyle } from "./tna-plan.ts";

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

// SO-0022 as Vidhi saved it on 27 Oct: every step planned, ending with Ex-factory on 1 Nov; the order ships 4 Nov.
const STD = Object.keys(STEP_DAYS);
const VIDHI: Record<string, string> = {
  greige: "2026-10-01", fit_sample: "2026-10-04", fabric: "2026-10-03", printing: "2026-10-10", strike_off: "2026-10-06",
  pp_sample: "2026-10-17", size_set: "2026-10-17", cutting: "2026-10-19", stitching: "2026-10-20", inline: "2026-10-23",
  midline: "2026-10-26", finishing: "2026-10-29", packed: "2026-10-30", final_qc: "2026-10-31", ex_factory: "2026-11-01",
};
const style = (dates: Record<string, string>, id = "a"): StartStyle => ({
  id, steps: STD.map((key) => ({ key, planned_on: dates[key] ?? "", done_on: "", not_needed: false, extra: false })),
});
const TODAY = "2026-10-29";

test("start production opens with a buffer her own plan fits in, never one that pushes her dates out", () => {
  // 4 Nov less 3 days is 1 Nov, her Ex-factory date; the standard 7 days would have put the finish before today.
  assert.equal(startBuffer([style(VIDHI)], "2026-11-04", TODAY, 7), 3);
  // A plan that leaves more room than the standard buffer keeps the standard one, and a saved buffer always wins.
  assert.equal(startBuffer([style({ ...VIDHI, ex_factory: "2026-11-12" })], "2026-11-24", TODAY, 7), 7);
  assert.equal(startBuffer([style(VIDHI)], "2026-11-04", TODAY, 7, 5), 5);
  // No dates yet: the standard buffer.
  assert.equal(startBuffer([style({})], "2026-11-04", TODAY, 7), 7);
});

test("starting production never changes a date the merchandiser saved, passed or not", () => {
  const plan = startTargets([style(VIDHI), style(VIDHI, "b")], "2026-11-01", TODAY);
  assert.deepEqual(plan, { a: {}, b: {} });
});

test("dates after the finish date move only when she asks, and then only those", () => {
  // With 6 days' buffer the factory finishes 29 Oct: Packed, Final QC and Ex-factory are after it.
  assert.deepEqual(startTargets([style(VIDHI)], TODAY, TODAY), { a: {} });
  assert.deepEqual(startTargets([style(VIDHI)], TODAY, TODAY, true), { a: { packed: TODAY, final_qc: TODAY, ex_factory: TODAY } });
});

test("with no day left before the finish date the empty steps are not all squashed onto today", () => {
  assert.deepEqual(startTargets([style({})], TODAY, TODAY), { a: {} });
  assert.equal(emptySteps([style({})]), 15);
  assert.equal(emptySteps([style(VIDHI)]), 0);
});

test("only the empty steps are filled, inside the days left and around her own dates", () => {
  const { greige, fabric, cutting, ...rest } = VIDHI;
  void greige; void fabric; void cutting;
  const plan = startTargets([style(rest)], "2026-11-01", TODAY).a;
  assert.deepEqual(Object.keys(plan).sort(), ["cutting", "fabric", "greige"]);
  for (const k of Object.keys(plan)) assert.ok(plan[k] >= TODAY && plan[k] <= "2026-11-01", `${k} ${plan[k]}`);
});
