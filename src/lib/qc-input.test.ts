// node --experimental-strip-types --test src/lib/qc-input.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { qcCount, qcCountsProblem } from "./qc-input.ts";

test("counts read the way Quality types them", () => {
  assert.equal(qcCount(""), null);
  assert.equal(qcCount("  "), null);
  assert.equal(qcCount("120"), 120);
  assert.equal(qcCount("1,200"), 1200);
  assert.equal(qcCount("120 pcs"), 120);
  assert.equal(qcCount(" 80 pieces "), 80);
  assert.ok(Number.isNaN(qcCount("12.5")));
  assert.ok(Number.isNaN(qcCount("-3")));
  assert.ok(Number.isNaN(qcCount("lots")));
});

test("blank boxes and sensible counts pass", () => {
  assert.equal(qcCountsProblem("", ""), null);
  assert.equal(qcCountsProblem("120 pcs", "3"), null);
  assert.equal(qcCountsProblem("", "2"), null);
  assert.equal(qcCountsProblem("10", "10"), null);
});

test("the message points at the box to fix", () => {
  assert.equal(qcCountsProblem("0", "")?.field, "pieces");
  assert.equal(qcCountsProblem("12.5", "")?.field, "pieces");
  assert.equal(qcCountsProblem("all", "")?.field, "pieces");
  assert.equal(qcCountsProblem("9999999999", "")?.field, "pieces");
  assert.equal(qcCountsProblem("120", "a few")?.field, "defects");
  assert.equal(qcCountsProblem("120", "-1")?.field, "defects");
  assert.equal(qcCountsProblem("10", "12")?.field, "defects");
  assert.match(qcCountsProblem("10", "12")!.error, /12.*10/);
});
