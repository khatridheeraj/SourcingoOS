import { test } from "node:test";
import assert from "node:assert/strict";
import { checkKyc, gstinChecksumOk, stateOfCode } from "./factory-kyc.ts";

test("GSTIN check digit", () => {
  assert.equal(gstinChecksumOk("08ABRCS2561B1Z9"), true);
  assert.equal(gstinChecksumOk("08EPKPB0850L2ZR"), true);
  assert.equal(gstinChecksumOk("24ABQPC1414R1ZI"), true);
  assert.equal(gstinChecksumOk("08ABRCS2561B1Z8"), false);
  assert.equal(gstinChecksumOk("08ABRCS2561B1Z"), false);
});

test("state codes", () => {
  assert.equal(stateOfCode("08"), "Rajasthan");
  assert.equal(stateOfCode("99"), null);
});

test("what was typed is checked, what is empty is fine", () => {
  assert.equal(checkKyc({}), null);
  assert.equal(checkKyc({ gstin: "08abrcs2561b1z9", state: "Rajasthan", pan: "ABRCS2561B" }), null);
  assert.equal(checkKyc({ gstin: "08ABRCS2561B1Z8" })?.field, "gstin");
  assert.match(checkKyc({ gstin: "08ABRCS2561B1Z9", state: "Gujarat" })!.error, /from Rajasthan/);
  assert.match(checkKyc({ gstin: "08ABRCS2561B1Z9", pan: "ABCDE1234F" })!.error, /PAN is ABRCS2561B/);
  assert.equal(checkKyc({ pin: "02202" })?.field, "pin");
  assert.equal(checkKyc({ bank_ifsc: "SBIN1001234" })?.field, "bank_ifsc");
  assert.equal(checkKyc({ bank_ifsc: "SBIN0001234", bank_account: "1234 5678 9012" }), null);
  assert.equal(checkKyc({ phone: "+91 98290 12345", whatsapp: "098290 12345" }), null);
  assert.equal(checkKyc({ phone: "12345" })?.field, "phone");
  assert.equal(checkKyc({ udyam_no: "UDYAM-RJ-17-0081988" }), null);
  assert.equal(checkKyc({ pay_days: "60" }), null);
  assert.equal(checkKyc({ pay_days: "sixty" })?.field, "pay_days");
});
