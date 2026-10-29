// node --experimental-strip-types --test src/lib/journey.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, journey, shipClock, type JourneyInput } from "./journey.ts";

const today = "2026-10-24";
const steps = (done: number, planned = "2026-11-10") =>
  ["greige", "fit_sample", "fabric", "printing", "strike_off", "pp_sample", "size_set", "cutting", "stitching", "inline", "midline", "finishing", "packed", "final_qc", "ex_factory"]
    .map((stage, i) => ({ stage, planned, done: i < done ? "2026-10-01" : null }));
const base: JourneyInput = {
  status: "open", role: "merchandiser", lines: [{ factoryId: "f1", hasRate: true }], groups: [{ factoryId: "f1", released: true, lockRequested: false }],
  hasBuyerPo: true, steps: steps(3), packedAll: false, finalPassed: false, samplesToAct: 0, pendingUpdates: 0,
  dispatch: { count: 0, uninvoiced: 0, unshipped: 0, billedAll: false }, today,
};
const j = (p: Partial<JourneyInput>) => journey({ ...base, ...p });

test("a new order with no factory starts production", () => {
  const r = j({ lines: [{ factoryId: null, hasRate: false }], groups: [{ factoryId: null, released: false, lockRequested: false }], steps: [] });
  assert.equal(r.stage, "factory");
  assert.equal(r.next.action.kind, "start");
});
test("the buyer's PO comes before the plan", () => {
  const r = j({ groups: [{ factoryId: "f1", released: false, lockRequested: false }], hasBuyerPo: false });
  assert.equal(r.stage, "plan");
  assert.equal(r.next.action.kind, "po");
});
test("Quality never sees a rate gap or the PO step as its job", () => {
  const r = j({ role: "quality", lines: [{ factoryId: "f1", hasRate: false }], groups: [{ factoryId: "f1", released: false, lockRequested: false }], hasBuyerPo: null });
  assert.equal(r.next.action.kind, "none");
});
test("the owner approves; others wait on the owner", () => {
  const g = [{ factoryId: "f1", released: false, lockRequested: true }];
  assert.equal(j({ groups: g, role: "owner" }).next.label, "Check and approve");
  assert.equal(j({ groups: g }).next.action.kind, "none");
  assert.equal(j({ groups: g }).stage, "approve");
});
test("late steps make the production step red", () => {
  const r = j({ steps: steps(3, "2026-10-10") });
  assert.equal(r.stage, "make");
  assert.equal(r.next.tone, "bad");
  assert.equal(r.overdue, 12);
});
test("steps past target with the ship date still safe ask for an update in amber, not red", () => {
  const r = j({ steps: steps(3, "2026-10-20"), riskDays: 0 });
  assert.equal(r.next.tone, "warn");
  assert.equal(r.next.title, "12 steps need an update");
  assert.equal(r.next.action.kind, "update");
  const risky = j({ steps: steps(3, "2026-10-20"), riskDays: 4 });
  assert.equal(risky.next.tone, "bad");
  assert.match(risky.next.detail, /about 4 days late/);
});
test("factory updates and samples come first while making", () => {
  assert.equal(j({ pendingUpdates: 2 }).next.action.kind, "review");
  assert.equal(j({ samplesToAct: 1 }).next.action.kind, "samples");
});
test("once a part has shipped, the next step is the rest or close short, not production", () => {
  const r = j({ steps: steps(10, "2026-10-01"), dispatch: { count: 2, uninvoiced: 0, unshipped: 0, billedAll: false } });
  assert.equal(r.stage, "ship");
  assert.equal(r.next.title, "Ship the rest, or close short");
  assert.equal(r.next.action.kind, "dispatch");
  assert.equal(j({ dispatch: { count: 1, uninvoiced: 1, unshipped: 1, billedAll: false } }).stage, "make");
});
test("packed goes to final QC, then dispatch in order", () => {
  assert.equal(j({ packedAll: true }).stage, "qc");
  assert.equal(j({ packedAll: true, finalPassed: true }).next.title, "Record the factory's bill");
  assert.equal(j({ packedAll: true, finalPassed: true, dispatch: { count: 1, uninvoiced: 1, unshipped: 1, billedAll: false } }).next.title, "Add our invoice");
  assert.equal(j({ packedAll: true, finalPassed: true, dispatch: { count: 1, uninvoiced: 0, unshipped: 1, billedAll: true } }).next.title, "Add transport and send it");
  assert.equal(j({ packedAll: true, finalPassed: true, dispatch: { count: 1, uninvoiced: 0, unshipped: 0, billedAll: true } }).next.action.kind, "ship");
});
test("shipped orders are done", () => {
  assert.equal(j({ status: "shipped" }).stage, "done");
});

test("the ship clock counts days the way people say them", () => {
  assert.deepEqual(shipClock("2026-11-03", today, "open"), { n: "10", unit: "days to ship", tone: "calm" });
  assert.equal(shipClock("2026-10-29", today, "open").tone, "warn");
  assert.equal(shipClock(today, today, "open").unit, "Ships today");
  assert.deepEqual(shipClock("2026-10-23", today, "open"), { n: "1", unit: "day late", tone: "bad" });
  assert.equal(shipClock("2026-10-01", today, "shipped").unit, "Shipped");
  assert.equal(shipClock(null, today, "open").unit, "No ship date");
});
test("each stage opens the part of the order its work is in", () => {
  assert.equal(areaOf("factory", true), "details");
  assert.equal(areaOf("make", false), "tna");
  assert.equal(areaOf("ship", true), "dispatch");
  assert.equal(areaOf("ship", false), "qc");
});
test("an order past its ship date asks the orders team for a new date first", () => {
  const r = j({ due: "2026-09-10" });
  assert.equal(r.stage, "make");
  assert.equal(r.next.action.kind, "date");
  assert.equal(r.next.title, "44 days past the ship date");
  assert.equal(r.next.tone, "bad");
  assert.equal(j({ due: "2026-10-23" }).next.title, "1 day past the ship date");
});
test("a ship date today or ahead, Quality, and packed orders keep their usual next step", () => {
  assert.equal(j({ due: today }).next.action.kind, "update");
  assert.equal(j({ due: "2026-09-10", role: "quality" }).next.action.kind, "visit");
  assert.equal(j({ due: "2026-09-10", packedAll: true }).next.action.kind, "qc");
  assert.equal(j({ due: "2026-09-10", status: "shipped" }).next.action.kind, "none");
});
test("Quality posts production from the floor, and confirms the factory's own updates", () => {
  const r = j({ role: "quality", steps: steps(3, "2026-10-10") });
  assert.equal(r.stage, "make");
  assert.equal(r.next.action.kind, "visit");
  assert.equal(r.next.label, "Post update");
  assert.equal(r.next.tone, "bad");
  assert.equal(j({ role: "quality", steps: steps(3, "2026-10-10"), riskDays: 0 }).next.tone, "warn");
  assert.equal(j({ role: "quality" }).next.title, "Next: Printing / dyeing by 10 Nov");
  assert.equal(j({ role: "quality", pendingUpdates: 2 }).next.action.kind, "review");
  assert.equal(j({ pendingUpdates: 2 }).next.action.kind, "review");
});
