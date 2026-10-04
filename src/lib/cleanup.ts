import { addDays, isOpenSample, type Order, type Style, type World } from "@/lib/model";

// Gaps in the data that stop alerts, POs and reports from being right. Most
// came in with the email import; the Fix my data screen walks through them.
export function cleanupList(w: World) {
  const t = w.today;
  const live = w.orders.filter((o) => o.status !== "shipped");
  const running = w.orders.filter((o) => o.status === "locked");
  const pastBuyer = running.filter((o) => o.buyer_date && o.buyer_date < addDays(t, -7))
    .sort((a, b) => (a.buyer_date ?? "").localeCompare(b.buyer_date ?? ""));
  const pastIds = new Set(pastBuyer.map((o) => o.id));
  const noTna = running.filter((o) => !pastIds.has(o.id) && o.styles.length > 0 && o.styles.some((s) => !s.checkpoints.length));
  const noMerch = live.filter((o) => !pastIds.has(o.id) && (!o.merchandiser_id || !o.manager_id));
  const noFactory = live.filter((o) => !pastIds.has(o.id) && !o.factory_id);
  const noDates = running.filter((o) => !pastIds.has(o.id) && (!o.factory_date || !o.buyer_date));
  const noRate: { o: Order; s: Style }[] = live.filter((o) => !pastIds.has(o.id))
    .flatMap((o) => o.styles.filter((s) => s.factory_rate == null).map((s) => ({ o, s })));
  const samples = w.samples.filter((s) => isOpenSample(s) && !s.due_date);
  const inquiries = w.inquiries.filter((i) => (i.status === "new" || i.status === "quoted") && (!i.next_follow_up || i.next_follow_up < addDays(t, -14)));
  const total = pastBuyer.length + noTna.length + noMerch.length + noFactory.length + noDates.length + noRate.length + samples.length + inquiries.length;
  return { pastBuyer, noTna, noMerch, noFactory, noDates, noRate, samples, inquiries, total };
}
