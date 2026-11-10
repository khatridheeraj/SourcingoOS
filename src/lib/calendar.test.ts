import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar } from "./calendar.ts";

const o = { id: "o1", code: "SO-0012", title: "Flavia · PO 101", due: "2026-11-12", pieces: "500 pcs" };

test("groups each day's steps per order and kind, and keeps only the days asked for", () => {
  const days = buildCalendar({
    today: "2026-11-10", days: 7, orders: [o],
    steps: [
      { order_id: "o1", line_id: "a", stage: "final_qc", label: "Final QC", planned_on: "2026-11-11", factory: "Kkora" },
      { order_id: "o1", line_id: "b", stage: "final_qc", label: "Final QC", planned_on: "2026-11-11", factory: "Kkora" },
      { order_id: "o1", line_id: "a", stage: "cutting", label: "Cutting", planned_on: "2026-11-11", factory: "Kkora" },
      { order_id: "o1", line_id: "a", stage: "stitching", label: "Stitching", planned_on: "2026-11-30", factory: "Kkora" },
      { order_id: "o1", line_id: "a", stage: "packed", label: "Packed", planned_on: "2026-11-09", factory: "Kkora" },
    ],
    plans: [], bills: [], cheques: [{ id: "c", buyer: "Ozia", cheque_no: "349915", on: "2026-11-01", amount: "₹1.2 L" }],
  });
  assert.equal(days.length, 7);
  assert.deepEqual(days[0].items.map((i) => i.kind), ["cheque"]);
  const d11 = days[1].items;
  assert.deepEqual(d11.map((i) => i.kind), ["qc", "steps"]);
  assert.equal(d11[0].detail, "2 styles at Kkora");
  assert.equal(d11[1].detail, "Cutting · 1 style at Kkora");
  assert.equal(days[2].items[0].kind, "ship");
  assert.equal(days.flatMap((d) => d.items).length, 4);
});
