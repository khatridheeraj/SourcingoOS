// node --experimental-strip-types --test src/lib/help-check.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { qcCheck, type QcCheckInput } from "./help-check.ts";
import { suggestions, TOPICS } from "./help-guide.ts";

const today = "2026-10-29";
const base: QcCheckInput = {
  today, freshDays: 2,
  lines: [{ id: "l1", style: "AV-1", factoryId: "f1" }, { id: "l2", style: "AV-2", factoryId: "f1" }],
  factories: [{ id: "f1", name: "Kkora Fashions", released: true }],
  stages: [
    { lineId: "l1", stage: "stitching", plannedOn: "2026-10-25", doneOn: null },
    { lineId: "l1", stage: "inline", plannedOn: "2026-10-27", doneOn: null },
    { lineId: "l2", stage: "inline", plannedOn: "2026-10-27", doneOn: null },
    { lineId: "l1", stage: "final_qc", plannedOn: "2026-11-10", doneOn: null },
    { lineId: "l2", stage: "final_qc", plannedOn: "2026-11-12", doneOn: null },
  ],
  checks: [{ lineId: "l2", kind: "inline", result: "pass", checkedOn: "2026-10-28" }],
  floor: [],
  pendingUpdates: 0,
};
const text = (i: Partial<QcCheckInput>) => qcCheck({ ...base, ...i }).map((x) => x.text).join("\n");

// The orders team's actions. Quality can't do any of them, so its check never says them.
const NOT_FOR_QUALITY = /Done date|Fill the Done|move the target|Targets are locked|Locked · Ask|Send PO|approv|Start production/i;

test("Quality's check talks about inspections and visits only", () => {
  const t = text({});
  assert.match(t, /Inline is due for AV-1 \(planned 27 Oct\)/);
  assert.match(t, /Inline passed for AV-2/);
  assert.match(t, /Final QC is next on 10 Nov/);
  assert.match(t, /No visit update on this order yet/);
  assert.match(t, /AV-1 Stitching/);
  assert.doesNotMatch(t, NOT_FOR_QUALITY);
});

test("a fresh floor update speaks for a late step", () => {
  const t = text({ floor: [{ lineId: "l1", stage: "stitching", visitedOn: "2026-10-28" }] });
  assert.match(t, /Last visit update 28 Oct/);
  assert.doesNotMatch(t, /no word from the floor/);
});

test("a failed final asks for the re-check", () => {
  const t = text({ checks: [{ lineId: "l1", kind: "final", result: "fail", checkedOn: "2026-10-28" }] });
  assert.match(t, /Final QC failed for AV-1\. Record the re-check/);
});

test("before production starts there is nothing to inspect, and nothing to do for Quality", () => {
  const t = text({ factories: [{ id: "f1", name: "Kkora Fashions", released: false }] });
  assert.match(t, /production hasn't started yet/);
  assert.doesNotMatch(t, NOT_FOR_QUALITY);
});

test("Help suggests nothing to Quality that only the orders team can do", () => {
  for (const path of ["/today", "/", "/orders/00000000-0000-0000-0000-000000000000", "/brief", "/samples"]) {
    const ids = suggestions({ who: "staff", role: "quality" }, path, 50).map((t) => t.id);
    for (const id of ["start-new", "quick-update", "done-locked", "add-buyer", "partner-logins", "new-order", "release-po"]) assert.ok(!ids.includes(id), `${id} on ${path}`);
  }
  assert.equal(suggestions({ who: "staff", role: "quality" }, "/today")[0].id, "home-qc");
  assert.equal(suggestions({ who: "staff", role: "merchandiser" }, "/today")[0].id, "home");
});

test("every topic Quality can see stays clear of the orders team's buttons", () => {
  const ORDERS_ONLY = /Send (the )?PO for approval|Start production|Tap \+ New|Add buyer|Fill every target/;
  for (const t of TOPICS.filter((x) => x.who === "staff" && (!x.roles || x.roles.includes("quality")))) {
    assert.doesNotMatch(t.a.join(" "), ORDERS_ONLY, t.id);
  }
});
