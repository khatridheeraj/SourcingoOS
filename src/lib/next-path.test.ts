// node --experimental-strip-types --test src/lib/next-path.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./next-path.ts";

test("after sign-in: back to the page they opened, never off the app", () => {
  assert.equal(safeNext("/orders/abc?tab=plan"), "/orders/abc?tab=plan");
  assert.equal(safeNext(null), "/today");
  assert.equal(safeNext("/"), "/today");
  assert.equal(safeNext("//evil.com"), "/today");
  assert.equal(safeNext("/\\evil.com"), "/today");
  assert.equal(safeNext("https://evil.com"), "/today");
  assert.equal(safeNext("/login?next=/x"), "/today");
  assert.equal(safeNext("/auth/confirm"), "/today");
});
