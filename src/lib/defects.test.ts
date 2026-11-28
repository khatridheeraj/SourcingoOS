import { test } from "node:test";
import assert from "node:assert/strict";
import { defectLine, defectMessage } from "./defects.ts";

const list = [
  { defect: "Loose threads", pieces: 8, severity: "minor" as const },
  { defect: "Shade variation", pieces: 6, severity: "major" as const },
  { defect: "Hole", pieces: 1, severity: "critical" as const },
];

test("the line puts the worst defects first and names only non-major severities", () => {
  assert.equal(defectLine(list), "Hole 1 (critical), Shade variation 6, Loose threads 8 (minor)");
});

test("the factory message lists each defect to fix", () => {
  const m = defectMessage({ order: "SO-0005", style: "K-1", kind: "Final", on: "10 Nov", checked: 50, list, notes: "Shade off on 2 rolls" });
  assert.match(m, /^\*Final check failed\* · SO-0005 · K-1 · 10 Nov\n50 pcs checked\.\nPlease fix before the re-check:\n1\. Hole: 1 pc \(critical\)\n2\. Shade variation: 6 pcs\n3\. Loose threads: 8 pcs \(minor\)/);
  assert.match(m, /15 defects in all\.\nNote: Shade off on 2 rolls$/);
});

test("analytics: rate per 100 pieces, 12 months ending now, factories worst first", async () => {
  const { per100, passByMonth, rankFactories } = await import("./defects.ts");
  assert.equal(per100(23, 1000), 2.3);
  assert.equal(per100(5, 40), null);
  const m = passByMonth([{ month: "2026-11", firsts: 4, passed: 3 }, { month: "2026-01", firsts: 2, passed: 2 }], "2026-11-28");
  assert.equal(m.length, 12);
  assert.deepEqual([m[0].month, m[0].label, m[0].pct], ["2025-12", "Dec", null]);
  assert.deepEqual([m[1].month, m[1].pct], ["2026-01", 100]);
  assert.deepEqual([m[11].month, m[11].pct, m[11].firsts], ["2026-11", 75, 4]);
  const r = rankFactories([
    { factory_id: "a", name: "A", checks: 3, failed: 0, pieces_checked: 500, defects: 5, top: [] },
    { factory_id: "b", name: "B", checks: 3, failed: 2, pieces_checked: 500, defects: 40, top: [] },
    { factory_id: "c", name: "C", checks: 1, failed: 1, pieces_checked: 20, defects: 9, top: [] },
  ]);
  assert.deepEqual(r.map((x) => [x.factory_id, x.rate]), [["b", 8], ["a", 1], ["c", null]]);
});
