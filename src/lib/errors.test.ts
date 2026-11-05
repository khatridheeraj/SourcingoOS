import assert from "node:assert/strict";
import { test } from "node:test";
import { errorText } from "../app/factory/i18n.ts";
import { caught, DROPPED, isDropped, isSignedOut, SIGNED_OUT } from "./errors.ts";

test("a dropped connection reads the same in every browser", () => {
  for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "Network request failed", " network error "]) {
    assert.ok(isDropped(m), m);
    assert.equal(caught(new TypeError(m), "x"), DROPPED);
  }
  // Our own messages that mention the network stay as they are.
  assert.equal(isDropped("Couldn't upload a.jpg: the connection dropped. Check the network and try again."), false);
  assert.equal(caught(new Error("That step is already marked done."), "x"), "That step is already marked done.");
  assert.equal(caught("nope", "The photos didn't upload."), "The photos didn't upload.");
  assert.equal(caught(new Error(""), "fallback"), "fallback");
});

test("a factory reading Hindi gets the dropped connection in Hindi", () => {
  assert.notEqual(errorText("hi", DROPPED), DROPPED);
  assert.equal(errorText("en", DROPPED), DROPPED);
});

test("a save after signing out says so, in Hindi for a factory, and is not taken for a dropped connection", () => {
  assert.ok(isSignedOut(SIGNED_OUT));
  assert.equal(isDropped(SIGNED_OUT), false);
  assert.equal(caught(new Error(SIGNED_OUT), "x"), SIGNED_OUT);
  assert.notEqual(errorText("hi", SIGNED_OUT), SIGNED_OUT);
  assert.equal(isSignedOut("An unexpected response was received from the server."), false);
});
