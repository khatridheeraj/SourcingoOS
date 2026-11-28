import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStage, trackLink, trackState, trackSteps, type Tracking } from "./tracking.ts";

const t: Tracking = { mode: "sea", carrier: "Maersk", track_no: "MSKU 123", to: "Hamburg", eta: "2026-12-20", delivered_on: null, shipped_on: "2026-11-20",
  events: [{ stage: "departed", on: "2026-11-24", place: null, note: "Vessel X" }] };

test("sea stages: left us on the ship day; sailing marks the port done; next is arrival", () => {
  const s = trackSteps(t);
  assert.deepEqual(s.map((x) => x.done), [true, true, true, false, false, false, false]);
  assert.equal(s[0].on, "2026-11-20");
  assert.equal(s.find((x) => x.current)!.label, "Sailed");
  assert.equal(nextStage(t), "arrived");
});

test("road has no ports; delivered is green; past the ETA or quiet for 10 days is amber", () => {
  assert.equal(trackSteps({ ...t, mode: "road", events: [] }).length, 4);
  assert.deepEqual(trackState({ ...t, delivered_on: "2026-12-18" }, "2026-12-19"), { text: "Delivered", tone: "ok" });
  assert.equal(trackState(t, "2026-12-21").tone, "warn");
  assert.equal(trackState(t, "2026-12-04").text, "Sailed · no update for 10 days");
  assert.equal(trackState(t, "2026-11-30").tone, "");
});

test("carrier links only for known carriers, spaces taken out", () => {
  assert.equal(trackLink("Maersk Line", "MSKU 123"), "https://www.maersk.com/tracking/MSKU123");
  assert.equal(trackLink("Local Transport Co", "LR1"), null);
  assert.equal(trackLink("DHL Express", null), null);
});
