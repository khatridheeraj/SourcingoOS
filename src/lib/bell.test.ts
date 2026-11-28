import { test } from "node:test";
import assert from "node:assert/strict";
import { bellItem, byDay, type BellRow } from "./bell.ts";

const row = (kind: string, info: Record<string, unknown> = {}, extra: Partial<BellRow> = {}): BellRow =>
  ({ at: "2026-11-27T10:00:00Z", kind, order_id: "o1", order_no: "SO-0023", who: "Flavia", info, ...extra });

test("a failed final QC is red and opens the order's QC", () => {
  const it = bellItem(row("qc", { qc_kind: "final", result: "fail", defects: 7 }));
  assert.equal(it.title, "Final QC failed on SO-0023");
  assert.equal(it.detail, "7 defects");
  assert.equal(it.tone, "bad");
  assert.equal(it.href, "/orders/o1#qc");
});

test("a passed QC is green with no detail", () => {
  const it = bellItem(row("qc", { qc_kind: "inline", result: "pass", defects: 0 }));
  assert.equal(it.title, "Inline QC passed on SO-0023");
  assert.equal(it.tone, "good");
  assert.equal(it.detail, null);
});

test("a buyer message names the buyer and opens the Buyer tab", () => {
  const it = bellItem(row("buyer_message", { body: "Can we ship on the 12th?" }));
  assert.equal(it.title, "Flavia wrote on SO-0023");
  assert.equal(it.href, "/orders/o1#buyer-talk");
  assert.equal(it.detail, "Can we ship on the 12th?");
});

test("a factory date ask shows both dates and the reason", () => {
  const it = bellItem(row("date_ask", { stage: "cutting", old_on: "2026-12-01", new_on: "2026-12-04", reason: "Fabric late" }, { who: "Kkora Fashions" }));
  assert.match(it.title, /^Kkora Fashions asks to move .+ on SO-0023$/);
  assert.equal(it.detail, "1 Dec 2026 to 4 Dec 2026. Fabric late");
  assert.equal(it.tone, "warn");
});

test("events without an order still read well", () => {
  const it = bellItem(row("enquiry", { id: "i1", product: "Kaftans", country: "Spain" }, { order_id: null, order_no: null, who: "Ola Studio" }));
  assert.equal(it.title, "New costing request from Ola Studio");
  assert.equal(it.detail, "Kaftans, Spain");
  assert.equal(it.href, "/inquiries/i1");
  assert.equal(bellItem(row("mystery", {}, { order_id: null, order_no: null })).title, "Something changed");
});

test("rows group under Today, Yesterday and the date, in India time", () => {
  const now = new Date("2026-11-27T20:00:00Z"); // 28 Nov 01:30 in India
  const g = byDay([
    bellItem(row("qc", { result: "pass" }, { at: "2026-11-27T19:00:00Z" })), // 28 Nov 00:30 IST
    bellItem(row("qc", { result: "pass" }, { at: "2026-11-27T10:00:00Z" })), // 27 Nov
    bellItem(row("qc", { result: "pass" }, { at: "2026-11-20T10:00:00Z" })),
  ], now);
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [["Today", 1], ["Yesterday", 1], ["20 Nov 2026", 1]]);
});
