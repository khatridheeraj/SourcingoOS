import { test } from "node:test";
import assert from "node:assert/strict";
import { amountText, buyerStatement, makeBooks } from "./payments.ts";

test("an amount keeps only its digits and one decimal point", () => {
  assert.equal(amountText("1250.50"), "1250.50");
  assert.equal(amountText("1,25,000"), "125000");
  assert.equal(amountText("₹ 1,250"), "1250");
  assert.equal(amountText("0.5"), "0.5");
  assert.equal(amountText("1.2.3"), "1.23");
  assert.equal(amountText("12."), "12.");
});

test("a pasted Rs. or INR prefix is not a decimal point", () => {
  assert.equal(amountText("Rs. 1,250.50"), "1250.50");
  assert.equal(amountText("Rs.1250"), "1250");
  assert.equal(amountText("INR. 500/-"), "500");
  assert.equal(amountText("Rs."), "");
  assert.equal(amountText("."), "");
});

test("a buyer statement lists what is left on each invoice, oldest first, and how late", () => {
  const inv = (id: string, no: string, date: string, amount: number, over: object = {}) =>
    ({ id, invoice_no: no, buyer_id: "B", invoice_date: date, amount, due_date: null, order_id: null, notes: null, cancelled_at: null, ...over });
  const books = makeBooks({
    invoices: [inv("1", "INV-2", "2026-09-20", 50000), inv("2", "INV-1", "2026-08-01", 30000), inv("3", "INV-3", "2026-10-01", 10000, { cancelled_at: "x" }),
      inv("4", "INV-4", "2026-10-05", 20000), { ...inv("5", "X-1", "2026-10-01", 5000), buyer_id: "C" }],
    creditNotes: [{ id: "c", credit_note_no: "CN-1", invoice_id: "1", note_date: "2026-10-01", amount: 5000, notes: null, cancelled_at: null }],
    cheques: [
      { id: "q1", buyer_id: "B", cheque_no: "111", bank: null, cheque_date: "2026-10-10", amount: 20000, status: "cleared", received_on: null, deposited_on: null, cleared_on: "2026-10-12", bounced_on: null, notes: null },
      { id: "q2", buyer_id: "B", cheque_no: "222", bank: null, cheque_date: "2026-11-15", amount: 10000, status: "in_hand", received_on: null, deposited_on: null, cleared_on: null, bounced_on: null, notes: null },
    ],
    allocations: [{ id: "a1", cheque_id: "q1", invoice_id: "4", amount: 20000 }, { id: "a2", cheque_id: "q2", invoice_id: "2", amount: 10000 }],
    buyers: [{ id: "B", code: "B", realName: "Buyer", credit_days: 45 }],
    today: "2026-11-10",
  });
  const s = buyerStatement(books, "B", "2026-11-10");
  assert.deepEqual(s.open.map((i) => [i.invoice_no, i.outstanding, i.late]), [["INV-1", 30000, 56], ["INV-2", 45000, 6]]);
  assert.equal(s.total, 75000);
  assert.equal(s.overdue, 75000);
  assert.deepEqual(s.paid.map((i) => i.invoice_no), ["INV-4"]);
  assert.equal(s.heldTotal, 10000);
});
