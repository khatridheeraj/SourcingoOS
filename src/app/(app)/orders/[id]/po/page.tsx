import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, dayAt, money, qty, qtyTotal, qtyU } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { sizeEntries } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";
import { PrintPo } from "../factory-po/[factoryId]/print-po";

type Line = { id: string; style: string; description: string | null; colour: string | null; qty: number; fabric: string | null; sizes: Record<string, number> | null; position: number; product: string };

// The buyer's PO made straight from the order as entered in the app, for POs that came on WhatsApp or by phone:
// print it, or save it as a PDF and send it to the buyer to confirm. Factories are never named on it.
export default async function OrderPoPage({ params }: PageProps<"/orders/[id]/po">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const [{ data: o }, { data: co }, { data: prices }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po, po_date, ship_date, buyer_terms, created_at, order_lines(id, style, description, colour, qty, fabric, sizes, position, product)")
      .eq("id", id).is("order_lines.removed_at", null).maybeSingle(),
    supabase.from("companies").select("name, address, gstin").eq("id", me.companyId).maybeSingle(),
    supabase.rpc("line_prices", { p_orders: [id] }),
  ]);
  if (!o) notFound();
  const [{ data: b }, { data: bn }] = await Promise.all([
    supabase.from("buyers").select("code, city, delivery_address, credit_days").eq("id", o.buyer_id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", o.buyer_id).maybeSingle(),
  ]);
  const buyer = bn?.real_name ?? b?.code ?? "Buyer";
  const rateOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p.buyer_rate == null ? null : Number(p.buyer_rate)]));
  const rows = ((o.order_lines ?? []) as Line[]).sort((a, c) => a.position - c.position).map((l) => ({ ...l, rate: rateOf.get(l.id) ?? null }));
  const total = qtyTotal(rows);
  const priced = rows.length > 0 && rows.every((r) => r.rate != null);
  const value = rows.reduce((t, r) => t + r.qty * (r.rate ?? 0), 0);

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href={`/orders/${o.id}`}>{o.order_no}</Link><span aria-hidden>/</span><span>PO PDF</span></nav>
          <h1>PO {o.buyer_po} · {buyer}</h1>
          <p>Made from the order as entered here. Print it, or save it as a PDF and send it to the buyer to confirm. Change anything in the order&apos;s Details first.</p>
        </div>
        <PrintPo />
      </div>

      <article className="challan">
        <header className="challan-top">
          <div>
            <b className="challan-co">{buyer}</b>
            {b?.delivery_address ? <p className="whitespace-pre-line">{b.delivery_address}</p> : b?.city ? <p>{b.city}</p> : null}
          </div>
          <div className="challan-title">
            <h2>Purchase order</h2>
            <dl>
              <div><dt>PO no.</dt><dd className="code">{o.buyer_po}</dd></div>
              <div><dt>PO date</dt><dd>{day(o.po_date) || dayAt(o.created_at)}</dd></div>
              <div><dt>Ship by</dt><dd>{o.ship_date ? day(o.ship_date) : "—"}</dd></div>
            </dl>
          </div>
        </header>

        <section className="challan-parties">
          <div>
            <span className="challan-label">Supplier</span>
            <b>{co?.name}</b>
            {co?.address && <p className="whitespace-pre-line">{co.address}</p>}
            {co?.gstin && <p>GSTIN {co.gstin}</p>}
          </div>
          <div>
            <span className="challan-label">Order</span>
            <dl>
              <div><dt>Our order</dt><dd className="code">{o.order_no}</dd></div>
              <div><dt>Quantity</dt><dd className="num">{total}</dd></div>
              <div><dt>Value</dt><dd className="num">{priced ? money(value) : "Rates to be confirmed"}</dd></div>
            </dl>
          </div>
        </section>

        <div className="table-wrap">
          <table className="tbl challan-tbl">
            <thead><tr><th>#</th><th>Style</th><th>Description</th><th>Colour</th><th>Fabric</th><th>Sizes</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const sizes = sizeEntries(r.sizes);
                return (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td className="code">{r.style}</td>
                    <td>{r.description || "—"}</td>
                    <td>{r.colour || "—"}</td>
                    <td>{r.fabric || "—"}</td>
                    <td>{sizes.length ? sizes.map(([s, n], j) => <span key={s} className="nw">{j > 0 && " · "}{s} {qty(n)}</span>) : "—"}</td>
                    <td className="num text-right nw">{qtyU(r.qty, r.product)}</td>
                    <td className="num text-right">{r.rate == null ? "—" : money(r.rate)}</td>
                    <td className="num text-right">{r.rate == null ? "—" : money(r.qty * r.rate)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>Total</td><td className="num text-right nw">{total}</td><td /><td className="num text-right">{priced ? money(value) : "—"}</td></tr>
            </tfoot>
          </table>
        </div>

        <div>
          <span className="challan-label">Terms</span>
          <ol className="po-terms">
            <li>Rates are per piece, before GST. GST is charged as applicable on the invoice.</li>
            {b?.credit_days != null && <li>Payment {b.credit_days} days from the invoice date.</li>}
            {o.buyer_terms && <li className="whitespace-pre-line">{o.buyer_terms}</li>}
            <li>Quote PO no. {o.buyer_po} on every communication about this order.</li>
          </ol>
        </div>

        <footer className="challan-sign">
          <div>
            <span>For {buyer}</span>
            <i />
            <small>Name, signature and stamp · Date</small>
          </div>
          <div>
            <span>Accepted for {co?.name}</span>
            <i />
            <small>Authorised signatory</small>
          </div>
        </footer>
      </article>
    </>
  );
}
