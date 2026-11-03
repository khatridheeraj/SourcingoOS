// node --experimental-strip-types --test src/lib/ship-qc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shipQcNote } from "./ship-qc.ts";

const pnk = { style: "MTP013PNK", latest: { result: "pass", on: "2026-10-26" } };

test("a Fail dated after the Pass says shipping will go by it", () => {
  const n = shipQcNote([pnk], "final", "fail", "2026-10-31");
  assert.match(n, /^Shipping will go by this Fail for MTP013PNK, not the Pass of 26 Oct 2026\./);
  assert.match(n, /Set the day it was done/);
});

test("the same date counts as later, as in the database", () => {
  assert.match(shipQcNote([pnk], "recheck", "fail", "2026-10-26"), /^Shipping will go by this Fail/);
});

test("a Fail dated before the Pass leaves the Pass in charge", () => {
  assert.equal(shipQcNote([pnk], "final", "fail", "2026-10-20"), "The Pass of 26 Oct 2026 on MTP013PNK is later, so shipping still goes by it.");
});

test("nothing to say when the result doesn't change, there's no earlier check, or it isn't a shipping check", () => {
  assert.equal(shipQcNote([pnk], "final", "pass", "2026-10-31"), "");
  assert.equal(shipQcNote([{ style: "X" }], "final", "fail", "2026-10-31"), "");
  assert.equal(shipQcNote([pnk], "inline", "fail", "2026-10-31"), "");
  assert.equal(shipQcNote([pnk], "final", "", "2026-10-31"), "");
});

test("several styles are counted", () => {
  const pur = { style: "MTP013PUR", latest: { result: "pass", on: "2026-10-26" } };
  assert.match(shipQcNote([pnk, pur], "final", "fail", "2026-10-31"), /for 2 styles/);
});

test("a Pass after a Fail is the normal re-check and says nothing; a Pass dated before a later Fail does", () => {
  const failed = { style: "MTP013PNK", latest: { result: "fail", on: "2026-10-31" } };
  assert.equal(shipQcNote([failed], "recheck", "pass", "2026-11-03"), "");
  assert.equal(shipQcNote([failed], "recheck", "pass", "2026-10-26"), "The Fail of 31 Oct 2026 on MTP013PNK is later, so shipping still goes by it.");
});
