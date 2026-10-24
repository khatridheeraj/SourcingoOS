// node --experimental-strip-types --test src/lib/po-match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePo, fileNamesStyle, poNoKey, styleKey } from "./po-match.ts";

test("styles match whatever the spacing, dashes or case", () => {
  assert.equal(styleKey("AV-135"), styleKey("av 135"));
  assert.equal(styleKey("AV-135"), styleKey("AV135"));
  assert.equal(poNoKey("  101 "), poNoKey("101"));
});

test("the same PO number with a different style is another PO, not the order already entered", () => {
  // Flavia PO 101 for AV-135, while order SO-0013 holds PO 101 for AV-141 (24 Oct 2026).
  const c = comparePo(["AV-135"], ["AV-141"]);
  assert.equal(c.verdict, "different");
  assert.deepEqual(c.shared, []);
  assert.deepEqual(c.onlyPo, ["AV-135"]);
  assert.deepEqual(c.onlyOrder, ["AV-141"]);
});

test("one style in common makes it the same PO (a revision or a resend)", () => {
  const c = comparePo(["AV135", "AV-200"], ["av-135"]);
  assert.equal(c.verdict, "same");
  assert.deepEqual(c.shared, ["AV135"]);
  assert.deepEqual(c.onlyPo, ["AV-200"]);
});

test("with no styles read, nobody can tell without looking", () => {
  assert.equal(comparePo([], ["AV-141"]).verdict, "unknown");
  assert.equal(comparePo(["  "], ["AV-141"]).verdict, "unknown");
  assert.equal(comparePo(["AV-141"], []).verdict, "unknown");
});

test("a file name names a style only as a whole word", () => {
  const f = "PO CHAVI PRODUCTION - AV135 (2).pdf";
  assert.equal(fileNamesStyle(f, "AV-135"), true);
  assert.equal(fileNamesStyle(f, "AV-141"), false);
  assert.equal(fileNamesStyle(f, "AV-13"), false);
  assert.equal(fileNamesStyle("PO CHAVI PRODUCTION - AV1350.pdf", "AV-135"), false);
  assert.equal(fileNamesStyle("PO CHAVI PRODUCTION - av135.pdf", "AV-135"), true);
  assert.equal(fileNamesStyle("PO_AV-135_final.pdf", "AV 135"), true);
  assert.equal(fileNamesStyle("Purchase_Order_KFT-PO-2026-0088.pdf", "PO"), false);
});
