import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCode, Chip } from "@/components/bits";
import { dcHeldHours } from "@/components/doc-cards";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { fmtDay, money, nf } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { DcForm } from "../dc-form";
import { dcGrnOptions } from "../options";

export async function generateMetadata({ params }: PageProps<"/dc/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

export default async function DcPage({ params }: PageProps<"/dc/[id]">) {
  const me = await getMe();
  if (!isInternal(me?.role)) redirect("/");
  const { id } = await params;
  const { world: w } = await loadWorld();
  const d = w.dcs.find((x) => x.id === id);
  if (!d) notFound();

  if (d.status === "draft" && isOps(me?.role)) {
    return (
      <DcForm
        key={d.id}
        id={d.id}
        grns={dcGrnOptions(w, d.id, d.grn_id)}
        initial={{
          grn_id: d.grn_id, courier: d.courier ?? "", tracking: d.tracking ?? "", address: d.address ?? "", invoice_no: d.invoice_no ?? "",
          invoice_date: d.invoice_date ?? w.today, dispatched_at: new Date(w.now).toISOString(),
          lines: Object.fromEntries(d.lines.map((l) => [l.style_id, String(l.qty)])),
        }}
      />
    );
  }

  const o = w.orderById.get(d.so_id);
  const cur = w.currencyOf(d.so_id);
  const h = dcHeldHours(w, d);
  return (
    <div className="stack">
      <div className="crumbs">Warehouse › <Link className="link" href="/dc">Delivery challans</Link> › {d.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{d.id} <Chip status={d.status} /> {h != null && <span className={`chip ${h > 24 ? "bad" : "ok"}`}>Held {h < 1 ? "under 1" : Math.round(h)}h</span>}</h1>
          <p>Created by {w.personName(d.created_by)} {fmtDateTime(d.created_at)}{d.dispatched_at && ` · dispatched ${fmtDateTime(d.dispatched_at)}`}</p>
        </div>
      </div>
      <section className="panel">
        <div className="dl">
          <div><span>Sales order</span><b><Link className="link" href={`/orders/${d.so_id}`}>{d.so_id}</Link></b></div>
          <div><span>GRN</span><b><Link className="link" href={`/grn/${d.grn_id}`}>{d.grn_id}</Link></b></div>
          <div><span>Customer</span><b><BuyerCode buyer={w.buyerById.get(o?.buyer_id ?? "")} /></b></div>
          <div><span>Courier</span><b>{d.courier || "—"}</b></div>
          <div><span>Tracking / LR</span><b className="code">{d.tracking || "—"}</b></div>
          <div><span>Invoice</span><b>{d.invoice_no || "—"} · {fmtDay(d.invoice_date)}</b></div>
          <div><span>Value</span><b>{money(w.dcValue(d), cur)}</b></div>
        </div>
        {d.address && <p className="mt-3 text-[12.5px]"><b>Destination:</b> {d.address}</p>}
      </section>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Style</th><th>Colour</th><th>Qty</th><th>Rate</th><th>Value</th></tr></thead>
          <tbody>
            {d.lines.map((l) => {
              const s = w.styleById.get(l.style_id);
              return (
                <tr key={l.id}>
                  <td><b>{s?.name ?? "Style"}</b><br /><span className="code text-muted">{s?.code}</span></td>
                  <td>{s?.colour}</td>
                  <td className="num">{nf(l.qty)}</td>
                  <td className="num">{money(w.rate(l.style_id), cur)}</td>
                  <td className="num">{money(l.qty * w.rate(l.style_id), cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
