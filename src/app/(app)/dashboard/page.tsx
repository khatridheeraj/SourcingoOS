import { redirect } from "next/navigation";
import { AlertList, Head, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { allCheckpoints, computeAlerts, isLocked, nf, orderValue, overdue, sumByCur } from "@/lib/model";
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
      <Head title="Ops dashboard" sub="Everything live across inquiries, sales orders, TNA and the warehouse." />
      <div className="tiles">
        <Tile tone="blue" label="Open inquiries" value={open} note={`${w.inquiries.length ? Math.round((conv / w.inquiries.length) * 100) : 0}% converted to orders`} href="/inquiries" />
        <Tile tone="yellow" label="Active sales orders" value={active.length} note={`${w.orders.filter((o) => !isLocked(o)).length} not yet locked`} href="/orders" />
        <Tile tone="green" money label="Order book" value={sumByCur(w.orders.map((o) => [orderValue(o), o.currency]))} note="All sales orders" />
        <Tile tone="pink" label="Goods held now" value={nf(w.grns.reduce((a, g) => a + w.grnHeld(g), 0))} note="Units received, not dispatched" href="/grn?status=held" />
        <Tile alarm={od > 0} label="Overdue checkpoints" value={od} note="Date passed, not completed" href="/tna" />
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
