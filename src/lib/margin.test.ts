import { test } from "node:test";
import assert from "node:assert/strict";
import { marginBy, orderMargin, type MarginRow } from "./margin.ts";

const row: MarginRow = {
  id: "o", order_no: "SO-1", buyer_po: "P", buyer_id: "b", status: "open", ship_date: "2026-12-10", shipped_on: null, missing: 0, refunds: 1000, recovered: 0,
  factories: [
    { factory_id: "k", name: "Kkora", sale: 100000, cost: 60000, billed_sale: 58000, billed_cost: 36000 },
    { factory_id: "s", name: "Shreeji", sale: 30000, cost: 18000, billed_sale: 0, billed_cost: 0 },
  ],
};

test("open order: billed factories from their bills, the rest from the plan, less refunds", () => {
  const m = orderMargin(row);
  assert.deepEqual([m.plan.margin, m.sale, m.cost, m.margin], [52000, 88000, 54000, 33000]);
  assert.equal(Math.round(m.pct! * 10) / 10, 37.5);
});

test("shipped order: only what was billed; a claim passed to the factory adds back", () => {
  const m = orderMargin({ ...row, status: "shipped", refunds: 0, recovered: 500 });
  assert.deepEqual([m.sale, m.cost, m.margin], [58000, 36000, 22500]);
});

test("no bills yet: the plan", () => {
  const m = orderMargin({ ...row, refunds: 0, factories: row.factories.map((f) => ({ ...f, billed_sale: 0, billed_cost: 0 })) });
  assert.deepEqual([m.billed, m.margin, m.slip], [null, 52000, null]);
});

test("by buyer and by factory", () => {
  const ms = [orderMargin(row)];
  assert.equal(marginBy(ms, "buyer", () => "Areeba")[0].margin, 33000);
  assert.deepEqual(marginBy(ms, "factory", () => "").map((g) => [g.name, g.margin]), [["Kkora", 22000], ["Shreeji", 12000]]);
});
