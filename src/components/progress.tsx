import { riskLate } from "@/lib/format";
import type { Progress } from "@/lib/progress";
import { partText, type OrderShip } from "@/lib/shipments";

// A chip only when an open order (or one factory's part of it) needs someone: on plan says nothing, so it shows none.
export function PlanChip({ p, looksShipped = false }: { p: Progress; looksShipped?: boolean }) {
  return looksShipped ? <span className="chip warn">Shipped? Close it</span>
    : p.riskDays > 0 ? <span className="chip bad" title="A late step pushes back every step after it">{riskLate(p.riskDays)}</span>
    // Past a target but the ship date still holds: most likely done and not marked yet.
    : p.behind ? <span className="chip warn" title="A step's target has passed with no Done date">Needs update</span>
    : null;
}

// The plan chip, steps done out of planned, a bar and where the slowest styles are.
// Before any step is done there is nothing to report but the chip, so "No step done yet" is left out.
// An order sent in parts shows its pieces shipped instead: what is left is what matters now.
export function ProgressCell({ p, looksShipped = false, ship, unit = "pcs" }: { p: Progress; looksShipped?: boolean; ship?: OrderShip | null; unit?: string }) {
  if (ship?.part) {
    return (
      <>
        <span className="flex items-center justify-between gap-2"><span className="chip info">Part shipped</span><small className="num">{Math.floor((100 * ship.shipped) / ship.ordered)}%</small></span>
        <span className="bar"><i className="ok" style={{ width: `${Math.max(3, (100 * ship.shipped) / ship.ordered)}%` }} /></span>
        <small>{partText(ship, unit)}</small>
      </>
    );
  }
  const quiet = !looksShipped && !p.riskDays && !p.behind && p.planned > 0;
  if (quiet && p.done === 0) return null;
  // No targets yet: the order's next step already says to plan it, so a chip would only repeat that.
  if (!looksShipped && !p.planned && !p.done) return null;
  return (
    <>
      <span className="flex items-center justify-between gap-2"><PlanChip p={p} looksShipped={looksShipped} /><small className="num">{p.total > 0 && `${p.done}/${p.total}`}</small></span>
      <span className="bar"><i className={p.riskDays > 0 ? "bad" : p.behind ? "warn" : ""} style={{ width: `${p.total ? Math.max(3, (100 * p.done) / p.total) : 0}%` }} /></span>
      {p.done > 0 && <small>{p.text}</small>}
    </>
  );
}
