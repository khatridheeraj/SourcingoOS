import { test } from "node:test";
import assert from "node:assert/strict";
import { waNumber } from "./whatsapp.ts";

test("a phone number is read the way people save it in India", () => {
  assert.equal(waNumber("9829012345"), "919829012345");
  assert.equal(waNumber("98290 12345"), "919829012345");
  assert.equal(waNumber("098290 12345"), "919829012345");
  assert.equal(waNumber("+91 98290-12345"), "919829012345");
  assert.equal(waNumber("0091 98290 12345"), "919829012345");
});

test("no number, or too few digits, opens WhatsApp to pick a chat", () => {
  assert.equal(waNumber(null), "");
  assert.equal(waNumber(""), "");
  assert.equal(waNumber("12345"), "");
});
