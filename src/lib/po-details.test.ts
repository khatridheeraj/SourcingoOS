import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPoDetails, checkPoMail, emailList, mobileOk } from "./po-details.ts";

const blank = { gstin: "", email: "", phone: "" };

test("addresses are read the way people paste them", () => {
  assert.deepEqual(emailList("a@x.com, b@y.com"), { emails: ["a@x.com", "b@y.com"], bad: null });
  assert.deepEqual(emailList("a@x.com; b@y.com;"), { emails: ["a@x.com", "b@y.com"], bad: null });
  assert.deepEqual(emailList("a@x.com,"), { emails: ["a@x.com"], bad: null });
  assert.deepEqual(emailList("Ramesh Kumar <Ramesh@Factory.com>, a@x.com\nb@y.com"), { emails: ["ramesh@factory.com", "a@x.com", "b@y.com"], bad: null });
  assert.deepEqual(emailList("a@x.com, ramesh"), { emails: ["a@x.com"], bad: "ramesh" });
});

test("a mobile is 10 digits, with or without +91, 0, spaces or Hindi digits", () => {
  for (const ok of ["", "9829012345", "+91 98290-12345", "098290 12345", "0091 98290 12345", "९८२९०१२३४५"]) assert.equal(mobileOk(ok), true, ok);
  for (const bad of ["12345", "abc", "98290 12345 / 98290 54321", "call Ramesh"]) assert.equal(mobileOk(bad), false, bad);
});

test("each wrong box on the PO details is named, before anything is saved", () => {
  assert.equal(checkPoDetails({ ...blank, gstin: "08 ABCDE 1234F 1Z5" }), null);
  assert.equal(checkPoDetails({ ...blank, gstin: "08ABCDE" })?.field, "factory.gstin");
  assert.equal(checkPoDetails({ ...blank, phone: "12345" })?.field, "factory.phone");
  assert.equal(checkPoDetails({ ...blank, email: "orders factory" })?.field, "factory.email");
  assert.equal(checkPoDetails(blank, { ...blank, gstin: "SOURCINGO" })?.field, "company.gstin");
  assert.equal(checkPoDetails(blank, { ...blank, phone: "office" })?.field, "company.phone");
});

test("the PO email takes one address to send to and a pasted CC list", () => {
  assert.deepEqual(checkPoMail("Ramesh <r@f.com>", "a@x.com; b@y.com,"), { to: "r@f.com", cc: "a@x.com, b@y.com" });
  assert.deepEqual(checkPoMail("r@f.com", "r@f.com, a@x.com"), { to: "r@f.com", cc: "a@x.com" });
  assert.equal((checkPoMail("", "") as { field: string }).field, "to");
  assert.match((checkPoMail("r@f.com, s@f.com", "") as { error: string }).error, /one address/);
  assert.match((checkPoMail("ramesh", "") as { error: string }).error, /doesn't look right/);
  assert.equal((checkPoMail("r@f.com", "a@x.com, vidhi") as { field: string }).field, "cc");
});
