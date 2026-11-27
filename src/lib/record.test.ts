import { test } from "node:test";
import assert from "node:assert/strict";
import { kitStats, recordGaps, recordLine, recordStats, type RecordCounts } from "./record.ts";

const base: RecordCounts = {
  since: "2026-04-09", orders: 20, orders_shipped: 2, buyers: 7, styles: 58, pieces_ordered: 18205, metres_ordered: 0,
  factories_used: 8, factories_verified: 0, shipments: 7, shipments_dated: 7, shipments_on_time: 6,
  pieces_shipped: 5272, metres_shipped: 0, steps_finished: 300, steps_on_time: 240, steps_overdue: 20,
  qc_checks: 59, qc_inline: 10, final_firsts: 30, final_first_pass: 27, pieces_checked: 2400, defects: 60,
  public: false, as_of: "2026-11-28T00:00:00Z",
};

test("shows every rate when the base is big enough", () => {
  const s = recordStats(base);
  const by = Object.fromEntries(s.map((x) => [x.key, x.value]));
  assert.equal(by.shipped, "5,272");
  assert.equal(by.steps, "75%"); // 240 of 300 + 20 overdue
  assert.equal(by.firstpass, "90%");
  assert.equal(by.ontime, "86%");
  assert.equal(by.defects, "2.5");
  assert.equal(by.factories, "8");
  assert.match(s.find((x) => x.key === "orders")!.note, /since April 2026/);
});

test("leaves out rates drawn from too few cases, and says why on the team page", () => {
  const c = { ...base, shipments_dated: 2, final_firsts: 1, steps_finished: 10, steps_overdue: 0, pieces_checked: 160 };
  const keys = recordStats(c).map((x) => x.key);
  assert.ok(!keys.includes("ontime") && !keys.includes("firstpass") && !keys.includes("steps") && !keys.includes("defects"));
  assert.equal(recordGaps(c).length, 5);
});

test("nothing shipped yet means no shipped number, never a zero", () => {
  const s = recordStats({ ...base, pieces_shipped: 0, shipments: 0 });
  assert.ok(!s.some((x) => x.key === "shipped"));
});

test("verified factories replace the plain count once a visit is recorded", () => {
  const f = recordStats({ ...base, factories_verified: 3 }).find((x) => x.key === "factories")!;
  assert.equal(f.value, "3");
  assert.match(f.label, /verified/);
});

test("one line for a message leads with the strongest three", () => {
  assert.equal(recordLine(base), "5,272 pieces shipped · 75% production steps on time · 90% passed final QC first time");
});

test("a true but weak rate stays on the team page and out of the kit", () => {
  const c = { ...base, steps_on_time: 40 };
  assert.ok(recordStats(c).find((x) => x.key === "steps")!.held);
  assert.ok(!kitStats(c).some((x) => x.key === "steps"));
  assert.ok(kitStats(base).some((x) => x.key === "steps"));
});
