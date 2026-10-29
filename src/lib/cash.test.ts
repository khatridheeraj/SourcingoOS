import { test } from "node:test";
import assert from "node:assert/strict";
import { carryDays, cashAhead, monday, orderCash } from "./cash.ts";

const TODAY = "2026-10-28"; // a Wednesday

test("weeks start on Monday", () => {
  assert.equal(monday(TODAY), "2026-10-26");
  assert.equal(monday("2026-10-26"), "2026-10-26");
  assert.equal(monday("2026-11-01"), "2026-10-26");
});

test("an open order brings money in after the buyer's days and sends it out after the factory's", () => {
  const o = { id: "o", orderNo: "SO-1", buyer: "Areeba", sale: 100000, cost: 80000, ships: "2026-11-10", buyerDays: 90, factoryDays: 60 };
  const [inn, out] = orderCash(o);
  assert.deepEqual([inn.amount, inn.on], [100000, "2027-02-08"]);
  assert.deepEqual([out.amount, out.on], [-80000, "2027-01-09"]);
  assert.equal(carryDays(o), 30);
});

test("overdue money is kept apart, later money is summed past the last week, and the running balance finds the squeeze", () => {
  const c = cashAhead({
    today: TODAY, weeks: 4,
    invoices: [{ amount: 50000, due: "2026-10-01", label: "INV-1" }, { amount: 30000, due: "2026-11-12", label: "INV-2" }, { amount: 9000, due: "2027-03-01", label: "INV-3" }],
    bills: [{ amount: 70000, due: "2026-11-02", label: "Kkora bill" }, { amount: 20000, due: "2026-10-20", label: "old bill" }],
    orders: [],
  });
  assert.equal(c.overdueIn, 50000);
  assert.equal(c.overdueOut, 20000);
  assert.deepEqual(c.weeks.map((w) => w.start), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  assert.deepEqual(c.weeks.map((w) => w.net), [0, -70000, 30000, 0]);
  assert.deepEqual(c.weeks.map((w) => w.balance), [0, -70000, -40000, -40000]);
  assert.equal(c.lowest?.start, "2026-11-02");
  assert.deepEqual(c.later, { in: 9000, out: 0 });
});

test("nothing owed either way is left out", () => {
  const c = cashAhead({ today: TODAY, invoices: [{ amount: 0, due: "2026-11-01", label: "paid" }], bills: [], orders: [] });
  assert.equal(c.weeks.every((w) => w.items.length === 0), true);
  assert.equal(c.lowest, null);
});
