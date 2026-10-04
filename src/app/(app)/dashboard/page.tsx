import { redirect } from "next/navigation";
import { AlertList, Head, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { addDays, allCheckpoints, computeAlerts, isLocked, isOpenSample, nf, orderValue, overdue, sampleOnTime, sumByCur } from "@/lib/model";
import { isOps } from "@/lib/roles";

export const metadata = { title: "Ops dashboard · Sourcingo OS" };

const INQ = [["new", "New"], ["quoted", "Quoted"], ["converted", "Converted"], ["lost", "Lost"]] as const;

export default async function Dashboard() {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const { world: w } = await loadWorld();
  const alerts = computeAlerts(w);
  const open = w.inquiries.filter((i) => i.status === "new" || i.status === "quoted").length;
  const conv = w.inquiries.filter((i) => i.status === "converted").length;
  const active = w.orders.filter((o) => o.status !== "shipped");
  const od = alerts.filter((a) => a.t.startsWith("Overdue")).length;
  let onTrack = 0, late = 0, delayed = 0, done = 0;
  for (const o of w.orders.filter((x) => x.status === "locked" || x.status === "shipped")) {
    for (const { cp } of allCheckpoints(o)) {
      if (cp.status === "completed") done++;
      else if (overdue(cp, w.today)) late++;
      else if (cp.status === "delayed") delayed++;
      else onTrack++;
    }
  }
  const tot = onTrack + late + delayed + done;
  const openSamples = w.samples.filter(isOpenSample);
  const samplesLate = openSamples.filter((s) => s.due_date && s.due_date < w.today).length;
  const samplesSoon = openSamples.filter((s) => s.due_date && s.due_date >= w.today && s.due_date <= addDays(w.today, 3)).length;
  const sent = w.samples.filter((s) => s.dispatched_on && s.dispatched_on >= addDays(w.today, -60) && sampleOnTime(s) !== null);
  const sentOnTime = sent.filter((s) => sampleOnTime(s)).length;
  const stageCounts = ([["At Sourcingo", "received"], ["With vendor", "with_vendor"], ["Ready to send", "ready"], ["Waiting for buyer", "dispatched"]] as const)
    .map(([l, k]) => [l, w.samples.filter((s) => s.status === k).length] as const);
  const maxStage = Math.max(1, ...stageCounts.map((c) => c[1]));
  const counts = INQ.map(([k, l]) => [l, w.inquiries.filter((i) => i.status === k).length] as const);
  const maxc = Math.max(1, ...counts.map((c) => c[1]));
  const bar = (label: string, n: number, of: number, color?: string) => (
    <div key={label} className="bar-row">
      <span>{label}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / of) * 100}%`, ...(color ? { background: color } : {}) }} /></div>
      <span className="num code">{n}</span>
    </div>
  );

  return (
    <>
      <Head title="Ops dashboard" sub="Everything live across inquiries, samples, sales orders, TNA and the warehouse." />
      <div className="tiles">
        <Tile tone="blue" label="Open inquiries" value={open} note={`${w.inquiries.length ? Math.round((conv / w.inquiries.length) * 100) : 0}% converted to orders`} href="/inquiries" />
        <Tile tone="yellow" label="Active sales orders" value={active.length} note={`${w.orders.filter((o) => !isLocked(o)).length} not yet locked`} href="/orders" />
        <Tile tone="green" money label="Order book" value={sumByCur(w.orders.map((o) => [orderValue(o), o.currency]))} note="All sales orders" />
        <Tile tone="pink" label="Goods held now" value={nf(w.grns.reduce((a, g) => a + w.grnHeld(g), 0))} note="Units received, not dispatched" href="/grn?status=held" />
        <Tile alarm={od > 0} label="Overdue checkpoints" value={od} note="Date passed, not completed" href="/tna" />
        <Tile alarm={samplesLate > 0} label="Samples due in 3 days" value={samplesSoon} note={samplesLate ? `${samplesLate} already late` : "None late"} href="/samples?show=week" />
      </div>
      <div className="two">
        <section className="panel">
          <h2>Needs attention</h2>
          <AlertList alerts={alerts} limit={60} />
        </section>
        <div className="stack">
          <section className="panel">
            <h3>Inquiry pipeline</h3>
            <div className="bars">
              {counts.map(([l, n]) => bar(l, n, maxc, l === "Lost" ? "var(--muted)" : l === "Converted" ? "var(--ok)" : undefined))}
            </div>
          </section>
          <section className="panel">
            <h3>Samples</h3>
            {w.samples.length ? (
              <>
                <div className="bars">{stageCounts.map(([l, n]) => bar(l, n, maxStage, l === "Ready to send" ? "var(--ok)" : undefined))}</div>
                <p className="mt-3 text-xs text-muted">
                  {sent.length ? `${Math.round((sentOnTime / sent.length) * 100)}% sent on time in the last 60 days (${sentOnTime} of ${sent.length}).` : "On-time rate shows once samples with due dates are sent."}
                </p>
              </>
            ) : (
              <p className="text-muted">Samples show here once they&apos;re logged.</p>
            )}
          </section>
          <section className="panel">
            <h3>TNA health</h3>
            {tot ? (
              <div className="bars">
                {bar("Completed", done, tot, "var(--ok)")}
                {bar("On track", onTrack, tot, "var(--accent)")}
                {bar("Delayed", delayed, tot, "var(--warn)")}
                {bar("Overdue", late, tot, "var(--bad)")}
              </div>
            ) : (
              <p className="text-muted">Checkpoints show here once a TNA is locked.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
