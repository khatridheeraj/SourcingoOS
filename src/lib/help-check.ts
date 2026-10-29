// Help's live check of an order for Quality: the inspections and factory visits that are Quality's to do, never the
// orders team's work (Done dates, targets, approvals). Pure, so it is tested in help-check.test.ts.
import { dayNear, TNA_STEPS } from "./format.ts";

export type CheckItem = { ok: boolean; text: string };

export type QcCheckInput = {
  today: string;
  // An update from the floor this many days old still speaks for a step (FRESH_DAYS in floor.ts).
  freshDays: number;
  lines: { id: string; style: string; factoryId: string | null }[];
  factories: { id: string; name: string; released: boolean }[];
  // Every step not marked Not needed, done or not.
  stages: { lineId: string; stage: string; plannedOn: string | null; doneOn: string | null }[];
  // QC checks not cancelled: kind inline, midline, final or recheck.
  checks: { lineId: string; kind: string; result: string; checkedOn: string }[];
  floor: { lineId: string; stage: string; visitedOn: string }[];
  pendingUpdates: number;
};

const INSPECTIONS: { stage: string; label: string; kinds: string[] }[] = [
  { stage: "inline", label: "Inline", kinds: ["inline"] },
  { stage: "midline", label: "Mid-line", kinds: ["midline"] },
  { stage: "final_qc", label: "Final QC", kinds: ["final", "recheck"] },
];
const label = (stage: string) => TNA_STEPS.find((t) => t.key === stage)?.label ?? "Extra step";
const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")}, …` : xs.join(", "));

export function qcCheck(i: QcCheckInput): CheckItem[] {
  const items: CheckItem[] = [];
  const dm = (d: string) => dayNear(d, i.today);
  const running = new Set(i.factories.filter((f) => f.released).map((f) => f.id));
  for (const f of i.factories) {
    if (!f.released) items.push({ ok: false, text: `${f.name}: production hasn't started yet, so there is nothing to inspect there. It shows on your Home once it starts.` });
  }
  const lines = i.lines.filter((l) => l.factoryId && running.has(l.factoryId));
  if (!lines.length) {
    if (!items.length) items.push({ ok: false, text: "No factory is making this order yet, so there is nothing to inspect." });
    return items;
  }
  const ids = new Set(lines.map((l) => l.id));
  const style = new Map(lines.map((l) => [l.id, l.style]));

  // The last visit, and the late steps the floor hasn't spoken for lately.
  const floor = i.floor.filter((u) => ids.has(u.lineId));
  const last = floor.reduce<string | null>((m, u) => (!m || u.visitedOn > m ? u.visitedOn : m), null);
  items.push(last ? { ok: true, text: `Last visit update ${dm(last)}.` } : { ok: false, text: "No visit update on this order yet. Tap Post update to send one from the factory." });
  const heard = (lineId: string, stage: string) =>
    floor.some((u) => u.lineId === lineId && u.stage === stage && u.visitedOn >= addDays(i.today, -i.freshDays));
  const silent = i.stages.filter((s) => ids.has(s.lineId) && !s.doneOn && s.plannedOn && s.plannedOn < i.today && !heard(s.lineId, s.stage)
    && !INSPECTIONS.some((x) => x.stage === s.stage));
  if (silent.length) {
    const named = [...new Set(silent.map((s) => `${style.get(s.lineId)} ${label(s.stage)}`))];
    items.push({ ok: false, text: `${named.length} ${named.length > 1 ? "steps are" : "step is"} past target with no word from the floor (${list(named)}). Post a visit update for ${named.length > 1 ? "them" : "it"}.` });
  }

  // Each inspection, styles grouped by where they stand.
  for (const x of INSPECTIONS) {
    const rows = i.stages.filter((s) => ids.has(s.lineId) && s.stage === x.stage);
    if (!rows.length) continue;
    const passed: string[] = [], failed: string[] = [], due: string[] = [], later: string[] = [];
    let firstDue: string | null = null, nextOn: string | null = null;
    for (const s of rows) {
      const name = style.get(s.lineId)!;
      const latest = i.checks.filter((c) => c.lineId === s.lineId && x.kinds.includes(c.kind)).sort((a, b) => b.checkedOn.localeCompare(a.checkedOn))[0];
      if (latest?.result === "pass") passed.push(name);
      else if (latest) failed.push(name);
      else if (s.plannedOn && s.plannedOn <= i.today) { due.push(name); if (!firstDue || s.plannedOn < firstDue) firstDue = s.plannedOn; }
      else { later.push(name); if (s.plannedOn && (!nextOn || s.plannedOn < nextOn)) nextOn = s.plannedOn; }
    }
    const all = (xs: string[]) => (xs.length === rows.length && rows.length > 1 ? "every style" : list(xs));
    if (failed.length) items.push({ ok: false, text: `${x.label} failed for ${all(failed)}. Record the re-check once the factory has fixed it.` });
    if (due.length) items.push({ ok: false, text: `${x.label} is due for ${all(due)} (planned ${dm(firstDue!)}) and not recorded yet.` });
    if (passed.length) items.push({ ok: true, text: `${x.label} passed for ${all(passed)}.` });
    if (later.length && !failed.length && !due.length) items.push({ ok: true, text: `${x.label} is next ${nextOn ? `on ${dm(nextOn)}` : "once its date is planned"}.` });
  }
  if (i.pendingUpdates) items.push({ ok: false, text: `The factory marked ${i.pendingUpdates} ${i.pendingUpdates > 1 ? "steps" : "step"} done with photos. Check and confirm at the top of the order.` });
  return items;
}

function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
