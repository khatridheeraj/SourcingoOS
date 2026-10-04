import { computeAlerts, type World } from "@/lib/model";
import { isOps, type Role } from "@/lib/roles";

export type Badges = Record<string, { n: number; hot: boolean }>;

// Sidebar badges, the same rules as the original tool.
export function navCounts(w: World, role: Role | null): Badges {
  const out: Badges = {};
  const late = w.lateGrns().length;
  const pending = w.grns.filter((g) => g.status === "pending_approval").length;
  if (late) out.grn = { n: late, hot: true };
  else if (pending) out.grn = { n: pending, hot: role === "owner" };
  const waitingDc = w.grns.filter((g) => w.grnAvail(g) > 0).length;
  if (waitingDc) out.dc = { n: waitingDc, hot: late > 0 };
  if (isOps(role)) {
    const red = computeAlerts(w).filter((a) => a.sev === "bad").length;
    if (red) out.alerts = { n: red, hot: true };
    const open = w.inquiries.filter((i) => i.status === "new" || i.status === "quoted");
    if (open.length) out.inquiries = { n: open.length, hot: open.some((i) => !!i.next_follow_up && i.next_follow_up <= w.today) };
    const review = w.orders.filter((o) => o.status === "tna_review").length;
    if (review) out.review = { n: review, hot: role === "owner" };
  }
  return out;
}
