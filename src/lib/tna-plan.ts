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

export type PlanStep = { planned_on: string | null | undefined; done_on: string | null | undefined };
export type Projection = {
  // When the last planned step will likely be done, and when it was planned.
  finish: string;
  plannedFinish: string;
  // Days the style is running behind its plan (0 when on time or ahead).
  slip: number;
};

// Carries lateness forward: a step done late, or still open past its target, pushes every later step back by
// the same days, as the work after it can only start once it is done. Steps without a target are skipped.
// Returns null when no step has a target.
export function project(steps: PlanStep[], today: string): Projection | null {
  let prevPlan: string | null = null;
  let prevProj: string | null = null;
  let last: { plan: string; proj: string } | null = null;
  for (const s of steps) {
    const plan = s.planned_on || null;
    if (!plan) continue;
    let proj: string;
    if (s.done_on) {
      proj = s.done_on;
    } else {
      proj = plan;
      if (prevPlan && prevProj) {
        const pushed = addDays(prevProj, Math.max(0, diff(prevPlan, plan)));
        if (pushed > proj) proj = pushed;
      }
      if (proj < today) proj = today;
    }
    prevPlan = plan;
    prevProj = proj;
    last = { plan, proj };
  }
  if (!last) return null;
  return { finish: last.proj, plannedFinish: last.plan, slip: Math.max(0, diff(last.plan, last.proj)) };
}

// How a style's likely finish compares with the date it must ship: at risk once it would miss the ship date,
// "behind" while it only eats into the buffer.
export function shipRisk(p: Projection | null, due: string | null | undefined): { level: "risk" | "behind" | "ok"; daysLate: number } {
  if (!p) return { level: "ok", daysLate: 0 };
  const daysLate = due ? diff(due, p.finish) : 0;
  if (due && daysLate > 0) return { level: "risk", daysLate };
  return { level: p.slip > 0 ? "behind" : "ok", daysLate: 0 };
}
