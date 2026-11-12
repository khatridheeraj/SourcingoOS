import { test } from "node:test";
import assert from "node:assert/strict";
import { openDefaults, rankQuotes, type MarketQuote } from "./market.ts";

const q = (id: string, over: Partial<MarketQuote> = {}): MarketQuote => ({
  id, factory_id: `f${id}`, factory: `F${id}`, city: null, rate: 200, ready_on: "2026-12-01", note: null,
  created_at: `2026-11-0${id}T10:00:00Z`, updated_at: "", withdrawn_at: null, styles_with_us: 0, ...over,
});

test("on-time quotes come before cheaper late ones, then the cheapest", () => {
  const rows = rankQuotes([q("1", { rate: 150, ready_on: "2026-12-10" }), q("2", { rate: 210 }), q("3", { rate: 190 })], "2026-12-05", 300);
  assert.deepEqual(rows.map((r) => r.id), ["3", "2", "1"]);
  assert.equal(rows[0].best, true);
  assert.equal(rows[2].daysLate, 5);
  assert.equal(rows[0].margin, 110);
  assert.equal(rows[0].marginPct, 36.7);
});

test("withdrawn quotes drop out; a known factory wins a tie", () => {
  const rows = rankQuotes([q("1"), q("2", { styles_with_us: 4 }), q("3", { rate: 100, withdrawn_at: "x" })], "2026-12-05", null);
  assert.deepEqual(rows.map((r) => r.id), ["2", "1"]);
  assert.equal(rows[0].margin, null);
});

test("defaults: ready by ship less buffer, quotes close in 3 days or by ready-by", () => {
  assert.deepEqual(openDefaults("2026-12-20", false, "2026-11-11"), { readyBy: "2026-12-13", closesOn: "2026-11-14" });
  assert.deepEqual(openDefaults("2026-11-14", true, "2026-11-11"), { readyBy: "2026-11-12", closesOn: "2026-11-12" });
  assert.deepEqual(openDefaults(null, false, "2026-11-11"), { readyBy: "2026-12-11", closesOn: "2026-11-14" });
});

test("a factory on a watch record is not suggested while another on-time quote exists", () => {
  const watch = { line: "55% on time", watch: true };
  const rows = rankQuotes([q("1", { rate: 150, record: watch }), q("2", { rate: 180 }), q("3", { rate: 120, ready_on: "2026-12-20" })], "2026-12-05", 300);
  assert.deepEqual(rows.map((r) => r.id), ["1", "2", "3"]);
  assert.deepEqual(rows.map((r) => r.best), [false, true, false]);
  const only = rankQuotes([q("1", { record: watch }), q("3", { ready_on: "2026-12-20" })], "2026-12-05", 300);
  assert.deepEqual(only.map((r) => r.best), [true, false]);
});
