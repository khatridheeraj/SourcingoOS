import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fmtDateTime, todayIST } from "@/lib/format";
import { fmtDay, money, nf } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { gmailLink, loadPos, PO_STATUS, poQty, poValue } from "../data";
import { PoActions } from "../po-actions";

export async function generateMetadata({ params }: PageProps<"/pos/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

export default async function PoPage({ params }: PageProps<"/pos/[id]">) {
  const { id } = await params;
  const { me, pos, buyer, error } = await loadPos(id);
  if (!me) redirect("/login");
  if (!isOps(me.role)) redirect("/");
  const p = pos[0];
  if (!p) {
    if (error) return <p className="errbox">Couldn&apos;t load this PO: {error.message}</p>;
    notFound();
  }
  const b = buyer(p.buyer_id);
  const mail = gmailLink(p.email_thread_id);
  const value = poValue(p);
  const unit = p.order_type === "fabric" ? "m" : "pcs";
  const today = todayIST();

  return (
    <div className="stack">
      <div className="crumbs"><Link className="link" href="/pos">POs received</Link> › {p.id}</div>
      <div className="head">
        <div className="grow">
          <h1>PO #{p.po_number} <span className={`chip ${PO_STATUS[p.status][0]}`}>{PO_STATUS[p.status][1]}</span></h1>
          <p>
            {p.status === "converted" ? <>Now sales order <Link className="link" href={`/orders/${p.so_id}`}>{p.so_id}</Link>.</>
              : p.status === "rejected" ? <>Rejected: {p.reject_reason}</>
              : "Check the PO against the email, then convert it to a sales order. Open an inquiry first if it needs follow-up with the buyer."}
          </p>
        </div>
        <PoActions po={p} />
      </div>

      <section className="panel">
        <div className="dl">
          <div><span>Buyer</span><b className="code">{b.code}{b.real_name && ` · ${b.real_name}`}</b></div>
          <div><span>PO date</span><b>{fmtDay(p.po_date)}</b></div>
          <div><span>Delivery date</span><b className={p.delivery_date && p.delivery_date < today && p.status !== "converted" ? "text-bad" : ""}>{fmtDay(p.delivery_date)}</b></div>
          <div><span>Received</span><b>{fmtDateTime(p.received_at)}</b></div>
          <div><span>Order type</span><b>{p.order_type === "fabric" ? "Fabric" : "Garment"}</b></div>
          {p.currency && <div><span>Currency</span><b>{p.currency}</b></div>}
          {p.payment_terms && <div><span>Payment terms</span><b>{p.payment_terms}</b></div>}
          <div><span>From</span><b>{p.sender_name || "—"}{p.sender_email && <> · <a className="link" href={`mailto:${p.sender_email}`}>{p.sender_email}</a></>}</b></div>
          {p.inquiry_id && <div><span>Inquiry</span><b><Link className="link" href={`/inquiries?status=all&q=${encodeURIComponent(p.inquiry_id)}`}>{p.inquiry_id}</Link></b></div>}
          {p.so_id && <div><span>Sales order</span><b><Link className="link" href={`/orders/${p.so_id}`}>{p.so_id}</Link></b></div>}
        </div>
      </section>

      <section className="panel">
        <div className="row">
          <h3 className="grow">Email &amp; attachments</h3>
          {mail && <a className="btn sm" href={mail} target="_blank" rel="noreferrer">Open email in Gmail</a>}
        </div>
        {p.attachments.length ? (
          <div className="list-rows">
            {p.attachments.map((a, i) => <div key={i}><span className="grow">📎 {a}</span></div>)}
          </div>
        ) : <p className="text-muted">No attachments.</p>}
        {mail && p.attachments.length > 0 && <p className="mt-2 text-xs text-muted">Attachments open from the email.</p>}
      </section>

      <section className="panel">
        <h3>Lines</h3>
        {p.lines.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Style</th><th>Colour</th><th>Qty</th><th>Rate</th><th>Value</th></tr></thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td><b>{l.description || "—"}</b>{l.style_code && <><br /><span className="code text-muted">{l.style_code}</span></>}</td>
                    <td>{l.colour || "—"}</td>
                    <td className="num">{l.qty != null && l.qty !== "" ? `${nf(Number(l.qty))} ${unit}` : "—"}</td>
                    <td className="num">{l.rate != null && l.rate !== "" ? money(Number(l.rate), p.currency ?? "INR") : "—"}</td>
                    <td className="num">{l.qty != null && l.rate != null && l.qty !== "" && l.rate !== "" ? money(Number(l.qty) * Number(l.rate), p.currency ?? "INR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {p.lines.length > 1 && (
                <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="num"><b>{nf(poQty(p))} {unit}</b></td><td /><td className="num"><b>{value != null ? money(value, p.currency ?? "INR") : "—"}</b></td></tr></tfoot>
              )}
            </table>
          </div>
        ) : (
          <p className="text-muted">The lines are in the PO attachment. Add them as styles after converting to a sales order.</p>
        )}
      </section>

      {p.notes && (
        <section className="panel">
          <h3>Notes</h3>
          <p className="whitespace-pre-line text-[13px]">{p.notes}</p>
        </section>
      )}
    </div>
  );
}
