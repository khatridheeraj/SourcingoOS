import { cleanupList } from "@/lib/cleanup";
import { alertsFor, computeAlerts, isOpenSample, sampleDaysLeft, vendorLate, type World } from "@/lib/model";
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
  const openSamples = w.samples.filter(isOpenSample);
  if (openSamples.length) {
    const urgent = openSamples.some((s) => { const d = sampleDaysLeft(s, w.today); return d === null || d <= 1 || vendorLate(s, w.today); });
    out.samples = { n: openSamples.length, hot: urgent };
  }
  const alerts = computeAlerts(w);
  const red = (role === "owner" ? alerts : alertsFor(alerts, w.meId)).filter((a) => a.sev === "bad").length;
  if (red) out.alerts = { n: red, hot: true };
  const waiting = w.fpos.filter((p) => p.status === "issued" || p.status === "declined");
  if (waiting.length) out.fpos = { n: waiting.length, hot: waiting.some((p) => p.status === "declined") };
  const failing = new Set(w.orders.filter((o) => o.status === "locked").flatMap((o) => o.styles).filter((st) => w.qcFor(st.id)[0]?.result === "fail").map((st) => st.id));
  if (failing.size) out.qc = { n: failing.size, hot: true };
  if (isOps(role)) {
    const fix = cleanupList(w).total;
    if (fix) out.cleanup = { n: fix, hot: false };
    const open = w.inquiries.filter((i) => i.status === "new" || i.status === "quoted");
    if (open.length) out.inquiries = { n: open.length, hot: open.some((i) => !!i.next_follow_up && i.next_follow_up <= w.today) };
    const review = w.orders.filter((o) => o.status === "tna_review").length;
    if (review) out.review = { n: review, hot: role === "owner" };
  }
  return out;
}
