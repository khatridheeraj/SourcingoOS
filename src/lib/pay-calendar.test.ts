import { test } from "node:test";
import assert from "node:assert/strict";
import { payCalendar, type PayItem } from "./pay-calendar.ts";

const item = (on: string, amount: number, kind: PayItem["kind"] = "bill"): PayItem => ({ on, amount, kind, who: "Kkora", label: "x", key: `${on}${amount}` });

test("payment calendar: overdue apart, days in order, weeks Monday to Sunday, the rest later", () => {
  // 2026-11-27 is a Friday; its week starts Monday 23 Nov.
  const c = payCalendar([item("2026-11-20", 500), item("2026-11-28", 100), item("2026-11-28", 300, "expected"), item("2026-11-30", 50), item("2027-06-01", 9)], "2026-11-27");
  assert.equal(c.overdueTotal, 500);
  assert.deepEqual(c.days.map((d) => [d.on, d.total]), [["2026-11-28", 400], ["2026-11-30", 50]]);
  assert.equal(c.days[0].items[0].amount, 300);
  assert.equal(c.weeks[0].start, "2026-11-23");
  assert.deepEqual([c.weeks[0].bills, c.weeks[0].expected, c.weeks[1].total], [100, 300, 50]);
  assert.deepEqual([c.total, c.expectedTotal, c.later], [450, 300, 9]);
  assert.equal(c.weeks.at(-1)!.start <= "2027-02-25", true);
});
