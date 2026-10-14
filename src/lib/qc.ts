import { SHIP_QC } from "@/lib/format";

// QC is kept per style. A check with no style was recorded for the whole order before style-wise QC,
// so it counts for every style on that order. Checks must come newest first and exclude cancelled ones.
type Check = { line_id: string | null; kind: string; result: string };

// The latest check of these kinds that applies to a style.
export function latestFor<C extends Check>(checks: C[], lineId: string, kinds: string[]): C | undefined {
  return checks.find((c) => kinds.includes(c.kind) && (c.line_id === lineId || c.line_id == null));
}

// True when every style's latest final check (or re-check) passed. Mirrors final_qc_passed in the database.
export function allStylesPassed(checks: Check[], lineIds: string[]): boolean {
  if (!lineIds.length) return checks.find((c) => c.line_id == null && SHIP_QC.includes(c.kind))?.result === "pass";
  return lineIds.every((id) => latestFor(checks, id, SHIP_QC)?.result === "pass");
}
