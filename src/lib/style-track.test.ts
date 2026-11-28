// node --experimental-strip-types --test src/lib/style-track.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { journey } from "./journey.ts";
import { byUrgency, orderFromStyles, styleCounts, styleDue, styleJourney, styleStates, type TrackFacts, type TrackOrder, type TrackStep } from "./style-track.ts";

const today = "2026-11-28";
const STEPS = ["greige", "fit_sample", "fabric", "printing", "strike_off", "pp_sample", "size_set", "cutting", "stitching", "inline", "midline", "finishing", "packed", "final_qc", "ex_factory"];
const steps = (line: string, done: number, planned = "2026-12-20"): TrackStep[] =>
  STEPS.map((stage, i) => ({ line_id: line, stage, planned_on: planned, done_on: i < done ? "2026-11-01" : null }));
const order: TrackOrder = {
  status: "open", due: "2027-01-02", hasBuyerPo: true,
  pos: [{ factoryId: "kkora", released: true, lockRequested: false }, { factoryId: "sanchi", released: true, lockRequested: false }],
};
// Steps three days apart from 1 Oct with only the first `done` finished: a month behind, so it will miss its date.
const lateSteps = (line: string, done: number): TrackStep[] =>
  STEPS.map((stage, i) => ({ line_id: line, stage, planned_on: new Date(Date.parse("2026-10-01") + i * 3 * 86_400_000).toISOString().slice(0, 10), done_on: i < done ? "2026-10-01" : null }));
// A PO due tomorrow: a style with steps a month late will miss it.
const tight: TrackOrder = { ...order, due: "2026-11-29" };
const facts = (p: Partial<TrackFacts> = {}): TrackFacts => ({ role: "merchandiser", today, steps: [], finalQc: new Map(), ship: [], dispatch: true, ...p });

test("a style with no factory asks for a factory, said of the style", () => {
  const j = styleJourney({ id: "a", style: "Black emb. dress", factoryId: null, hasRate: false }, order, facts());
  assert.equal(j.stage, "factory");
  assert.equal(j.next.title, "Pick a factory");
});

test("a placed style moves on while another style in the PO still has no factory (SO-0018)", () => {
  const f = facts({ steps: [...lateSteps("a", 2), ...steps("b", 3)] });
  const ss = styleStates([
    { id: "a", style: "White digital print shirt", factoryId: "kkora", hasRate: true },
    { id: "b", style: "Blue dori co-ord set", factoryId: "sanchi", hasRate: true },
    { id: "c", style: "Black emb. dress", factoryId: null, hasRate: false },
  ], tight, f);
  assert.equal(ss[0].j.stage, "make");
  assert.equal(ss[0].j.next.tone, "bad");
  assert.equal(ss[1].j.stage, "make");
  assert.equal(ss[2].j.stage, "factory");
  // The old order-level reading stops at the style with no factory...
  const old = journey({
    status: "open", role: "merchandiser", hasBuyerPo: true, today, due: tight.due,
    lines: [{ factoryId: "kkora", hasRate: true }, { factoryId: "sanchi", hasRate: true }, { factoryId: null, hasRate: false }],
    groups: [{ factoryId: "kkora", released: true, lockRequested: false }, { factoryId: "sanchi", released: true, lockRequested: false }, { factoryId: null, released: false, lockRequested: false }],
    steps: f.steps.map((r) => ({ stage: r.stage, planned: r.planned_on, done: r.done_on })), packedAll: false, finalPassed: false,
    samplesToAct: 0, pendingUpdates: 0, dispatch: null,
  });
  assert.equal(old.stage, "factory");
  // ...the style-wise one leads with the late style.
  const o = orderFromStyles(old, ss);
  assert.equal(o.stage, "make");
  assert.equal(o.next.tone, "bad");
  assert.match(o.next.title, /^White digital print shirt: /);
  assert.deepEqual(styleCounts(ss), { late: 1, noFactory: 1, attention: 0, passed: 0 });
});

test("several late styles are named together", () => {
  const ss = styleStates([
    { id: "a", style: "A", factoryId: "kkora", hasRate: true },
    { id: "b", style: "B", factoryId: "kkora", hasRate: true },
    { id: "c", style: "C", factoryId: null, hasRate: false },
  ], tight, facts({ steps: [...lateSteps("a", 2), ...lateSteps("b", 2)] }));
  const base = journey({ status: "open", role: "merchandiser", hasBuyerPo: true, today, lines: [{ factoryId: null, hasRate: false }], groups: [], steps: [],
    packedAll: false, finalPassed: false, samplesToAct: 0, pendingUpdates: 0, dispatch: null });
  const o = orderFromStyles(base, ss);
  assert.equal(o.next.title, "2 styles are behind");
  assert.match(o.next.detail, /^A, B\. /);
});

test("the order's own red step (past the PO ship date) stays first", () => {
  const late = { ...order, due: "2026-11-20" };
  const ss = styleStates([{ id: "a", style: "A", factoryId: "kkora", hasRate: true }, { id: "b", style: "B", factoryId: "kkora", hasRate: true }], late,
    facts({ steps: [...lateSteps("a", 2), ...steps("b", 2)] }));
  const base = journey({ status: "open", role: "merchandiser", hasBuyerPo: true, today, due: late.due, lines: [{ factoryId: "kkora", hasRate: true }],
    groups: [{ factoryId: "kkora", released: true, lockRequested: false }], steps: [{ stage: "fabric", planned: "2026-10-27", done: null }],
    packedAll: false, finalPassed: false, samplesToAct: 0, pendingUpdates: 0, dispatch: null });
  assert.equal(orderFromStyles(base, ss).next.title, base.next.title);
});

test("a style with its own ship date is judged by it", () => {
  const s = { id: "a", style: "A", factoryId: "kkora", hasRate: true, shipDate: "2026-11-25" };
  assert.equal(styleDue(s, order.due), "2026-11-25");
  const j = styleJourney(s, order, facts({ steps: steps("a", 5) }));
  assert.equal(j.next.tone, "bad");
  assert.match(j.next.title, /3 days past the ship date/);
  // Without it, the PO's date (2 Jan) holds.
  assert.equal(styleJourney({ ...s, shipDate: null }, order, facts({ steps: steps("a", 5) })).next.tone, "info");
});

test("a style that passed final QC goes to bills, one style at a time", () => {
  const s = { id: "a", style: "A", factoryId: "kkora", hasRate: true };
  const f = facts({ steps: steps("a", 13), finalQc: new Map([["a", "pass"]]), ship: [{ line_id: "a", ordered: 150, bought: 0, billed: 0, shipped: 0 }] });
  assert.equal(styleJourney(s, order, f).next.title, "Record the factory's bill");
  const billed = facts({ ...f, ship: [{ line_id: "a", ordered: 150, bought: 150, billed: 0, shipped: 0 }] });
  assert.equal(styleJourney(s, order, billed).next.title, "Add our invoice");
  const sent = facts({ ...f, ship: [{ line_id: "a", ordered: 150, bought: 150, billed: 150, shipped: 150 }] });
  assert.equal(styleJourney(s, order, sent).next.action.kind, "ship");
});

test("a style whose factory PO waits for the owner waits; others carry on", () => {
  const o2 = { ...order, pos: [{ factoryId: "kkora", released: false, lockRequested: true }] };
  const j = styleJourney({ id: "a", style: "A", factoryId: "kkora", hasRate: true }, o2, facts());
  assert.equal(j.stage, "approve");
  assert.equal(j.next.action.kind, "none");
});

test("urgency: red before amber, actions before waiting, earlier stage first", () => {
  const ss = styleStates([
    { id: "a", style: "A", factoryId: null, hasRate: false },
    { id: "b", style: "B", factoryId: "kkora", hasRate: true },
  ], tight, facts({ steps: lateSteps("b", 2) }));
  assert.deepEqual([...ss].sort((x, y) => byUrgency(x.j, y.j)).map((s) => s.style), ["B", "A"]);
});

test("a step past target while the style still makes its date asks for an update in amber", () => {
  const j = styleJourney({ id: "a", style: "A", factoryId: "kkora", hasRate: true }, order,
    facts({ steps: steps("a", 3).map((r, i) => (i === 3 ? { ...r, planned_on: "2026-11-25" } : r)) }));
  assert.equal(j.next.tone, "warn");
  assert.match(j.next.title, /^Printing \/ dyeing needs an update/);
});
