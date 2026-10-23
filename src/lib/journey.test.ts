// node --experimental-strip-types --test src/lib/journey.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { journey, type JourneyInput } from "./journey.ts";

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
test("factory updates and samples come first while making", () => {
  assert.equal(j({ pendingUpdates: 2 }).next.action.kind, "review");
  assert.equal(j({ samplesToAct: 1 }).next.action.kind, "samples");
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
