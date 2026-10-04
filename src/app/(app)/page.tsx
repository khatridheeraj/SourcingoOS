import Link from "next/link";
import { AlertList, Head, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { computeAlerts, isoIST, sumByCur } from "@/lib/model";
import { NAV, QUICK_ACTIONS } from "@/lib/nav";
import { isInternal, isOps } from "@/lib/roles";

export default async function Home() {
  const me = await getMe();
  if (!me?.role || !isInternal(me.role)) {
    return (
      <section className="warnbox">
        <h2 className="text-lg font-bold">{me?.role ? "Your portal is on its way" : "Waiting for approval"}</h2>
        <p>
          {me?.role
            ? "Factory and buyer portals are the next thing being built. You'll see your orders here soon."
            : "Your account is set up. The owner needs to give you a role before you can see any orders."}
        </p>
      </section>
    );
  }
  const { world: w, error } = await loadWorld();
  const ops = isOps(me.role);
  const alerts = computeAlerts(w);
  const t = w.today;
  const dueToday = w.orders.filter((o) => o.status === "locked").flatMap((o) => o.styles.flatMap((s) => s.checkpoints)).filter((cp) => cp.due_date === t && cp.status !== "completed");
  const overdueN = alerts.filter((a) => a.t.startsWith("Overdue")).length;
  const grnToday = w.grns.filter((g) => isoIST(g.received_at) === t);
  const dcToday = w.dcs.filter((d) => d.status === "dispatched" && d.dispatched_at && isoIST(d.dispatched_at) === t);
  const held = w.lateGrns().length;
  const waiting = me.role === "owner" ? w.people.filter((p) => !p.active).length : 0;
  const day = new Date(w.now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

  return (
    <>
      <Head title="Shortcuts" sub={`Today at Sourcingo, ${day}.`} />
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      {waiting > 0 && (
        <Link href="/team" className="warnbox font-semibold">
          {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting for you to approve them →
        </Link>
      )}
      <section className="stack">
        <span className="sub">Your today&apos;s summary</span>
        <div className="tiles">
          {ops && <Tile tone="blue" label="New inquiries" value={w.inquiries.filter((i) => isoIST(i.created_at) === t).length} note={`${w.inquiries.filter((i) => i.status === "new" || i.status === "quoted").length} open in total`} href="/inquiries" />}
          {ops && <Tile tone="yellow" label="TNA activities due today" value={dueToday.length} note={`${overdueN} overdue`} href="/tna?preset=today" />}
          <Tile tone="green" label="GRNs received today" value={grnToday.length} note={sumByCur(grnToday.map((g) => [w.grnValue(g), w.currencyOf(g.so_id)]))} href="/grn" />
          <Tile tone="pink" label="Dispatched today" value={dcToday.length} note={sumByCur(dcToday.map((d) => [w.dcValue(d), w.currencyOf(d.so_id)]))} href="/dc?status=dispatched" />
          <Tile alarm={held > 0} label="Goods held over 24h" value={held} note="Must be zero" href="/grn?status=held" />
        </div>
      </section>
      {ops && (
        <section className="stack">
          <span className="sub">Quick actions</span>
          <div className="actions">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.href} href={a.href} className="action">
                <i className={a.tone}>{a.icon}</i>
                <span><b>{a.label}</b><small>{a.sub}</small></span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="two">
        <section className="panel">
          <div className="row mb-3">
            <h2 className="flex-1 text-[19px] font-bold">Needs attention</h2>
            {ops && <Link className="btn sm" href="/dashboard">Ops dashboard</Link>}
          </div>
          <AlertList alerts={ops ? alerts : alerts.filter((a) => a.href.startsWith("/grn") || a.href.startsWith("/dc"))} limit={8} more="on the Ops dashboard" />
        </section>
        <section className="panel">
          <h2>All modules</h2>
          <div className="stack" style={{ gap: 14 }}>
            {NAV.filter((g) => g.title).map((g) => {
              const items = g.items.filter((i) => i.roles.includes(me.role!));
              if (!items.length) return null;
              return (
                <div key={g.title}>
                  <div className="sub mb-1">{g.title}</div>
                  <div className="row">{items.map((i) => <Link key={i.href} className="link" href={i.href}>{i.label} ↗</Link>)}</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
