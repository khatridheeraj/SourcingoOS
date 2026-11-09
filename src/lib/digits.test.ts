import { test } from "node:test";
import assert from "node:assert/strict";
import { latinDigits, wholeText } from "./digits.ts";
import { amountText } from "./payments.ts";
import { qtyText } from "./inquiry-input.ts";
import { qcCount } from "./qc-input.ts";
import { orderProblem } from "./order-input.ts";

test("Indian-language digits read as 0-9", () => {
  assert.equal(latinDigits("१२०"), "120"); // Devanagari
  assert.equal(latinDigits("૩૦૦"), "300"); // Gujarati
  assert.equal(latinDigits("৪৫"), "45"); // Bengali
  assert.equal(latinDigits("੯"), "9"); // Gurmukhi
  assert.equal(latinDigits("௭"), "7"); // Tamil
  assert.equal(latinDigits("൮"), "8"); // Malayalam
  assert.equal(latinDigits("１２"), "12"); // full width
  assert.equal(latinDigits("SO-0012 कुर्ता"), "SO-0012 कुर्ता"); // letters untouched
});

test("number boxes keep Hindi digits instead of dropping them", () => {
  assert.equal(wholeText("६० दिन"), "60");
  assert.equal(amountText("₹ १,२५०.५०"), "1250.50");
  assert.equal(qtyText("१,२०० pcs"), "1200");
  assert.equal(qcCount("१२०"), 120);
  assert.equal(orderProblem({ buyer_id: "b", buyer_po: "P1", po_date: "", ship_date: "" }, [{ style: "K1", qty: "१,२००", buyer_rate: "₹२५०", factory_rate: "" }]), null);
});
