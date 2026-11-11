import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerLine, factoryRecord, recordLine, type RecordFacts } from "./factory-record.ts";

const base: RecordFacts = {
  city: "Jaipur", orders: 18, since: "2026-03-01",
  steps_finished: 40, steps_on_time: 36, steps_overdue: 0,
  final_firsts: 10, final_first_pass: 9, pieces_checked: 1000, defects: 23,
  shipments: 12, shipments_dated: 12, shipments_on_time: 12, pieces_shipped: 41200,
  claims: 0, date_asks: 2, accept_hours: 5, verified: null,
};
const today = "2026-11-12";

test("a factory that delivers is strong; open steps past target count as late", () => {
  const r = factoryRecord(base, today);
  assert.deepEqual([r.onTime, r.firstPass, r.shipOnTime, r.defectRate, r.askRate, r.level], [90, 90, 100, 2.3, 5, "strong"]);
  const late = factoryRecord({ ...base, steps_overdue: 20 }, today);
  assert.equal(late.onTime, 60);
  assert.equal(late.level, "watch");
  assert.deepEqual(late.watch, ["Only 60% of steps on time"]);
});

test("too little history shows no percentage and the factory is new", () => {
  const r = factoryRecord({ ...base, orders: 1, steps_finished: 5, steps_on_time: 5, final_firsts: 2, final_first_pass: 2, shipments_dated: 1, pieces_checked: 40 }, today);
  assert.deepEqual([r.onTime, r.firstPass, r.shipOnTime, r.defectRate, r.level], [null, null, null, null, "new"]);
  assert.equal(recordLine({ ...base, orders: 0 }, r), "No finished work with us yet");
  assert.equal(buyerLine(base, r), null, "nothing to say to the buyer");
});

test("a good record with a claim is steady, two claims put it on watch", () => {
  assert.equal(factoryRecord({ ...base, claims: 1 }, today).level, "steady");
  const two = factoryRecord({ ...base, claims: 2 }, today);
  assert.equal(two.level, "watch");
  assert.deepEqual(two.watch, ["2 claims raised"]);
});

test("a visit lasts a year; certificates run out", () => {
  const r = factoryRecord({ ...base, verified: { visited_on: "2026-10-14", gst_ok: true, udyam_no: "UDYAM-RJ-17-0012345",
    certs: [{ name: "GOTS", until: "2026-12-01" }, { name: "BSCI", until: "2026-11-01" }, { name: "SEDEX", until: null }, { name: "OEKO-TEX", until: "2027-06-01" }] } }, today);
  assert.deepEqual(r.visit, { on: "2026-10-14", current: true, dueOn: "2027-10-14", gst: true, udyam: "UDYAM-RJ-17-0012345" });
  assert.deepEqual(r.certs.map((c) => c.state), ["soon", "expired", "ok", "ok"]);
  const old = factoryRecord({ ...base, verified: { visited_on: "2025-11-01", gst_ok: false, certs: [] } }, today);
  assert.equal(old.visit?.current, false);
});

test("the buyer reads the city and the proof, never more", () => {
  const v = { visited_on: "2026-10-14", gst_ok: true, certs: [] };
  assert.equal(buyerLine({ ...base, verified: v }, factoryRecord({ ...base, verified: v }, today)),
    "Made by a factory verified by Sourcingo in Jaipur · 90% of steps on time · 90% passed final QC first time · 100% shipped by the date across 18 orders");
  const fresh = { ...base, orders: 1, steps_finished: 2, final_firsts: 0, shipments_dated: 0, verified: v };
  assert.equal(buyerLine(fresh, factoryRecord(fresh, today)), "Made by a factory verified by Sourcingo in Jaipur");
  assert.equal(recordLine(base, factoryRecord(base, today)), "90% on time · 90% first-time QC · 18 orders");
  // A weak measure stays inside; a factory with nothing good to show and no visit gets no line at all.
  const slow = { ...base, steps_on_time: 20, verified: v };
  assert.equal(buyerLine(slow, factoryRecord(slow, today)),
    "Made by a factory verified by Sourcingo in Jaipur · 90% passed final QC first time · 100% shipped by the date across 18 orders");
  const weak = { ...base, steps_on_time: 10, final_first_pass: 5, shipments_on_time: 6 };
  assert.equal(buyerLine(weak, factoryRecord(weak, today)), null);
});
