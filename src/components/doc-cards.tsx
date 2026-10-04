import Link from "next/link";
import { Chip, HoldChip } from "@/components/bits";
import { fmtDateTime } from "@/lib/format";
import { type Dc, type Grn, grnQty, money, nf, type World } from "@/lib/model";

export function GrnCard({ w, g }: { w: World; g: Grn }) {
  const o = w.orderById.get(g.so_id);
  return (
    <Link href={`/grn/${g.id}`} className="card doc-card">
      <div className="top"><b>{g.id}</b><Chip status={g.status} /></div>
      <div className="kv">
        <span>Doc</span><b>{g.so_id} · #{o?.buyer_po_number ?? "—"}</b>
        <span>Vendor</span><b>{w.factoryName(o?.factory_id)}</b>
        <span>Received</span><b>{fmtDateTime(g.received_at)}</b>
        <span>By</span><b>{w.personName(g.received_by)}</b>
      </div>
      <div><HoldChip w={w} g={g} /></div>
      <div className="foot">
        <span>Total value<b>{money(w.grnValue(g), w.currencyOf(g.so_id))}</b></span>
        <span style={{ textAlign: "right" }}>Units<b>{nf(grnQty(g))}</b></span>
      </div>
    </Link>
  );
}

export function dcHeldHours(w: World, d: Dc) {
  const g = w.grnById.get(d.grn_id);
  return d.status === "dispatched" && g && d.dispatched_at ? (Date.parse(d.dispatched_at) - Date.parse(g.received_at)) / 36e5 : null;
}

export function DcCard({ w, d }: { w: World; d: Dc }) {
  const h = dcHeldHours(w, d);
  return (
    <Link href={`/dc/${d.id}`} className="card doc-card">
      <div className="top"><b>{d.id}</b><Chip status={d.status} /></div>
      <div className="kv">
        <span>Doc</span><b>{d.so_id} · {d.grn_id}</b>
        <span>Customer</span><b>{w.buyerCode(w.orderById.get(d.so_id)?.buyer_id)}</b>
        <span>{d.status === "dispatched" ? "Dispatched" : "Created"}</span><b>{fmtDateTime(d.dispatched_at ?? d.created_at)}</b>
        <span>Courier</span><b>{d.courier || "—"}{d.tracking ? ` · ${d.tracking}` : ""}</b>
      </div>
      {h != null && <div><span className={`chip ${h > 24 ? "bad" : "ok"}`}>Held {h < 1 ? "under 1" : Math.round(h)}h {h > 24 ? "· late" : "· within 24h"}</span></div>}
      <div className="foot">
        <span>Total value<b>{money(w.dcValue(d), w.currencyOf(d.so_id))}</b></span>
        <span style={{ textAlign: "right" }}>Invoice<b>{d.invoice_no || "—"}</b></span>
      </div>
    </Link>
  );
}
