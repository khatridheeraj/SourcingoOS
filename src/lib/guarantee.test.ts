import { test } from "node:test";
import assert from "node:assert/strict";
import { buyerPlan, claimClock, decisionText, factoryPay, type GOrder } from "./guarantee.ts";

const o: GOrder = {
  order_id: "o", order_no: "SO-0023", buyer_po: "PO-9", po_date: "2026-11-01", status: "open", ship_date: "2026-12-10",
  value: 100000, priced: true, passed_on: null, paid_deposit: 0, paid_balance: 0,
};
const terms = { deposit_pct: 30, pay_days: 15 };

test("the buyer's deposit is due from the PO date and late after a week; the balance waits for the QC pass, late a week after it", () => {
  const a = buyerPlan(o, terms, "2026-11-05");
  assert.deepEqual([a.deposit.amount, a.deposit.state, a.deposit.due, a.balance.amount, a.balance.state], [30000, "due", "2026-11-01", 70000, "waiting"]);
  assert.equal(buyerPlan(o, terms, "2026-11-09").deposit.state, "late");
  const paid = buyerPlan({ ...o, paid_deposit: 29999.5, passed_on: "2026-12-01" }, terms, "2026-12-01");
  assert.deepEqual([paid.deposit.state, paid.balance.state, paid.balance.due], ["paid", "due", "2026-12-01"]);
  assert.equal(buyerPlan({ ...o, passed_on: "2026-12-01" }, terms, "2026-12-08").balance.state, "due");
  assert.equal(buyerPlan({ ...o, passed_on: "2026-12-01" }, terms, "2026-12-09").balance.state, "late");
  const part = buyerPlan({ ...o, paid_balance: 20000, passed_on: "2026-12-01" }, terms, "2026-12-01").balance;
  assert.deepEqual([part.left, part.state], [50000, "due"]);
});

test("no deposit asked: the whole value is the balance", () => {
  const a = buyerPlan(o, { deposit_pct: 0 }, "2026-11-05");
  assert.deepEqual([a.deposit.amount, a.deposit.state, a.balance.amount], [0, "paid", 100000]);
});

test("the factory is paid within the set days of its pass", () => {
  assert.deepEqual(factoryPay({ cost: 50000, passed_on: null, paid: 0 }, terms, "2026-11-20"), { amount: 50000, paid: 0, left: 50000, due: null, state: "waiting" });
  const p = factoryPay({ cost: 50000, passed_on: "2026-11-10", paid: 0 }, terms, "2026-11-20");
  assert.deepEqual([p.due, p.state], ["2026-11-25", "due"]);
  assert.equal(factoryPay({ cost: 50000, passed_on: "2026-11-10", paid: 0 }, terms, "2026-11-26").state, "late");
  assert.equal(factoryPay({ cost: 50000, passed_on: "2026-11-10", paid: 50000 }, terms, "2026-11-26").state, "paid");
});

test("a claim's clock turns amber in its last two days and red once past", () => {
  assert.deepEqual(claimClock({ decide_by: "2026-11-18", decision: null }, "2026-11-11"), { left: 7, tone: "" });
  assert.equal(claimClock({ decide_by: "2026-11-18", decision: null }, "2026-11-16").tone, "warn");
  assert.deepEqual(claimClock({ decide_by: "2026-11-18", decision: null }, "2026-11-19"), { left: -1, tone: "bad" });
  assert.equal(claimClock({ decide_by: "2026-11-18", decision: "remake" }, "2026-11-30").tone, "");
  const m = (n: number) => `₹${n}`;
  assert.equal(decisionText({ decision: "remake", pieces: 40, amount: null }, m), "Agreed: we remake 40 pieces at our cost");
  assert.equal(decisionText({ decision: "refund", pieces: 40, amount: 6000 }, m), "Agreed: ₹6000 refunded to you");
});
