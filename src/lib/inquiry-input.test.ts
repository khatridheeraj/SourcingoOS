// node --experimental-strip-types --test src/lib/inquiry-input.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inquiryProblem, priceText, qtyText } from "./inquiry-input.ts";

const ok = { buyer_id: "b1", prospect: "", product: "Satin co-ord set", est_qty: "", target_price: "", next_follow_up: "" };

test("a filled inquiry passes", () => {
  assert.equal(inquiryProblem(ok), null);
  assert.equal(inquiryProblem({ ...ok, est_qty: "1,200 pcs", target_price: "Rs. 1,250.50", next_follow_up: "2026-11-06" }, { today: "2026-11-05" }), null);
});

test("the message points at the box to fix", () => {
  assert.equal(inquiryProblem({ ...ok, buyer_id: "" })?.field, "buyer_id");
  assert.equal(inquiryProblem({ ...ok, buyer_id: "" }, { newBuyer: true })?.field, "prospect");
  assert.equal(inquiryProblem({ ...ok, product: "  " })?.field, "product");
  assert.equal(inquiryProblem({ ...ok, est_qty: "12.5" })?.field, "est_qty");
  assert.equal(inquiryProblem({ ...ok, est_qty: "0" })?.field, "est_qty");
  assert.equal(inquiryProblem({ ...ok, est_qty: "lots" })?.field, "est_qty");
  assert.equal(inquiryProblem({ ...ok, target_price: "ask" })?.field, "target_price");
  assert.equal(inquiryProblem({ ...ok, target_price: "-250" })?.field, "target_price");
  assert.equal(inquiryProblem({ ...ok, next_follow_up: "5 Nov" })?.field, "next_follow_up");
  assert.equal(inquiryProblem({ ...ok, next_follow_up: "2026-11-04" }, { today: "2026-11-05" })?.field, "next_follow_up");
  // On edit no today is passed: an old follow-up date can stay.
  assert.equal(inquiryProblem({ ...ok, next_follow_up: "2026-11-04" }), null);
});

test("quantity and price read the way people type them", () => {
  assert.equal(qtyText("1,200"), "1200");
  assert.equal(qtyText("1200 pcs"), "1200");
  assert.equal(qtyText("2,000 m"), "2000");
  assert.equal(priceText("Rs. 250"), "250");
  assert.equal(priceText("₹ 1,250.50"), "1250.50");
});
