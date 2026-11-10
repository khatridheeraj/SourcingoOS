import assert from "node:assert/strict";
import { test } from "node:test";
import { pieces, tagged } from "./notes.ts";

const team = [{ id: "v", name: "Vidhi Khandelwal" }, { id: "q", name: "qc" }, { id: "d", name: "Dheeraj Khatri" }];

test("tags from the chips and from @names in the text", () => {
  assert.deepEqual(tagged("Please check @vidhi, and @QC.", ["d"], team).sort(), ["d", "q", "v"]);
  assert.deepEqual(tagged("email me at x@vidhi.com", [], team), []);
  assert.deepEqual(tagged("@Rahul can you", [], team), []);
});

test("marks only teammates' @names", () => {
  assert.deepEqual(pieces("Hi @Vidhi, ask @Rahul", team), [
    { text: "Hi ", tag: false }, { text: "@Vidhi", tag: true }, { text: ", ask ", tag: false }, { text: "@Rahul", tag: false },
  ]);
});
