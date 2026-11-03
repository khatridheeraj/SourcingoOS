import { test } from "node:test";
import assert from "node:assert/strict";
import { amountText } from "./payments.ts";

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
