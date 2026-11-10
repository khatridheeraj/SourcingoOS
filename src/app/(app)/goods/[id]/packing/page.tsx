import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { dayAt, qty } from "@/lib/format";
import { sizeEntries } from "@/lib/sizes";
import { packTotals, type PackRow, type PackStyle } from "@/lib/packing";
import { createClient } from "@/lib/supabase/server";
import { PackingEditor } from "./packing-editor";
import { PrintButton } from "./print-button";

// The packing list for one lot: carton by carton, which style and how many of each size. It goes with the goods
// beside the delivery challan, and the buyer's warehouse checks each carton against it.
export default async function PackingPage({ params }: PageProps<"/goods/[id]/packing">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { data: d } = await supabase.from("dispatches").select("id, order_id, invoice_no, challan_no, shipped_at, invoiced_at, cartons, cancelled_at").eq("id", id).maybeSingle();
  if (!d || d.cancelled_at) notFound();
  const [{ data: o }, { data: dl }, { data: rows }, { data: co }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po, order_lines(id, style, colour, qty, sizes, product)").eq("id", d.order_id).maybeSingle(),
    supabase.from("dispatch_lines").select("line_id, qty").eq("dispatch_id", id),
    supabase.from("packing_rows").select("carton_from, carton_to, line_id, sizes, net_kg, gross_kg").eq("dispatch_id", id).is("removed_at", null).order("position"),
    supabase.from("companies").select("name, legal_name").eq("id", me.companyId).maybeSingle(),
  ]);
  if (!o) notFound();
  const [{ data: b }, { data: bn }] = await Promise.all([
    supabase.from("buyers").select("code").eq("id", o.buyer_id).maybeSingle(),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", o.buyer_id).maybeSingle(),
  ]);
  const lineOf = new Map((o.order_lines ?? []).map((l) => [l.id, l]));
  // Garments only: fabric goes by the roll and the metre, which a carton list doesn't describe.
  const styles: PackStyle[] = (dl ?? []).map((x) => lineOf.get(x.line_id) && { ...lineOf.get(x.line_id)!, sent: x.qty }).filter((l) => !!l && l.product !== "fabric")
    .map((l) => ({ id: l!.id, style: l!.style, colour: l!.colour, sent: Number(l!.sent), sizes: sizeEntries(l!.sizes as Record<string, number> | null).map(([s]) => s) }))
    .sort((a, b) => a.style.localeCompare(b.style));
  const saved: PackRow[] = (rows ?? []).map((r) => ({ carton_from: r.carton_from, carton_to: r.carton_to, line_id: r.line_id, sizes: r.sizes as Record<string, number>,
    net_kg: r.net_kg == null ? null : Number(r.net_kg), gross_kg: r.gross_kg == null ? null : Number(r.gross_kg) }));
  const t = packTotals(saved);
  const styleOf = new Map(styles.map((s) => [s.id, s]));
  const allSizes = sizeEntries(Object.fromEntries(saved.flatMap((r) => Object.keys(r.sizes)).map((k) => [k, 1]))).map(([k]) => k);
  const buyer = bn?.real_name ?? b?.code ?? "Buyer";

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/goods">Goods with us</Link> / <Link href={`/orders/${o.id}#dispatch`}>{o.order_no}</Link></nav>
          <h1>Packing list</h1>
          <p>Each row is a run of identical cartons. Print it with the <Link href={`/goods/${d.id}/challan`} className="link">delivery challan</Link>; the buyer checks every carton against it.</p>
        </div>
        {saved.length > 0 && <PrintButton />}
      </div>

      {styles.length === 0 ? (
        <p className="card card-empty">This lot has only fabric, which goes by the roll. A packing list is for garments in cartons.</p>
      ) : (
        <div className="no-print"><PackingEditor dispatchId={d.id} styles={styles} initial={saved} /></div>
      )}

      {saved.length > 0 && (
        <article className="challan pack-print">
          <header className="challan-top">
            <div><b className="challan-co">{co?.legal_name || co?.name}</b><p>Packing list</p></div>
            <div className="challan-title">
              <dl>
                <div><dt>Buyer</dt><dd>{buyer}</dd></div>
                <div><dt>Buyer PO</dt><dd>{o.buyer_po || "—"}</dd></div>
                <div><dt>Our order</dt><dd className="code">{o.order_no}</dd></div>
                <div><dt>Invoice</dt><dd>{d.invoice_no || "—"}</dd></div>
                {d.challan_no && <div><dt>Challan</dt><dd>{d.challan_no}</dd></div>}
                <div><dt>Date</dt><dd>{dayAt(d.shipped_at ?? d.invoiced_at) || "—"}</dd></div>
              </dl>
            </div>
          </header>
          <div className="table-wrap">
            <table className="tbl challan-tbl">
              <thead><tr>
                <th>Cartons</th><th className="text-right">No. of cartons</th><th>Style</th><th>Colour</th>
                {allSizes.map((s) => <th key={s} className="text-right">{s}</th>)}
                <th className="text-right">Pcs / carton</th><th className="text-right">Total pcs</th><th className="text-right">Net kg</th><th className="text-right">Gross kg</th>
              </tr></thead>
              <tbody>
                {saved.map((r, i) => {
                  const n = r.carton_to - r.carton_from + 1, per = Object.values(r.sizes).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={i}>
                      <td className="nw">{r.carton_from === r.carton_to ? r.carton_from : `${r.carton_from} – ${r.carton_to}`}</td>
                      <td className="num text-right">{n}</td>
                      <td className="code">{styleOf.get(r.line_id)?.style ?? "—"}</td>
                      <td>{styleOf.get(r.line_id)?.colour || "—"}</td>
                      {allSizes.map((s) => <td key={s} className="num text-right">{r.sizes[s] ? qty(r.sizes[s]) : ""}</td>)}
                      <td className="num text-right">{qty(per)}</td>
                      <td className="num text-right">{qty(per * n)}</td>
                      <td className="num text-right">{r.net_kg != null ? (r.net_kg * n).toFixed(1) : ""}</td>
                      <td className="num text-right">{r.gross_kg != null ? (r.gross_kg * n).toFixed(1) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td><td className="num text-right">{t.cartons}</td><td colSpan={2 + allSizes.length + 1} />
                  <td className="num text-right">{qty(t.pcs)}</td>
                  <td className="num text-right">{t.net ? t.net.toFixed(1) : ""}</td><td className="num text-right">{t.gross ? t.gross.toFixed(1) : ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="challan-note">Weights per row are for all cartons in the run. {qty(t.pcs)} pieces in {t.cartons} cartons.</p>
        </article>
      )}
    </>
  );
}
