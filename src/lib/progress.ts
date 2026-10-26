import { day, TNA_STEPS } from "@/lib/format";
import { project, shipRisk, type Projection } from "@/lib/tna-plan";

export type StepRow = { line_id: string; stage: string; planned_on: string | null; done_on: string | null; not_needed?: boolean; label?: string | null };
export type Progress = { text: string; planned: number; done: number; total: number; behind: boolean; riskDays: number; forecast: Forecast | null };

// Where an order is heading: the day its last style will likely be ready, against the ship date, and in plain words why.
export type Forecast = { finish: string; daysLate: number; slip: number; why: string; style: string };
// How late a factory usually finishes a step (see factoryPace), and its name for the reason line.
export type Pace = { days: number; factory: string };

// One style's steps in TNA order, as the projection reads them.
export const styleSteps = (rows: StepRow[], lineId: string) => {
  const own = rows.filter((s) => s.line_id === lineId);
  return [...TNA_STEPS.map((t) => own.find((s) => s.stage === t.key)), ...own.filter((s) => s.stage.startsWith("extra_"))]
    .filter((s): s is StepRow => !!s && !s.not_needed);
};

const stepName = (s: StepRow) => TNA_STEPS.find((t) => t.key === s.stage)?.label ?? s.label ?? "A step";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The reason a style runs late, in words the team uses.
export function why(p: Projection, steps: StepRow[], pace?: Pace): string {
  const c = p.cause;
  if (!c) return "";
  const s = steps[c.index];
  if (!s) return "";
  if (c.kind === "overdue") return `${stepName(s)} was due ${day(s.planned_on).slice(0, -5)} and isn't marked done`;
  if (c.kind === "done_late") return `${stepName(s)} finished ${plural(c.days, "day")} late`;
  return pace ? `${pace.factory} usually finishes steps ${plural(pace.days, "day")} after target` : "";
}

// Steps past their target with no Done date, leaving out those a later standard step shows are finished.
export function openPastTarget(steps: StepRow[], today: string): number {
  const lastDone = steps.reduce((m, s, i) => (s.done_on && !s.stage.startsWith("extra_") ? i : m), -1);
  return steps.filter((s, i) => !s.done_on && s.planned_on && s.planned_on < today && (i > lastDone || s.stage.startsWith("extra_"))).length;
}

// The forecast for a set of styles: the latest one decides.
export function forecast(lines: { id: string; style: string }[], rows: StepRow[], due: string | null | undefined, today: string, paceOf?: (lineId: string) => Pace | undefined): Forecast | null {
  let worst: Forecast | null = null;
  for (const l of lines) {
    const steps = styleSteps(rows, l.id);
    const pace = paceOf?.(l.id);
    const p = project(steps, today, pace?.days ?? 0);
    if (!p) continue;
    const daysLate = shipRisk(p, due).daysLate;
    if (!worst || p.finish > worst.finish) worst = { finish: p.finish, daysLate, slip: p.slip, why: why(p, steps, pace), style: l.style };
  }
  return worst;
}

// Progress of a set of styles (an order, or one factory's part of it): where the slowest styles are, and
// whether any step is past its target. `rows` may hold steps of other styles too; only `lineIds` count.
export function styleProgress(lineIds: string[], rows: StepRow[], due: string | null | undefined, today: string, paceOf?: (lineId: string) => Pace | undefined): Progress {
  const ids = new Set(lineIds);
  const mine = rows.filter((s) => ids.has(s.line_id));
  const at = lineIds.map((id) => Math.max(-1, ...mine.filter((s) => s.line_id === id && s.done_on).map((s) => TNA_STEPS.findIndex((t) => t.key === s.stage))));
  const slowest = Math.min(...at);
  const n = at.filter((i) => i === slowest).length;
  const m = lineIds.length;
  const step = slowest < 0 || !Number.isFinite(slowest) ? "" : TNA_STEPS[slowest].label;
  const fc = forecast(lineIds.map((id) => ({ id, style: "" })), mine, due, today, paceOf);
  return {
    // Named by the last step finished ("Cutting done"), never "At Cutting", which reads as if it were still under way.
    text: !m ? "" : m === 1 ? (step ? `${step} done` : "No step done yet")
      : n === m ? (step ? `${step} done on all ${m} styles` : `No step done yet on any of ${m} styles`)
      : step ? `${n} of ${m} styles only up to ${step}` : `${n} of ${m} styles have no step done yet`,
    planned: mine.filter((s) => s.planned_on).length,
    done: mine.filter((s) => s.done_on).length,
    total: mine.filter((s) => s.planned_on || s.done_on).length,
    behind: lineIds.some((id) => openPastTarget(styleSteps(mine, id), today) > 0),
    // Days the latest style will likely miss the ship date by, with late steps pushing the later ones back.
    riskDays: fc?.daysLate ?? 0,
    forecast: fc,
  };
}

// Each style's factory pace, for styleProgress and forecast.
export function paceLookup(pace: Map<string, number>, lines: { id: string; factory_id: string | null }[], factoryName: (id: string) => string) {
  const of = new Map(lines.map((l) => [l.id, l.factory_id]));
  return (lineId: string): Pace | undefined => {
    const f = of.get(lineId);
    const days = f ? pace.get(f) : undefined;
    return f && days ? { days, factory: factoryName(f) } : undefined;
  };
}
