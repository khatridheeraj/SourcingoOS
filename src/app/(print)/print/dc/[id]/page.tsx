import { notFound, redirect } from "next/navigation";
import { Letterhead, loadCompany, Signatures } from "@/components/print-bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDay, dcQty, isoIST, money, nf, unitOf } from "@/lib/model";
import { isInternal } from "@/lib/roles";

export async function generateMetadata({ params }: PageProps<"/print/dc/[id]">) {
  return { title: `${(await params).id} · Delivery challan` };
}

// Travels with the goods. Staff prints carry the buyer code and the delivery address.
export default async function PrintDc({ params }: PageProps<"/print/dc/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const d = w.dcs.find((x) => x.id === id);
  if (!d) notFound();
  const o = w.orderById.get(d.so_id);
  const b = w.buyerById.get(o?.buyer_id ?? "");
  const c = await loadCompany();
  const unit = o ? unitOf(o) : "pcs";
  return (
    <>
      <Letterhead c={c} title="Delivery challan" number={d.id} sub={<div>Date {fmtDay(d.dispatched_at ? isoIST(d.dispatched_at) : isoIST(d.created_at))}</div>} />
      {d.status !== "dispatched" && <p className="warnbox mb-3">Draft: not dispatched yet.</p>}
      <div className="pgrid">
        <div>
          <h4>Ship to</h4>
          <b>{b?.real_name ?? b?.code}</b>
          {b?.real_name && <div className="code">{b.code}</div>}
          <div className="whitespace-pre-line">{d.address || o?.delivery_address || "—"}</div>
        </div>
        <div>
          <h4>Shipment</h4>
          <div>Buyer PO <b>{o?.buyer_po_number}</b> · our order <b className="code">{d.so_id}</b></div>
          <div>Invoice <b>{d.invoice_no || "—"}</b>{d.invoice_date && ` · ${fmtDay(d.invoice_date)}`}</div>
          <div>Courier <b>{d.courier || "—"}</b>{d.tracking && ` · ${d.tracking}`}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>#</th><th>Style</th><th>Colour</th><th>Qty</th><th>Value</th></tr></thead>
          <tbody>
            {d.lines.map((l, i) => {
              const s = w.styleById.get(l.style_id);
              return <tr key={l.id}><td>{i + 1}</td><td><b>{s?.name}</b> <span className="code">{s?.code}</span></td><td>{s?.colour}</td><td className="num">{nf(l.qty)} {unit}</td><td className="num">{money(l.qty * w.rate(l.style_id), o?.currency)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="ptotal"><span>Total {nf(dcQty(d))} {unit}</span><span>{money(w.dcValue(d), o?.currency)}</span></div>
      <Signatures left={`For ${c.trade_name}`} right="Received in good condition" />
    </>
  );
}
