import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, dayAt, qty } from "@/lib/format";
import { sizeEntries } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";
import { AddressFix, ChallanBar } from "./challan-tools";

type Line = { id: string; style: string; description: string | null; colour: string | null; qty: number; sizes: Record<string, number> | null };

// The delivery challan for one lot of goods: a packing list that travels with the goods and the buyer signs for.
export default async function ChallanPage({ params }: PageProps<"/goods/[id]/challan">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { data: d } = await supabase.from("dispatches")
    .select("id, order_id, factory_id, purchase_bill_no, invoice_no, invoiced_at, eway_bill_no, transporter, vehicle_no, lr_no, lr_date, cartons, shipped_at, challan_no, challan_at, cancelled_at")
    .eq("id", id).maybeSingle();
  if (!d || d.cancelled_at) notFound();
  const [{ data: o }, { data: dl }, { data: co }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po, po_date, order_lines(id, style, description, colour, qty, sizes)").eq("id", d.order_id).maybeSingle(),
    supabase.from("dispatch_lines").select("line_id, qty").eq("dispatch_id", id),
    supabase.from("companies").select("name, address, gstin").eq("id", me.companyId).maybeSingle(),
  ]);
  if (!o) notFound();
  const [{ data: b }, { data: bn }] = await Promise.all([
    supabase.from("buyers").select("id, code, city, delivery_address").eq("id", o.buyer_id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", o.buyer_id).maybeSingle(),
  ]);
  const buyer = bn?.real_name ?? b?.code ?? "Buyer";
  const lineOf = new Map(((o.order_lines ?? []) as Line[]).map((l) => [l.id, l]));
  const rows = (dl ?? []).map((x) => ({ ...lineOf.get(x.line_id)!, sent: x.qty })).filter((r) => r.id).sort((a, b) => a.style.localeCompare(b.style));
  const total = rows.reduce((s, r) => s + r.sent, 0);
  const owner = me.role === "owner";

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/goods">Goods with us</Link> / <Link href={`/orders/${o.id}#dispatch`}>{o.order_no}</Link></nav>
          <h1>Delivery challan</h1>
          <p>{d.challan_no ? `${d.challan_no}, numbered ${dayAt(d.challan_at)}. Print two copies: one goes with the goods, the buyer signs and returns the other.`
            : "Give it a number first. The number is kept, so printing again later shows the same challan."}</p>
        </div>
        <ChallanBar dispatchId={d.id} challanNo={d.challan_no} />
      </div>

      <article className="challan">
        <header className="challan-top">
          <div>
            <b className="challan-co">{co?.name}</b>
            {co?.address ? <p className="whitespace-pre-line">{co.address}</p> : <p className="text-warn no-print">{owner ? "Add our address and GSTIN once." : "The owner adds our address and GSTIN once."}</p>}
            {co?.gstin && <p>GSTIN {co.gstin}</p>}
            {owner && <AddressFix dispatchId={d.id} kind="company" id={me.companyId} address={co?.address ?? ""} gstin={co?.gstin ?? ""} />}
          </div>
          <div className="challan-title">
            <h2>Delivery challan</h2>
            <dl>
              <div><dt>Challan no.</dt><dd className="code">{d.challan_no ?? "Not numbered yet"}</dd></div>
              <div><dt>Date</dt><dd>{dayAt(d.challan_at ?? d.shipped_at ?? d.invoiced_at) || "—"}</dd></div>
              <div><dt>Our order</dt><dd className="code">{o.order_no}</dd></div>
            </dl>
          </div>
        </header>

        <section className="challan-parties">
          <div>
            <span className="challan-label">Deliver to</span>
            <b>{buyer}</b>
            {b?.delivery_address ? <p className="whitespace-pre-line">{b.delivery_address}</p> : b?.city ? <p>{b.city}</p> : null}
            {b && <AddressFix dispatchId={d.id} kind="buyer" id={b.id} address={b.delivery_address ?? ""} />}
          </div>
          <div>
            <span className="challan-label">Against</span>
            <dl>
              <div><dt>Buyer PO</dt><dd>{o.buyer_po || "—"}{o.po_date ? ` · ${day(o.po_date)}` : ""}</dd></div>
              <div><dt>Invoice</dt><dd>{d.invoice_no || "—"}</dd></div>
              <div><dt>E-way bill</dt><dd>{d.eway_bill_no || "—"}</dd></div>
            </dl>
          </div>
          <div>
            <span className="challan-label">Transport</span>
            <dl>
              <div><dt>Transporter</dt><dd>{d.transporter || "—"}</dd></div>
              <div><dt>Vehicle</dt><dd>{d.vehicle_no || "—"}</dd></div>
              <div><dt>LR</dt><dd>{d.lr_no ? `${d.lr_no}${d.lr_date ? ` · ${day(d.lr_date)}` : ""}` : "—"}</dd></div>
            </dl>
          </div>
        </section>

        <div className="table-wrap">
          <table className="tbl challan-tbl">
            <thead><tr><th>#</th><th>Style</th><th>Description</th><th>Colour</th><th>Sizes</th><th className="text-right">Pieces</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                // The size split is the style's; it applies only when the whole style goes in this lot.
                const sizes = r.sent === r.qty ? sizeEntries(r.sizes) : [];
                return (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td className="code">{r.style}</td>
                    <td>{r.description || "—"}</td>
                    <td>{r.colour || "—"}</td>
                    <td>{sizes.length ? sizes.map(([s, n]) => `${s} ${qty(n)}`).join(" · ") : "—"}</td>
                    <td className="num text-right">{qty(r.sent)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>Total{d.cartons ? ` · ${d.cartons} cartons` : ""}</td><td className="num text-right">{qty(total)}</td></tr>
            </tfoot>
          </table>
        </div>

        <footer className="challan-sign">
          <div>
            <span>Received the above goods in good condition</span>
            <i />
            <small>Receiver&apos;s name, signature and stamp · Date</small>
          </div>
          <div>
            <span>For {co?.name}</span>
            <i />
            <small>Authorised signatory</small>
          </div>
        </footer>
        <p className="challan-note">Goods move against tax invoice {d.invoice_no || "to follow"}. This challan is a delivery and packing record, not a bill.</p>
      </article>
    </>
  );
}
