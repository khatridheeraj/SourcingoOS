import Link from "next/link";
import { redirect } from "next/navigation";
import { BuyerCode, Chip, Download, Empty, Head, Pills, Progress, Tile } from "@/components/bits";
import { ClickRow, SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { dcQty, fmtDay, isLocked, money, nf, orderQty, orderValue, progressCells, type SoStatus, sumByCur, unitOf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";

export const metadata = { title: "Sales orders · Sourcingo OS" };

const FILTERS: { key: "all" | SoStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "tna_review", label: "TNA review" },
  { key: "locked", label: "Locked" },
  { key: "shipped", label: "Shipped" },
];

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const sp = await searchParams;
  const status = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "all";
  const q = String(sp.q ?? "").trim().toLowerCase();
  const { world: w, error } = await loadWorld();

  const active = w.orders.filter((o) => o.status === "locked");
  const dispatched = w.dcs.filter((d) => d.status === "dispatched");
  const list = w.orders
    .filter((o) => status === "all" || o.status === status)
    .filter((o) => {
      if (!q) return true;
      const b = w.buyerById.get(o.buyer_id);
      return [o.id, o.buyer_po_number, b?.code, w.isOwner ? b?.real_name : "", w.factoryName(o.factory_id), w.personName(o.merchandiser_id), o.tags.join(" ")]
        .join(" ").toLowerCase().includes(q);
    });
  const href = (s: string) => `/orders?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const review = w.orders.filter((o) => o.status === "tna_review").length;

  return (
    <>
      <Head
        crumbs="Sales › Sales orders"
        title="All sales orders"
        sub={<>Buyer POs. Draft → TNA review → locked by the owner. The factory gets the final PO only after the lock.</>}
      >
        <Download href="/reports/export/sales-orders">Export CSV</Download>
        {isOps(me?.role) && <Link className="btn primary" href="/orders/new">+ New sales order</Link>}
      </Head>
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      <div className="tiles">
        <Tile tone="blue" money label="GMV booked" value={sumByCur(w.orders.map((o) => [orderValue(o), o.currency]))} note={`Qty ${nf(w.orders.reduce((a, o) => a + orderQty(o), 0))} · ${w.orders.length} orders`} />
        <Tile tone="yellow" money label="Active in production" value={sumByCur(active.map((o) => [orderValue(o), o.currency]))} note={`Qty ${nf(active.reduce((a, o) => a + orderQty(o), 0))} · ${active.length} orders`} />
        <Tile tone="green" money label="Dispatched" value={sumByCur(dispatched.map((d) => [w.dcValue(d), w.currencyOf(d.so_id)]))} note={`Qty ${nf(dispatched.reduce((a, d) => a + dcQty(d), 0))} · ${w.orders.filter((o) => o.status === "shipped").length} orders complete`} />
      </div>
      <div className="row">
        <SearchParamInput placeholder="Search SO, buyer PO no, buyer, factory" />
        <Pills current={status} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: href(f.key), n: f.key === "tna_review" && w.isOwner ? review : 0 }))} />
      </div>
      {!w.orders.length ? (
        <Empty title="No sales orders yet">Create one from an inquiry, or start a new sales order directly.</Empty>
      ) : !list.length ? (
        <Empty title="No sales orders match">Try another filter.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>SO no.</th><th>Buyer</th><th>Date</th><th>Exp. ship</th><th>Factory</th><th>Qty</th><th>Value</th><th>Payment</th><th>Status</th><th>TNA</th></tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <ClickRow key={o.id} href={`/orders/${o.id}`}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="code font-semibold text-accent">{o.id}</Link>
                    <br /><span className="text-xs text-muted">#{o.buyer_po_number}</span>
                  </td>
                  <td><BuyerCode buyer={w.buyerById.get(o.buyer_id)} /></td>
                  <td className="num whitespace-nowrap">{fmtDay(o.so_date)}</td>
                  <td className="num whitespace-nowrap">{fmtDay(o.buyer_date)}</td>
                  <td>{w.factoryName(o.factory_id)}</td>
                  <td className="num whitespace-nowrap">{nf(orderQty(o))} {unitOf(o)}</td>
                  <td className="num whitespace-nowrap">{money(orderValue(o), o.currency)}</td>
                  <td>{o.payment_terms || "—"}</td>
                  <td><Chip status={o.status} /></td>
                  <td>{isLocked(o) ? <Progress cells={progressCells(o, w.today)} /> : <span className="text-xs text-muted">—</span>}</td>
                </ClickRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
