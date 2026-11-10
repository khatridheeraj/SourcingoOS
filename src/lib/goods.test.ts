// node --experimental-strip-types --test src/lib/goods.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { belowCost } from "./goods.ts";

test("an invoice below the factory bill says by how much", () => {
  assert.equal(belowCost("30875.00", "22800.00"), 8075);
  assert.equal(belowCost(30875, 32500), 0);
  assert.equal(belowCost(1000, 999.5), 0); // paise of rounding are not a loss
  assert.equal(belowCost(1000, null), 0);
  assert.equal(belowCost(null, 500), 0);
});
