import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtCurrency, inCurrency, isCurrency, totalIn } from "./currency.ts";

test("rupees at a locked rate, to the cent; nothing without a rate", () => {
  assert.equal(inCurrency(87500, 87.5), 1000);
  assert.equal(inCurrency(100, 3), 33.33);
  assert.equal(inCurrency(100, null), null);
  assert.equal(inCurrency(100, 0), null);
});

test("totals only when every invoice has a rate", () => {
  assert.equal(totalIn([{ rupees: 87500, rate: 87.5 }, { rupees: 8750, rate: "87.5" }]), 1100);
  assert.equal(totalIn([{ rupees: 87500, rate: 87.5 }, { rupees: 1, rate: null }]), null);
});

test("formats the way buyers read money", () => {
  assert.equal(fmtCurrency(1234.5, "USD"), "$1,234.50");
  assert.equal(fmtCurrency(1000, "JPY"), "¥1,000");
  assert.equal(isCurrency("EUR") && !isCurrency("XYZ"), true);
});
