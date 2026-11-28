import { test } from "node:test";
import assert from "node:assert/strict";
import { canAskVisit, onboardingSteps, readyLine, visitState, type FactoryProfile } from "./onboarding.ts";

const base: FactoryProfile = { factory_id: "f", makes: [], photos: [] };
const today = "2026-12-01";

test("a new factory has nothing done and can't ask for a visit yet", () => {
  const s = onboardingSteps(base, false, null, today);
  assert.deepEqual(s.map((x) => x.done), [false, false, false, false]);
  assert.equal(canAskVisit(s), false);
  assert.equal(readyLine(s), "0 of 4 ready");
});

test("about needs what it makes, people and pieces a month", () => {
  assert.equal(onboardingSteps({ ...base, makes: ["Kurtas"], people: 20 }, false, null, today)[0].done, false);
  assert.equal(onboardingSteps({ ...base, makes: ["Kurtas"], people: 20, pieces_month: 3000 }, false, null, today)[0].done, true);
});

test("three photos and capacity, then a visit can be asked", () => {
  const p = { ...base, makes: ["Kurtas"], people: 20, pieces_month: 3000, photos: ["a", "b", "c"] };
  const s = onboardingSteps(p, true, null, today);
  assert.equal(canAskVisit(s), true);
  assert.equal(readyLine(s), "3 of 4 ready");
  assert.equal(readyLine(onboardingSteps(p, true, "2026-11-20", today)), "Ready for orders");
});

test("visit: asked, booked, a booking in the past falls back, verified wins", () => {
  assert.deepEqual(visitState({ ...base, visit_asked_at: "x", visit_from: "2026-12-05" }, null, today), { state: "asked", on: "2026-12-05" });
  assert.deepEqual(visitState({ ...base, visit_asked_at: "x", visit_on: "2026-12-03" }, null, today), { state: "booked", on: "2026-12-03" });
  assert.equal(visitState({ ...base, visit_asked_at: "x", visit_on: "2026-11-25" }, null, today).state, "none");
  assert.equal(visitState({ ...base, visit_on: "2026-12-03" }, "2026-11-30", today).state, "verified");
});
