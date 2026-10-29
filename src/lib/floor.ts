// Updates from the factory floor: what Quality saw on a visit, step by step, for every style.
// Pure helpers, used on the server and in the browser alike.
import { daysBetween } from "@/lib/format";

export type FloorStatus = "done" | "on_track" | "behind" | "issue";

export const FLOOR_STATUS: { key: FloorStatus; label: string; hint: string; tone: "ok" | "" | "warn" | "bad" }[] = [
  { key: "done", label: "Done", hint: "Finished. Marks the step done today", tone: "ok" },
  { key: "on_track", label: "On track", hint: "Running, will finish on time", tone: "" },
  { key: "behind", label: "Running late", hint: "Say when it will be ready", tone: "warn" },
  { key: "issue", label: "Problem", hint: "Something is wrong: say what", tone: "bad" },
];
export const floorStatus = (k: string) => FLOOR_STATUS.find((s) => s.key === k) ?? FLOOR_STATUS[1];

// Inline, Mid-line and Final QC are inspections: on a visit Quality records them as a QC check that passed or failed,
// the same check Record QC saves, so a fail has the same weight everywhere (Final QC failed, re-check due).
export const INSPECTION_KIND: Record<string, string> = { inline: "inline", midline: "midline", final_qc: "final" };
export type VisitResult = "pass" | "fail";
export const VISIT_RESULT: { key: VisitResult; label: string; hint: string; tone: "ok" | "bad" }[] = [
  { key: "pass", label: "Pass", hint: "Goods meet the quality standard", tone: "ok" },
  { key: "fail", label: "Fail", hint: "Goods don't meet the standard: say what", tone: "bad" },
];

// A factory with production running is visited at least this often.
export const VISIT_DAYS = 3;
// An update this recent still speaks for a step: it isn't asked for again.
export const FRESH_DAYS = 2;

// Samples are done when the buyer approves them, and Final QC when its check is recorded, not from a visit.
export const NOT_DONE_ON_VISIT: Record<string, string> = {
  fit_sample: "Done when the buyer approves it",
  strike_off: "Done when the buyer approves it",
  pp_sample: "Done when the buyer approves it",
  size_set: "Done when the buyer approves it",
  final_qc: "Done when its QC check is recorded",
};

// "Visited today", "Visited yesterday", "Visited 4 days ago", "Never visited".
export function visitedText(last: string | null | undefined, today: string) {
  if (!last) return "Never visited";
  const n = daysBetween(last, today);
  return n <= 0 ? "Visited today" : n === 1 ? "Visited yesterday" : `Visited ${n} days ago`;
}

// "Inline QC failed", "Final QC failed": how a failed inspection from a visit reads on the floor.
export const qcFailed = (step: string) => `${/QC$/.test(step) ? step : `${step} QC`} failed`;

// One line saying what an update found: "Cutting on track · 300 of 500 pcs", "Stitching late, ready 29 Oct".
export function floorLine(u: { status: string; qty_done: number | null; expected_on: string | null; note?: string | null }, step: string, total: string, dm: (d: string) => string) {
  const failed = u.status === "issue" && !!u.note?.startsWith(`${qcFailed(step)}:`);
  const s = u.status === "done" ? `${step} done` : u.status === "behind" ? `${step} running late${u.expected_on ? `, ready ${dm(u.expected_on)}` : ""}`
    : failed ? `${qcFailed(step)}${u.expected_on ? `, re-check ${dm(u.expected_on)}` : ""}`
    : u.status === "issue" ? `${step}: problem${u.expected_on ? `, ready ${dm(u.expected_on)}` : ""}` : `${step} on track`;
  return u.qty_done != null && u.status !== "done" ? `${s} · ${u.qty_done.toLocaleString("en-IN")} of ${total}` : s;
}
