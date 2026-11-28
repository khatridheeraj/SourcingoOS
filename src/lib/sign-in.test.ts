// node --experimental-strip-types --test src/lib/sign-in.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { likelyTypo, refusal, RESEND_WAIT } from "./sign-in.ts";

test("a refused sign-in link never tells anyone to wait an hour", () => {
  const busy = refusal("email rate limit exceeded");
  assert.equal(busy.wait, RESEND_WAIT);
  assert.doesNotMatch(busy.text, /hour/i);
  assert.match(busy.text, /this device/);
  const soon = refusal("For security purposes, you can only request this after 42 seconds.");
  assert.equal(soon.wait, 42);
  assert.equal(refusal("Signups not allowed for otp").wait, 0);
  assert.match(refusal("Failed to fetch").text, /internet/);
});

test("near misses of our own address are caught before a link goes nowhere", () => {
  assert.equal(likelyTypo("asstmerchandiser@sourcingo.com"), "asstmerchandiser@sourcingo.in");
  assert.equal(likelyTypo("qc@sourcing.in"), "qc@sourcingo.in");
  assert.equal(likelyTypo("qc@sorucingo.in"), "qc@sourcingo.in");
  assert.equal(likelyTypo(" QC@Sourcingo.co.in "), "qc@sourcingo.in");
  assert.equal(likelyTypo("qc@sourcingo.in"), null);
  assert.equal(likelyTypo("pranay5570@gmail.com"), null);
  assert.equal(likelyTypo("buyer@outsourcing.com"), null);
  assert.equal(likelyTypo("not an email"), null);
});
