// Planning helpers for a style's TNA: standard targets worked back from the target date, and where a style
// is heading when a step runs late.

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Days before the target date by which each standard step is usually done, for a garment order of about two
// months. In Dheeraj's step order, so the dates never run backwards.
export const STEP_DAYS: Record<string, number> = {
  greige: 55,
  fit_sample: 50,
  fabric: 45,
  printing: 38,
  strike_off: 34,
  pp_sample: 30,
  size_set: 26,
  cutting: 22,
  stitching: 18,
  inline: 15,
  midline: 11,
  finishing: 7,
  packed: 4,
  final_qc: 2,
  ex_factory: 0,
};

// The same for a fabric order of about three weeks: greige from the mill, printing or dyeing, the strike off
// approved, then finishing, packing in rolls and the fabric check before it leaves. No garment-making steps.
export const FABRIC_STEP_DAYS: Record<string, number> = {
  greige: 21,
  printing: 14,
  strike_off: 10,
  finishing: 6,
  packed: 3,
  final_qc: 2,
  ex_factory: 0,
};

// The standard days for a style: fabric or garment.
export const stepDays = (fabric: boolean | undefined) => (fabric ? FABRIC_STEP_DAYS : STEP_DAYS);

// Standard targets for the given steps, ending on the target date. When there is less time than usual the
// steps are squeezed evenly into the days left, never before `from` (today).
export function standardTargets(stages: string[], target: string, from: string, days: Record<string, number> = STEP_DAYS): Record<string, string> {
  const room = Math.max(0, diff(from, target));
  const longest = Math.max(...Object.values(days));
  const scale = room < longest ? room / longest : 1;
  const out: Record<string, string> = {};
  for (const s of stages) {
    if (days[s] == null) continue;
    out[s] = addDays(target, -Math.round(days[s] * scale));
  }
  return out;
}

// Fills the empty steps of a style around the dates it already has, so the plan never runs backwards. `steps`
// are the standard steps in order; `on` is a target or done date already there, or null for an empty step.
// Each run of empty steps takes its standard date when that fits between the dates around it (never before
// `from`, today); otherwise the run is spread over the days it has, in the standard proportions.
// `days` are the standard days to use (garment by default, FABRIC_STEP_DAYS for a fabric style).
// Returns dates for the empty steps only.
export function fillEmptyTargets(steps: { stage: string; on: string | null }[], target: string, from: string,
  days: Record<string, number> = STEP_DAYS): Record<string, string> {
  const standard = standardTargets(steps.map((s) => s.stage), target, from, days);
  const out: Record<string, string> = {};
  for (let i = 0; i < steps.length; ) {
    if (steps[i].on || days[steps[i].stage] == null) { i++; continue; }
    let j = i;
    while (j + 1 < steps.length && !steps[j + 1].on && days[steps[j + 1].stage] != null) j++;
    const before = steps.slice(0, i).reverse().find((x) => x.on);
    const after = steps.slice(j + 1).find((x) => x.on);
    const lo = before?.on && before.on > from ? before.on : from;
    const hi = after?.on && after.on < target ? after.on : target;
    const run = steps.slice(i, j + 1);
    if (run.every((x) => standard[x.stage] >= lo && standard[x.stage] <= hi)) {
      for (const x of run) out[x.stage] = standard[x.stage];
    } else if (hi <= lo) {
      for (const x of run) out[x.stage] = lo;
    } else {
      // Standard days of the steps around the run, so the run keeps its usual shape inside the room it has.
      const dFrom = before ? days[before.stage] ?? days[run[0].stage] + 5 : days[run[0].stage] + 5;
      const dTo = after ? days[after.stage] ?? 0 : 0;
      const span = Math.max(1, dFrom - dTo);
      const room = diff(lo, hi);
      for (const x of run) out[x.stage] = addDays(lo, Math.round(((dFrom - days[x.stage]) / span) * room));
    }
    i = j + 1;
  }
  return out;
}

// A style's steps as the start-production sheet has them: standard steps in order, then its extra steps.
export type StartStep = { key: string; planned_on: string; done_on: string; not_needed: boolean; extra: boolean };
export type StartStyle = { id: string; fabric?: boolean; steps: StartStep[] };

// The plan production starts with. Every date the merchandiser saved is kept as it is, passed or not: only the
// empty steps get a date, from the standard days, between today and the target date (the day the factory has
// to finish by). A saved date after the target date is moved to it only when `moveLate` says so (the sheet asks).
// With no day left before the target date (it is today or past) nothing is filled: one day for every step is no
// plan, so the sheet asks for a smaller buffer instead. Returns the changes only, per style.
export function startTargets(styles: StartStyle[], target: string, today: string, moveLate = false): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of styles) {
    const changes: Record<string, string> = {};
    const late = (x: StartStep) => moveLate && !x.done_on && !!x.planned_on && x.planned_on > target;
    for (const x of s.steps) if (!x.not_needed && late(x)) changes[x.key] = target;
    if (target > today) {
      const std = s.steps.filter((x) => !x.extra && !x.not_needed);
      // Saved dates after the target date count as the target date here, so the empty steps around them stay inside it.
      const on = (x: StartStep) => x.done_on || (x.planned_on && x.planned_on > target ? target : x.planned_on) || null;
      const fill = fillEmptyTargets(std.map((x) => ({ stage: x.key, on: on(x) })), target, today, stepDays(s.fabric));
      for (const x of std) if (!x.planned_on && !x.done_on && fill[x.key]) changes[x.key] = fill[x.key];
      // Extra steps have no standard days: an empty one goes on the target date.
      for (const x of s.steps) if (x.extra && !x.not_needed && !x.planned_on && !x.done_on) changes[x.key] = target;
    }
    out[s.id] = changes;
  }
  return out;
}

// Steps with no date at all, which starting production has to fill.
export const emptySteps = (styles: StartStyle[]) =>
  styles.reduce((n, s) => n + s.steps.filter((x) => !x.not_needed && !x.planned_on && !x.done_on).length, 0);

// The buffer the sheet opens with: the one saved with the factory's request, else the standard one, but never so
// big that the merchandiser's own plan no longer fits. Her last date sets the finish date when it is later than
// the standard buffer allows (a plan ending 1 Nov on a 4 Nov ship date opens with 3 days, not 7).
// A plan whose dates have all passed is planned from today.
export function startBuffer(styles: StartStyle[], due: string, today: string, standardDays: number, saved?: number | null): number {
  if (saved != null) return saved;
  if (!due) return standardDays;
  const last = styles.flatMap((s) => s.steps.filter((x) => !x.not_needed && !x.done_on && x.planned_on).map((x) => x.planned_on)).sort().pop();
  const room = last ? diff(last > today ? last : today, due) : -1;
  return room >= 0 && room < standardDays ? room : standardDays;
}

// `stage` is the step's key; a standard step marked done shows the standard steps before it are finished too.
export type PlanStep = { planned_on: string | null | undefined; done_on: string | null | undefined; stage?: string };
// Why a style will finish late: the step that added the most days. `done_late`: it was finished after its target;
// `overdue`: its target has passed and it isn't marked done; `pace`: this factory usually finishes steps late.
export type Cause = { index: number; kind: "done_late" | "overdue" | "pace"; days: number };
export type Projection = {
  // When the last planned step will likely be done, and when it was planned.
  finish: string;
  plannedFinish: string;
  // Days the style is running behind its plan (0 when on time or ahead).
  slip: number;
  cause: Cause | null;
  // Steps left open but already passed: a later standard step is done, so they are counted as done.
  implied: number;
};

const standard = (s: PlanStep) => !!s.stage && !s.stage.startsWith("extra_");

// Carries lateness forward: a step done late, or still open past its target, pushes every later step back by
// the same days, as the work after it can only start once it is done. Steps without a target are skipped.
// A standard step left open while a later standard step is done is counted as done: the work has moved past it.
// `pace`: days late this factory usually finishes a step (learnt from its past orders), added to steps still to come.
// Returns null when no step has a target.
export function project(steps: PlanStep[], today: string, pace = 0): Projection | null {
  const lastDone = steps.reduce((m, s, i) => (standard(s) && s.done_on ? i : m), -1);
  let prevPlan: string | null = null;
  let prevProj: string | null = null;
  let last: { plan: string; proj: string } | null = null;
  let lateBefore = 0;
  let cause: Cause | null = null;
  let implied = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const plan = s.planned_on || null;
    if (!plan) continue;
    let proj: string;
    let kind: Cause["kind"] = "done_late";
    if (s.done_on) {
      proj = s.done_on;
    } else if (standard(s) && i < lastDone) {
      // Passed already: on its target (or pushed by the step before), but no later than the step done after it.
      implied++;
      const after = steps.slice(i + 1).find((x) => standard(x) && x.done_on)!.done_on!;
      proj = prevPlan && prevProj ? addDays(prevProj, Math.max(0, diff(prevPlan, plan))) : plan;
      if (proj < plan) proj = plan;
      if (proj > after) proj = after;
    } else {
      proj = addDays(plan, pace);
      kind = "pace";
      if (prevPlan && prevProj) {
        const pushed = addDays(prevProj, Math.max(0, diff(prevPlan, plan)));
        if (pushed > proj) proj = pushed;
      }
      if (proj < today) { proj = today; kind = "overdue"; }
    }
    const late = diff(plan, proj);
    if (late - lateBefore > 0 && (!cause || late - lateBefore > cause.days)) cause = { index: i, kind, days: late - lateBefore };
    lateBefore = Math.max(lateBefore, late);
    prevPlan = plan;
    prevProj = proj;
    last = { plan, proj };
  }
  if (!last) return null;
  const slip = Math.max(0, diff(last.plan, last.proj));
  return { finish: last.proj, plannedFinish: last.plan, slip, cause: slip ? cause : null, implied };
}

// How often a factory's steps finish after their target, from its finished steps on every order: the middle
// value in days, once there are enough to trust (8). Early finishes count as on time, and it is capped at 10 days
// so one bad order can't swamp the rest.
export const PACE_MIN = 8;
export function factoryPace(rows: { factory_id: string | null; planned_on: string | null; done_on: string | null }[]): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.factory_id || !r.planned_on || !r.done_on) continue;
    by.set(r.factory_id, [...(by.get(r.factory_id) ?? []), diff(r.planned_on, r.done_on)]);
  }
  const out = new Map<string, number>();
  for (const [f, xs] of by) {
    if (xs.length < PACE_MIN) continue;
    const v = [...xs].sort((a, b) => a - b);
    const mid = v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
    if (mid > 0) out.set(f, Math.min(10, mid));
  }
  return out;
}

// How a style's likely finish compares with the date it must ship: at risk once it would miss the ship date,
// "behind" while it only eats into the buffer.
export function shipRisk(p: Projection | null, due: string | null | undefined): { level: "risk" | "behind" | "ok"; daysLate: number } {
  if (!p) return { level: "ok", daysLate: 0 };
  const daysLate = due ? diff(due, p.finish) : 0;
  if (due && daysLate > 0) return { level: "risk", daysLate };
  return { level: p.slip > 0 ? "behind" : "ok", daysLate: 0 };
}
