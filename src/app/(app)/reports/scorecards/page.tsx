import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { addDays, allCheckpoints, DELAY_REASONS, isoIST, nf, num, orderValue, overdue, sumByCur } from "@/lib/model";
import { isOps } from "@/lib/roles";

export const metadata = { title: "Scorecards · Sourcingo OS" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const tone = (a: number, b: number, good = 0.85, ok = 0.7) => (!b ? undefined : a / b >= good ? "var(--ok)" : a / b >= ok ? "var(--warn)" : "var(--bad)");

// How each factory and buyer has done, from what's in the app. Use it to pick
// factories for new orders and to talk to them about delays.
export default async function Scorecards({ searchParams }: PageProps<"/reports/scorecards">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const sp = await searchParams;
  const days = [90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 180;
  const { world: w } = await loadWorld();
  const from = addDays(w.today, -days);
  const lead = me?.role === "owner" || me?.role === "manager";
  const orders = w.orders.filter((o) => (o.status === "locked" || o.status === "shipped") && (o.so_date ?? "") >= from);

  const factories = w.factories.map((f) => {
    const os = orders.filter((o) => o.factory_id === f.id);
    const cps = os.flatMap((o) => allCheckpoints(o).map((x) => x.cp)).filter((c) => c.due_date && c.due_date <= w.today);
    const done = cps.filter((c) => c.status === "completed");
    const onTime = done.filter((c) => c.status_updated_at && isoIST(c.status_updated_at) <= c.due_date!).length;
    const late = cps.filter((c) => overdue(c, w.today)).length;
    const reasons = new Map<string, number>();
    for (const c of os.flatMap((o) => allCheckpoints(o).map((x) => x.cp))) if (c.delay_reason) reasons.set(c.delay_reason, (reasons.get(c.delay_reason) ?? 0) + 1);
    const firstQc = os.flatMap((o) => o.styles).map((s) => w.qcFor(s.id).filter((q) => q.kind === "final").at(-1)).filter(Boolean);
    const qcPass = firstQc.filter((q) => q!.result === "pass").length;
    const deliveries = os.filter((o) => o.factory_date).map((o) => {
      const g = w.grns.filter((x) => x.so_id === o.id && x.status !== "rejected").sort((a, b) => a.received_at.localeCompare(b.received_at))[0];
      return g ? isoIST(g.received_at) <= o.factory_date! : null;
    }).filter((x) => x !== null);
    const pos = w.fpos.filter((p) => p.factory_id === f.id && p.issued_at >= from && p.responded_at);
    const hours = pos.length ? pos.reduce((a, p) => a + (Date.parse(p.responded_at!) - Date.parse(p.issued_at)) / 36e5, 0) / pos.length : null;
    return { f, os, steps: cps.length, onTime, done: done.length, late, reasons, qc: firstQc.length, qcPass, deliveries: deliveries.length, onTimeDel: deliveries.filter(Boolean).length, hours };
  }).filter((r) => r.os.length).sort((a, b) => b.os.length - a.os.length);

  const buyers = w.buyers.map((b) => {
    const os = orders.filter((o) => o.buyer_id === b.id);
    const shipped = os.filter((o) => o.buyer_date && w.dcs.some((d) => d.so_id === o.id && d.status === "dispatched"));
    const onTime = shipped.filter((o) => {
      const first = w.dcs.filter((d) => d.so_id === o.id && d.status === "dispatched" && d.dispatched_at).map((d) => isoIST(d.dispatched_at!)).sort()[0];
      return first && first <= o.buyer_date!;
    }).length;
    const margin = os.flatMap((o) => o.styles.filter((s) => s.factory_rate != null).map((s) => [num(s.qty) * (num(s.buyer_rate) - num(s.factory_rate)), num(s.qty) * num(s.buyer_rate), o.currency] as const));
    const samples = w.samples.filter((s) => s.buyer_id === b.id && (s.received_on ?? s.created_at.slice(0, 10)) >= from);
    const decided = samples.filter((s) => ["approved", "changes", "rejected"].includes(s.status));
    return {
      b, os, value: sumByCur(os.map((o) => [orderValue(o), o.currency])), shipped: shipped.length, onTime,
      marginPct: margin.length ? (margin.reduce((a, m) => a + m[0], 0) / Math.max(1, margin.reduce((a, m) => a + m[1], 0))) * 100 : null,
      samples: decided.length, approved: decided.filter((s) => s.status === "approved").length,
    };
  }).filter((r) => r.os.length || r.samples).sort((a, b) => b.os.length - a.os.length);

  return (
    <>
      <Head crumbs="Reports › Scorecards" title="Scorecards" sub={`Factories and buyers over the last ${days} days, from orders locked in that time.`}>
        <nav className="filters">{[90, 180, 365].map((d) => <Link key={d} className="pill" aria-current={d === days ? "page" : undefined} href={`/reports/scorecards?days=${d}`}>{d} days</Link>)}</nav>
      </Head>
      <section className="panel">
        <h2>Factories</h2>
        {factories.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Factory</th><th>Orders</th><th>Steps on time</th><th>Overdue now</th><th>Delivered on time</th><th>Final QC passed</th><th>Answers PO in</th><th>Top delay reasons</th></tr></thead>
              <tbody>
                {factories.map((r) => (
                  <tr key={r.f.id}>
                    <td><b>{r.f.name}</b>{r.f.city && <span className="block text-xs text-muted">{r.f.city}</span>}</td>
                    <td className="num">{r.os.length}</td>
                    <td className="num" style={{ color: tone(r.onTime, r.done), fontWeight: 700 }}>{pct(r.onTime, r.done)}<span className="block text-xs font-normal text-muted">{r.onTime} of {r.done}</span></td>
                    <td className="num" style={r.late ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{r.late}</td>
                    <td className="num" style={{ color: tone(r.onTimeDel, r.deliveries), fontWeight: 700 }}>{pct(r.onTimeDel, r.deliveries)}<span className="block text-xs font-normal text-muted">{r.deliveries} delivered</span></td>
                    <td className="num" style={{ color: tone(r.qcPass, r.qc, 0.9, 0.75), fontWeight: 700 }}>{pct(r.qcPass, r.qc)}<span className="block text-xs font-normal text-muted">{r.qc} inspected</span></td>
                    <td className="num">{r.hours == null ? "—" : r.hours < 24 ? `${Math.max(1, Math.round(r.hours))} h` : `${Math.round(r.hours / 24)} d`}</td>
                    <td className="text-xs">{[...r.reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${DELAY_REASONS.find((x) => x.value === k)?.label ?? k} (${n})`).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No factory orders in this period" />}
        <p className="mt-2 text-xs text-muted">Steps on time: TNA steps marked done by their date. Delivered on time: first goods received by the factory delivery date. Green is 85% and up.</p>
      </section>
      <section className="panel">
        <h2>Buyers</h2>
        {buyers.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Buyer</th><th>Orders</th><th>Order value</th><th>Shipped on time</th>{lead && <th>Margin</th>}<th>Samples approved</th></tr></thead>
              <tbody>
                {buyers.map((r) => (
                  <tr key={r.b.id}>
                    <td className="code">{r.b.code}</td>
                    <td className="num">{r.os.length}</td>
                    <td className="num">{r.value}</td>
                    <td className="num" style={{ color: tone(r.onTime, r.shipped), fontWeight: 700 }}>{pct(r.onTime, r.shipped)}<span className="block text-xs font-normal text-muted">{r.shipped} shipped</span></td>
                    {lead && <td className="num" style={{ color: r.marginPct == null ? undefined : r.marginPct >= 12 ? "var(--ok)" : r.marginPct >= 6 ? "var(--warn)" : "var(--bad)", fontWeight: 700 }}>{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>}
                    <td className="num">{pct(r.approved, r.samples)}<span className="block text-xs text-muted">{nf(r.samples)} decided</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No buyer orders in this period" />}
        {lead && <p className="mt-2 text-xs text-muted">Margin: (buyer rate − factory rate) × quantity, over styles with a factory rate. Our own costs (freight, testing) aren&apos;t included.</p>}
      </section>
    </>
  );
}
