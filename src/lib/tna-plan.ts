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
const LONGEST = Math.max(...Object.values(STEP_DAYS));

// Standard targets for the given steps, ending on the target date. When there is less time than usual the
// steps are squeezed evenly into the days left, never before `from` (today).
export function standardTargets(stages: string[], target: string, from: string): Record<string, string> {
  const room = Math.max(0, diff(from, target));
  const scale = room < LONGEST ? room / LONGEST : 1;
  const out: Record<string, string> = {};
  for (const s of stages) {
    if (STEP_DAYS[s] == null) continue;
    out[s] = addDays(target, -Math.round(STEP_DAYS[s] * scale));
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
