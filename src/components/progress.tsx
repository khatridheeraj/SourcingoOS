import type { Progress } from "@/lib/progress";

// Whether an open order (or one factory's part of it) is on plan, as one chip.
export function PlanChip({ p, looksShipped = false }: { p: Progress; looksShipped?: boolean }) {
  return looksShipped ? <span className="chip warn">Shipped? Close it</span>
    : p.riskDays > 0 ? <span className="chip bad" title="A late step pushes back every step after it">At risk · {p.riskDays}d late</span>
    : p.behind ? <span className="chip bad">Behind plan</span>
    : !p.planned ? <span className="chip warn">No targets</span>
    : <span className="chip ok">On plan</span>;
}

// The plan chip, steps done out of planned, a bar and where the slowest styles are.
export function ProgressCell({ p, looksShipped = false }: { p: Progress; looksShipped?: boolean }) {
  return (
    <>
      <span className="flex items-center justify-between gap-2"><PlanChip p={p} looksShipped={looksShipped} /><small className="num">{p.total > 0 && `${p.done}/${p.total}`}</small></span>
      <span className="bar"><i className={p.behind ? "bad" : ""} style={{ width: `${p.total ? Math.max(3, (100 * p.done) / p.total) : 0}%` }} /></span>
      <small>{p.text}</small>
    </>
  );
}
