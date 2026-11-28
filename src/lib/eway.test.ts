import { test } from "node:test";
import assert from "node:assert/strict";
import { EWAY_DEFAULTS, ewayNeeded, ewayRules, ewayWhy } from "./eway.ts";

test("e-way bill only above the limit for where the goods go", () => {
  const r = EWAY_DEFAULTS;
  assert.equal(ewayNeeded(23940, null, r), false); // SPL/206
  assert.equal(ewayNeeded(50000, "other_state", r), false); // not MORE than 50,000
  assert.equal(ewayNeeded(50001, "other_state", r), true);
  assert.equal(ewayNeeded(90000, "in_state", r), false);
  assert.equal(ewayNeeded(150000, "in_state", r), true);
  assert.equal(ewayNeeded(150000, "same_city", r), false);
  assert.equal(ewayNeeded(250000, "same_city", r), true);
});

test("limits read from the company, with the legal defaults when missing", () => {
  assert.deepEqual(ewayRules(null), EWAY_DEFAULTS);
  assert.equal(ewayRules({ inter_state: "75000" }).inter_state, 75000);
  assert.equal(ewayWhy(60000, null, EWAY_DEFAULTS), "Needed: Rs 60,000 with GST is above the Rs 50,000 limit for another state.");
  assert.equal(ewayWhy(60000, "in_state", EWAY_DEFAULTS), "Not required: Rs 60,000 with GST is not above the Rs 1,00,000 limit for goods staying in Rajasthan.");
});
