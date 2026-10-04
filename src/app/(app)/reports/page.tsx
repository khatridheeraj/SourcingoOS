import { redirect } from "next/navigation";
import { BuyerCode, Download, Empty, Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { allCheckpoints, dcQty, grnQty, isoIST, nf, orderQty, orderValue, sumByCur } from "@/lib/model";
import { isInternal } from "@/lib/roles";

export const metadata = { title: "Reports & exports · Sourcingo OS" };

export default async function Reports() {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { world: w } = await loadWorld();
  const byBuyer = w.buyers
    .map((b) => {
      const ps = w.orders.filter((o) => o.buyer_id === b.id);
      const ds = w.dcs.filter((d) => d.status === "dispatched" && ps.some((o) => o.id === d.so_id));
      return { b, ps, ds };
    })
    .filter((r) => r.ps.length);
  const byFactory = w.factories
    .map((f) => {
      const ps = w.orders.filter((o) => o.factory_id === f.id);
      let due = 0, done = 0, ot = 0, late = 0;
      for (const o of ps.filter((x) => x.status === "locked" || x.status === "shipped")) {
        for (const { cp } of allCheckpoints(o)) {
          if (!cp.due_date || cp.due_date > w.today) continue;
          due++;
          if (cp.status === "completed") {
            done++;
            if (cp.status_updated_at && isoIST(cp.status_updated_at) <= cp.due_date) ot++;
          } else late++;
        }
      }
      const gs = w.grns.filter((g) => g.status !== "rejected" && ps.some((o) => o.id === g.so_id));
      return { f, ps, due, done, ot, late, gs };
    })
    .filter((r) => r.ps.length);

  return (
    <>
      <Head crumbs="Reports › Reports & exports" title="Reports & exports" sub="Business by buyer and factory, and downloads for Excel and backups." />
      <section className="panel">
        <h3>Downloads</h3>
        <div className="row">
          <Download href="/reports/export/sales-orders">Sales orders (CSV)</Download>
          <Download href="/reports/export/grns">GRNs (CSV)</Download>
          <Download href="/reports/export/delivery-challans">Delivery challans (CSV)</Download>
          {(me?.role === "owner" || me?.role === "accounts") && <Download href="/reports/export/payments">Payments (CSV)</Download>}
          {me?.role === "owner" && <Download href="/reports/export/backup">Full backup (JSON)</Download>}
        </div>
        <p className="mt-2 text-xs text-muted">CSV files open in Excel. Real buyer names are never included.</p>
      </section>
      <section className="stack">
        <h2 className="text-[19px] font-bold">By buyer</h2>
        {byBuyer.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Buyer</th><th>Orders</th><th>Qty booked</th><th>Value booked</th><th>Dispatched value</th><th>Dispatched qty</th><th>Active</th><th>Payment terms</th></tr></thead>
              <tbody>
                {byBuyer.map(({ b, ps, ds }) => (
                  <tr key={b.id}>
                    <td><BuyerCode buyer={b} /></td>
                    <td className="num">{ps.length}</td>
                    <td className="num">{nf(ps.reduce((a, o) => a + orderQty(o), 0))}</td>
                    <td className="num">{sumByCur(ps.map((o) => [orderValue(o), o.currency]))}</td>
                    <td className="num">{sumByCur(ds.map((d) => [w.dcValue(d), w.currencyOf(d.so_id)]))}</td>
                    <td className="num">{nf(ds.reduce((a, d) => a + dcQty(d), 0))}</td>
                    <td className="num">{ps.filter((o) => o.status !== "shipped").length}</td>
                    <td>{b.default_payment_terms || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No orders yet">Buyer totals appear once sales orders exist.</Empty>
        )}
      </section>
      <section className="stack">
        <h2 className="text-[19px] font-bold">By factory</h2>
        {byFactory.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Factory</th><th>Orders</th><th>Value</th><th>Activities due so far</th><th>On time</th><th>Overdue now</th><th>Units received</th><th>Damaged / short</th></tr></thead>
              <tbody>
                {byFactory.map((r) => (
                  <tr key={r.f.id}>
                    <td>{r.f.name}</td>
                    <td className="num">{r.ps.length}</td>
                    <td className="num">{sumByCur(r.ps.map((o) => [orderValue(o), o.currency]))}</td>
                    <td className="num">{r.due}</td>
                    <td className="num">{r.done ? Math.round((r.ot / r.done) * 100) : 0}%</td>
                    <td className="num" style={r.late ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{r.late}</td>
                    <td className="num">{nf(r.gs.reduce((a, g) => a + grnQty(g), 0))}</td>
                    <td className="num">{nf(r.gs.reduce((a, g) => a + g.lines.filter((l) => l.condition !== "good").reduce((b, l) => b + Number(l.qty), 0), 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No factory activity yet">Factory performance appears once sales orders are assigned.</Empty>
        )}
      </section>
    </>
  );
}
