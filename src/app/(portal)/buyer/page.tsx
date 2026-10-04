import { redirect } from "next/navigation";
import { Empty, Head, Pills, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { daysBetween, fmtDay, money, nf, SIZES, STAGES } from "@/lib/model";
import { loadBuyer } from "@/lib/portal";

export const metadata = { title: "Your orders · Sourcingo" };

const FILTERS = [{ key: "open", label: "In progress" }, { key: "shipped", label: "Shipped" }, { key: "all", label: "All" }];

export default async function BuyerHome({ searchParams }: PageProps<"/buyer">) {
  const me = await getMe();
  if (me?.role !== "buyer") redirect("/");
  const { buyer, orders, error } = await loadBuyer();
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.show) ? String(sp.show) : "open";
  const today = todayIST();
  const open = orders.filter((o) => o.milestone !== "Shipped");
  const shown = orders.filter((o) => filter === "all" || (filter === "shipped" ? o.milestone === "Shipped" : o.milestone !== "Shipped"));
  const next = open.map((o) => o.buyer_date).filter(Boolean).sort()[0] ?? null;
  const shipments = orders.flatMap((o) => o.dispatches);

  return (
    <>
      <Head title="Your orders with Sourcingo" sub={buyer ? `Account ${buyer.code}. Live status of every order, and tracking once goods ship.` : "Live status of every order, and tracking once goods ship."} />
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      {!buyer && !error && <p className="warnbox">Your login isn&apos;t linked to a buyer account yet. Ask Sourcingo to link it.</p>}
      <div className="tiles">
        <Tile tone="blue" label="Orders in progress" value={open.length} />
        <Tile tone="green" label="Next delivery" value={<span className="text-[20px]">{fmtDay(next)}</span>} />
        <Tile tone="pink" label="Shipments sent" value={shipments.length} />
      </div>
      <div className="row">
        <h2 className="grow text-[17px] font-bold">Orders</h2>
        <Pills current={filter} items={FILTERS.map((f) => ({ ...f, href: `/buyer?show=${f.key}` }))} />
      </div>
      {shown.length ? (
        <div className="stack">
          {shown.map((o) => {
            const stg = Math.max(0, STAGES.indexOf(o.milestone));
            const unit = o.order_type === "fabric" ? "m" : "pcs";
            const qty = o.styles.reduce((a, s) => a + Number(s.qty), 0);
            const value = o.styles.reduce((a, s) => a + Number(s.qty) * Number(s.buyer_rate), 0);
            const left = o.buyer_date ? daysBetween(today, o.buyer_date) : null;
            return (
              <article key={o.id} className="card">
                <div className="row">
                  <h3 className="grow text-[15px] font-bold">PO #{o.buyer_po_number}</h3>
                  {o.milestone === "Shipped" ? <span className="chip ok">Shipped</span>
                    : left != null && <span className={`chip ${left < 0 ? "bad" : left <= 7 ? "warn" : ""}`}>Delivery {fmtDay(o.buyer_date)}</span>}
                </div>
                <div className="meta mt-1">
                  <span>Order <b className="code">{o.id}</b></span>
                  <span>Placed <b>{fmtDay(o.so_date)}</b></span>
                  <span>Qty <b className="num">{nf(qty)} {unit}</b></span>
                  <span>Value <b className="num">{money(value, o.currency)}</b></span>
                </div>
                <div className="steps">
                  {STAGES.map((s, k) => (
                    <div key={s} className={`step ${k < stg || (k === stg && stg === 5) ? "done" : ""} ${k === stg && stg !== 5 ? "now" : ""}`}>{s}</div>
                  ))}
                </div>
                <details className="mt-3">
                  <summary>{o.styles.length} style{o.styles.length === 1 ? "" : "s"}{o.dispatches.length ? ` · ${o.dispatches.length} shipment${o.dispatches.length === 1 ? "" : "s"}` : ""}</summary>
                  <div className="table-wrap mt-2">
                    <table className="tbl">
                      <thead><tr><th>Style</th><th>Colour</th><th>Qty</th><th>Rate</th></tr></thead>
                      <tbody>
                        {o.styles.map((s) => (
                          <tr key={s.id}>
                            <td><b>{s.name}</b><br /><span className="code text-muted">{s.code}</span></td>
                            <td>{s.colour}</td>
                            <td className="num">
                              {nf(s.qty)} {unit}
                              {s.use_sizes && <span className="block text-xs text-muted">{SIZES.filter((z) => Number(s.sizes?.[z])).map((z) => `${z} ${s.sizes[z]}`).join(", ")}</span>}
                            </td>
                            <td className="num">{money(s.buyer_rate, o.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {o.dispatches.length > 0 && (
                    <div className="list-rows mt-2">
                      {o.dispatches.map((d) => (
                        <div key={d.id}>
                          <span className="grow">Shipped <b>{fmtDay(d.dispatched_at)}</b> via <b>{d.courier}</b></span>
                          <span>Tracking <b className="code">{d.tracking}</b></span>
                          <span className="text-xs text-muted">Invoice {d.invoice_no} · {fmtDay(d.invoice_date)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title={orders.length ? "Nothing here" : "No orders yet"}>
          {orders.length ? "Try another filter." : "Your orders appear here as soon as Sourcingo confirms them."}
        </Empty>
      )}
    </>
  );
}
