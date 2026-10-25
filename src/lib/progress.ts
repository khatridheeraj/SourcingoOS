import { TNA_STEPS } from "@/lib/format";
import { project, shipRisk } from "@/lib/tna-plan";

export type StepRow = { line_id: string; stage: string; planned_on: string | null; done_on: string | null };
export type Progress = { text: string; planned: number; done: number; total: number; behind: boolean; riskDays: number };

// Progress of a set of styles (an order, or one factory's part of it): where the slowest styles are, and
// whether any step is past its target. `rows` may hold steps of other styles too; only `lineIds` count.
export function styleProgress(lineIds: string[], rows: StepRow[], due: string | null | undefined, today: string): Progress {
  const ids = new Set(lineIds);
  const mine = rows.filter((s) => ids.has(s.line_id));
  const at = lineIds.map((id) => Math.max(-1, ...mine.filter((s) => s.line_id === id && s.done_on).map((s) => TNA_STEPS.findIndex((t) => t.key === s.stage))));
  const slowest = Math.min(...at);
  const n = at.filter((i) => i === slowest).length;
  const m = lineIds.length;
  const step = slowest < 0 || !Number.isFinite(slowest) ? "" : TNA_STEPS[slowest].label;
  return {
    // Named by the last step finished ("Cutting done"), never "At Cutting", which reads as if it were still under way.
    text: !m ? "" : m === 1 ? (step ? `${step} done` : "No step done yet")
      : n === m ? (step ? `${step} done on all ${m} styles` : `No step done yet on any of ${m} styles`)
      : step ? `${n} of ${m} styles only up to ${step}` : `${n} of ${m} styles have no step done yet`,
    planned: mine.filter((s) => s.planned_on).length,
    done: mine.filter((s) => s.done_on).length,
    total: mine.filter((s) => s.planned_on || s.done_on).length,
    behind: mine.some((s) => !s.done_on && s.planned_on && s.planned_on < today),
    // Days the latest style will likely miss the ship date by, with late steps pushing the later ones back.
    riskDays: Math.max(0, ...lineIds.map((id) => {
      const own = mine.filter((s) => s.line_id === id);
      const ordered = [...TNA_STEPS.map((t) => own.find((s) => s.stage === t.key)), ...own.filter((s) => s.stage.startsWith("extra_"))]
        .map((s) => ({ planned_on: s?.planned_on, done_on: s?.done_on }));
      return shipRisk(project(ordered, today), due).daysLate;
    })),
  };
}
