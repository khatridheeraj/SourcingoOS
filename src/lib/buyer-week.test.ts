import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerWeek, sinceOf, weekOf, weekText, type WeekOrder } from "./buyer-week.ts";

const names = { cutting: "Cutting", stitching: "Stitching", finishing: "Finishing", final_qc: "Final QC" };
const today = "2026-11-30"; // a Monday

const order = (o: Partial<WeekOrder> = {}): WeekOrder => ({
  id: "o1", order_no: "SO-0012", buyer_po: "4512", status: "open", ship_date: "2026-12-20", revised_ship_date: null,
  lines: [
    { id: "l1", style: "AV-142", colour: null, qty: 300, steps: [
      { stage: "cutting", label: null, planned_on: "2026-11-20", done_on: "2026-11-25" },
      { stage: "stitching", label: null, planned_on: "2026-11-28", done_on: "2026-11-29" },
      { stage: "finishing", label: null, planned_on: "2026-12-04", done_on: null },
    ], final_qc: null },
    { id: "l2", style: "AV-141", colour: "Blue", qty: 200, steps: [
      { stage: "cutting", label: null, planned_on: "2026-11-10", done_on: "2026-11-12" },
      { stage: "stitching", label: null, planned_on: "2026-11-20", done_on: null },
    ], final_qc: null },
  ],
  ...o,
});

test("the week starts on Monday and counts from the last update", () => {
  assert.equal(weekOf("2026-11-30"), "2026-11-30");
  assert.equal(weekOf("2026-12-06"), "2026-11-30");
  assert.equal(weekOf("2026-12-02"), "2026-11-30");
  assert.equal(sinceOf(today, null), "2026-11-23");
  assert.equal(sinceOf(today, "2026-11-24"), "2026-11-25");
  assert.equal(sinceOf(today, "2026-11-01"), "2026-11-23");
  assert.equal(sinceOf(today, today), today);
});

test("only what moved in the window, in the buyer's words", () => {
  const w = buyerWeek({ orders: [order()], shipments: [], photos: [], invoices: [], names, today, since: "2026-11-24" });
  assert.equal(w.empty, false);
  const o = w.orders[0];
  assert.deepEqual(o.done.map((d) => `${d.step} ${d.style}`), ["Cutting AV-142", "Stitching AV-142"]);
  assert.equal(o.daysLeft, 20);
  assert.equal(o.pct, 60);
  // AV-141's stitching target passed: never called late, and not "next" either.
  assert.deepEqual(o.next, [{ style: "AV-142", step: "Finishing", by: "2026-12-04" }]);
  assert.equal(w.headline, "Since 24 Nov: 2 steps done.");
});

test("QC, photos, shipments and money each count once", () => {
  const o = order();
  o.lines[0].final_qc = { result: "pass", checked_on: "2026-11-28", pieces_checked: 80 };
  o.lines[1].final_qc = { result: "fail", checked_on: "2026-11-29", pieces_checked: 50 };
  const w = buyerWeek({
    orders: [o, order({ id: "o2", order_no: "SO-0013", buyer_po: null, status: "shipped", lines: [] }), order({ id: "o3", status: "shipped" })],
    shipments: [{ order_id: "o2", shipped_on: "2026-11-27", pieces: 600, cartons: 12, received_on: null }, { order_id: "o3", shipped_on: "2026-11-01", pieces: 10, cartons: null, received_on: null }],
    photos: [{ order_id: "o1", line_id: "l1", stage: "stitching", done_on: "2026-11-29", photos: ["a.jpg", "b.jpg"] }],
    invoices: [{ invoice_no: "S/1", due: "2026-12-05", left: 120000, po: "4512" }, { invoice_no: "S/0", due: "2026-11-01", left: 0, po: null }],
    names, today, since: "2026-11-24",
  });
  // The order that shipped weeks ago stays out.
  assert.deepEqual(w.orders.map((x) => x.id), ["o1", "o2"]);
  assert.deepEqual(w.counts, { steps: 2, photos: 2, passed: 1, reworked: 1, shipments: 1 });
  assert.equal(w.money.dueSoon, 120000);
  assert.equal(w.money.pastDue, 0);
  assert.equal(w.headline, "Since 24 Nov: 2 steps done, 2 new photos checked by Sourcingo, 1 style passed final QC and 1 shipment sent.");
  const t = weekText(w, "Flavia", "https://x/s/abc");
  assert.match(t, /Hello Flavia,/);
  assert.match(t, /\*PO 4512\* \(SO-0012\) · ships 20 Dec, in 20 days · 60% done/);
  assert.match(t, /Final QC passed: AV-142, 80 pcs checked/);
  assert.match(t, /AV-141 Blue is being reworked/);
  assert.match(t, /\*PO SO-0013\* \(SO-0013\) · shipped/);
  assert.match(t, /Sent 27 Nov: 600 pcs, 12 cartons/);
  assert.match(t, /₹1,20,000 falls due from 5 Dec/);
  assert.match(t, /https:\/\/x\/s\/abc/);
});

test("a quiet week says so honestly, and no orders means nothing to send", () => {
  const w = buyerWeek({ orders: [order()], shipments: [], photos: [], invoices: [], names, today, since: today });
  assert.equal(w.headline, "Since 30 Nov: production carries on, with nothing new to show yet.");
  assert.match(weekText(w, "B"), /Next: Finishing by 4 Dec/);
  const bare = buyerWeek({ orders: [order({ lines: [] })], shipments: [], photos: [], invoices: [], names, today, since: today });
  assert.match(weekText(bare, "B"), /nothing new to show this week/);
  assert.equal(buyerWeek({ orders: [order({ status: "cancelled" })], shipments: [], photos: [], invoices: [], names, today, since: today }).empty, true);
});
