// node --experimental-strip-types --test src/lib/order-input.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderProblem } from "./order-input.ts";

const head = { buyer_id: "b1", buyer_po: "PO-1", po_date: "2026-11-01", ship_date: "2026-12-01" };
const line = (style: string, qty: string, buyer_rate = "", factory_rate = "") => ({ style, qty, buyer_rate, factory_rate });

test("a complete order passes", () => {
  assert.equal(orderProblem(head, [line("AV-1", "500", "350")]), null);
  assert.equal(orderProblem(head, [line("AV-1", "1,200", "₹ 350")]), null);
});

test("each head field is named, so the form can mark and focus it", () => {
  assert.equal(orderProblem({ ...head, buyer_id: "" }, [line("A", "1")])?.field, "buyer_id");
  assert.equal(orderProblem({ ...head, buyer_po: "  " }, [line("A", "1")])?.field, "buyer_po");
  assert.equal(orderProblem({ ...head, ship_date: "2026-10-01" }, [line("A", "1")])?.field, "ship_date");
  assert.equal(orderProblem({ ...head, buyer_terms: "x".repeat(2001) }, [line("A", "1")])?.field, "buyer_terms");
  assert.equal(orderProblem(head, [line("", "")])?.field, "line-0-style");
});

test("a line's number is the row on screen, blank rows above it included", () => {
  const p = orderProblem(head, [line("", ""), line("AV-2", "12.5")]);
  assert.deepEqual(p, { field: "line-1-qty", msg: "Line 2: quantity must be a whole number above zero." });
  assert.deepEqual(orderProblem(head, [line("A", "5"), line("", "20")]), { field: "line-1-style", msg: "Line 2: enter the style number." });
  assert.equal(orderProblem(head, [line("A", "5", "abc")])?.field, "line-0-buyer_rate");
  assert.equal(orderProblem(head, [line("A", "5", "", "-3")])?.field, "line-0-factory_rate");
});
