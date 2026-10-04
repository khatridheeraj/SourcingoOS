import { daysBetween } from "@/lib/model";
import type { FOrder } from "@/lib/portal";

// Progress bar cells, same colours as the internal TNA views.
export function cells(o: FOrder, today: string) {
  return o.styles.flatMap((s) => s.checkpoints).map((c) =>
    c.status === "completed" ? "c" : c.due_date && c.due_date < today ? "o" : c.status === "delayed" ? "d" : c.status === "in_progress" ? "p" : "");
}

export function DueChip({ date, today, done }: { date: string | null; today: string; done?: boolean }) {
  if (!date || done) return null;
  const d = daysBetween(today, date);
  if (d < 0) return <span className="chip bad">{-d} day{d === -1 ? "" : "s"} late</span>;
  if (d === 0) return <span className="chip warn">Due today</span>;
  return <span className={`chip ${d <= 7 ? "warn" : ""}`}>{d} day{d === 1 ? "" : "s"} left</span>;
}

export const unit = (o: FOrder) => (o.order_type === "fabric" ? "m" : "pcs");
