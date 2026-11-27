import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanWhatsapp, linesFor, rollCallText, tagOf, type AskPerson } from "./roll-call.ts";

const today = "2026-11-28";
const vidhi: AskPerson = {
  id: "v", name: "Vidhi Khandelwal", role: "merchandiser", whatsapp: "919876543210", tags: 2, lastAt: "2026-11-27T10:00:00Z",
  orders: [
    { order_no: "SO-0023", late: true, overdueSteps: 3 },
    { order_no: "SO-0021", late: false, overdueSteps: 4 },
    { order_no: "SO-0022", late: false, overdueSteps: 0 },
  ],
};
const qc: AskPerson = { id: "q", name: "qc", role: "quality", whatsapp: null, tags: 0, lastAt: null, orders: [] };

test("each person is tagged by WhatsApp number, or by first name when no number is saved", () => {
  assert.equal(tagOf(vidhi), "@919876543210");
  assert.equal(tagOf(qc), "@qc");
});

test("a merchandiser's lines put late orders first, then steps behind, then notes", () => {
  assert.deepEqual(linesFor(vidhi, today), [
    "3 open orders",
    "Past ship date: SO-0023. When will it go?",
    "Steps past target: SO-0021 (4)",
    "2 notes on orders waiting for your reply",
  ]);
});

test("someone quiet in the app is nudged, and Quality is asked about visits", () => {
  assert.deepEqual(linesFor(qc, today), ["Nothing updated in the app in 30 days", "Which factories are you visiting today, and what did you check yesterday?"]);
  const quiet = { ...vidhi, orders: [], tags: 0, lastAt: "2026-11-24T05:00:00Z" };
  assert.deepEqual(linesFor(quiet, today), ["Nothing updated in the app for 4 days", "What are you working on today?"]);
});

test("the message has the date, the ask, and everyone in a steady order", () => {
  const text = rollCallText({ company: "Sourcingo", today, people: [qc, vidhi] });
  assert.match(text, /^\*Good morning team · Saturday 28 Nov\*/);
  assert.ok(text.indexOf("@919876543210 (Vidhi)") < text.indexOf("@qc"), "merchandiser before Quality");
  assert.match(text, /reply here with a fresh update/);
});

test("typed numbers are cleaned the way WhatsApp writes them", () => {
  assert.equal(cleanWhatsapp("98765 43210"), "919876543210");
  assert.equal(cleanWhatsapp("+91 98765-43210"), "919876543210");
  assert.equal(cleanWhatsapp("0091 9876543210"), "919876543210");
  assert.equal(cleanWhatsapp("+1 415 555 0100"), "14155550100");
  assert.equal(cleanWhatsapp(""), "");
  assert.equal(cleanWhatsapp("12345"), null);
  assert.equal(cleanWhatsapp("abc"), null);
});
