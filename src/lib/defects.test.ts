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
