import "@/app/trade.css";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, dayAt, qty } from "@/lib/format";
import { todaysFx } from "@/lib/fx";
import { amountInWords, curMoney } from "@/lib/landed";
import { exportGaps, invoiceTotals, startExport, type DocLine } from "@/lib/export-docs";
import { packTotals, type PackRow } from "@/lib/packing";
import { sizeEntries } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../packing/print-button";
import { ExportForm, ExporterFix } from "./export-form";
import { buyerWithDetails } from "@/lib/data";
import { gapsFor } from "@/lib/buyer-profile";
import { loadBuyerFiles } from "@/lib/buyer-profile-load";

const dateIST = (ts: string | null) => (ts ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts)) : null);

// Export papers for one lot: the commercial invoice, the packing list and the shipment sheet a forwarder books from.
// Drawn from the order, the lot and its packing list; the export details are filled in once above them. Buyers never
// see factory names, and none is printed here.
export default async function ExportPage({ params }: PageProps<"/goods/[id]/export">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const { data: d } = await supabase.from("dispatches")
    .select("id, order_id, invoice_no, invoiced_at, shipped_at, cartons, cancelled_at, export").eq("id", id).maybeSingle();
  if (!d || d.cancelled_at) notFound();
  const [{ data: o }, { data: dl }, { data: rows }, { data: co }, fx] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po, po_date, order_lines(id, style, description, colour, qty, sizes, product)").eq("id", d.order_id).maybeSingle(),
    supabase.from("dispatch_lines").select("line_id, qty").eq("dispatch_id", id),
    supabase.from("packing_rows").select("carton_from, carton_to, line_id, sizes, net_kg, gross_kg").eq("dispatch_id", id).is("removed_at", null).order("position"),
    supabase.from("companies").select("name, legal_name, address, gstin, phone, email, iec, ad_code, lut_no, lut_date, export_bank, export_port").eq("id", me.companyId).maybeSingle(),
    todaysFx(),
  ]);
  if (!o) notFound();
  const [{ data: b }, { data: bn }, { data: prices }] = await Promise.all([
    buyerWithDetails<{ id: string; code: string }>(supabase, o.buyer_id, "id, code"),
    supabase.from("buyer_names").select("real_name").eq("buyer_id", o.buyer_id).maybeSingle(),
    // Rates are read through line_prices(), which only the orders team and Accounts get.
    supabase.rpc("line_prices", { p_orders: [o.id] }),
  ]);
  const bf = (await loadBuyerFiles(supabase, [o.buyer_id])).get(o.buyer_id);
  const bp = bf?.profile;
  const rateOf = new Map(((prices ?? []) as { id: string; buyer_rate: number | null }[]).map((p) => [p.id, p.buyer_rate]));
  const buyer = bn?.real_name ?? b?.code ?? "Buyer";
  type L = { id: string; style: string; description: string | null; colour: string | null; qty: number; sizes: Record<string, number> | null; product: string | null };
  const lineOf = new Map(((o.order_lines ?? []) as L[]).map((l) => [l.id, l]));
  const lines: DocLine[] = (dl ?? []).flatMap((x) => {
    const l = lineOf.get(x.line_id);
    return l ? [{ id: l.id, style: l.style, description: l.description, colour: l.colour, product: l.product, qty: Number(x.qty), buyerRate: rateOf.get(l.id) == null ? null : Number(rateOf.get(l.id)) }] : [];
  }).sort((a, b) => a.style.localeCompare(b.style));
  const packed: PackRow[] = (rows ?? []).map((r) => ({ carton_from: r.carton_from, carton_to: r.carton_to, line_id: r.line_id, sizes: r.sizes as Record<string, number>,
    net_kg: r.net_kg == null ? null : Number(r.net_kg), gross_kg: r.gross_kg == null ? null : Number(r.gross_kg) }));
  const pt = packTotals(packed);
  const e = startExport(d.export, { invoiceNo: d.invoice_no, invoiceDate: dateIST(d.invoiced_at), port: co?.export_port ?? null, usdInr: fx.inr.USD ?? null,
    country: bp?.country && !/^india$/i.test(bp.country) ? bp.country : null, buyer: bp ?? null }, lines);
  const t = invoiceTotals(e, lines);
  // The buyer's own details the papers need (its record, src/lib/buyer-profile.ts), then what this lot needs.
  const buyerGaps = bf ? gapsFor("export", bf.profile, bf.basics, bf.docs) : [];
  const gaps = buyerGaps.concat(exportGaps(e, lines, { iec: co?.iec ?? null, ad_code: co?.ad_code ?? null, lut_no: co?.lut_no ?? null, address: co?.address ?? null }, b?.delivery_address ?? null, packed.length > 0).filter((g) => !(buyerGaps.length && g === "The buyer's full address")));
  const owner = me.role === "owner";
  const us = co?.legal_name || co?.name || "Sourcingo";
  const m = (n: number | null) => (n == null ? "—" : curMoney(n, e.currency));
  const allSizes = sizeEntries(Object.fromEntries(packed.flatMap((r) => Object.keys(r.sizes)).map((k) => [k, 1]))).map(([k]) => k);
  const styleOf = new Map(lines.map((l) => [l.id, l]));
  const garments = lines.filter((l) => l.product !== "fabric").reduce((a, l) => a + l.qty, 0);
  const metres = lines.filter((l) => l.product === "fabric").reduce((a, l) => a + l.qty, 0);
  const goodsLine = [garments ? `${qty(garments)} pcs` : "", metres ? `${qty(metres)} m` : ""].filter(Boolean).join(" + ");
  const hsList = [...new Set(lines.map((l) => e.lines[l.id]?.hs).filter(Boolean))].join(", ");
  const cartons = pt.cartons || d.cartons || null;

  const exporter = (
    <div>
      <span className="challan-label">Exporter</span>
      <b className="challan-co">{us}</b>
      {co?.address && <p className="whitespace-pre-line">{co.address}</p>}
      <p>{[co?.gstin && `GSTIN ${co.gstin}`, co?.iec && `IEC ${co.iec}`, co?.ad_code && `AD code ${co.ad_code}`].filter(Boolean).join(" · ")}</p>
      {(co?.phone || co?.email) && <p>{[co?.phone, co?.email].filter(Boolean).join(" · ")}</p>}
    </div>
  );
  const consignee = (
    <div>
      <span className="challan-label">Consignee</span>
      {bp?.consignee ? <p className="whitespace-pre-line">{bp.consignee}</p> : <>
        <b>{bp?.legal_name || buyer}</b>
        {b?.delivery_address ? <p className="whitespace-pre-line">{b.delivery_address}</p> : <p className="text-warn">Address to add</p>}
      </>}
      {bp?.tax_id && <p>Tax no. {bp.tax_id}{bp.eori ? ` · EORI ${bp.eori}` : ""}</p>}
      {e.country && <p>{e.country}</p>}
    </div>
  );
  const refs = (title: string) => (
    <div className="challan-title">
      <h2>{title}</h2>
      <dl>
        <div><dt>Invoice no.</dt><dd className="code">{e.invoice_no || "—"}</dd></div>
        <div><dt>Date</dt><dd>{day(e.invoice_date) || "—"}</dd></div>
        <div><dt>Buyer PO</dt><dd>{o.buyer_po || "—"}{o.po_date ? ` · ${day(o.po_date)}` : ""}</dd></div>
        <div><dt>Our order</dt><dd className="code">{o.order_no}</dd></div>
      </dl>
    </div>
  );

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href="/goods">Goods with us</Link> / <Link href={`/orders/${o.id}#dispatch`}>{o.order_no}</Link></nav>
          <h1>Export papers</h1>
          <p>Commercial invoice, packing list and shipment sheet for this lot to {buyer}. Print them all, or save as PDF from the print box.</p>
        </div>
        <PrintButton />
      </div>

      <div className="exp-docs">
        <div className="no-print grid gap-4">
          {gaps.length > 0 && (
            <div className="exp-missing" role="status">
              <b>Still missing before these go out</b>
              <ul>{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {owner && <ExporterFix dispatchId={d.id} initial={{ iec: co?.iec ?? "", ad_code: co?.ad_code ?? "", lut_no: co?.lut_no ?? "", lut_date: co?.lut_date ?? "", export_bank: co?.export_bank ?? "", export_port: co?.export_port ?? "" }} />}
          <ExportForm dispatchId={d.id} initial={e} lines={lines} fxToday={fx.inr} />
        </div>

        <article className="challan exp-doc" aria-label="Commercial invoice">
          <header className="challan-top">{exporter}{refs("Commercial invoice")}</header>
          <section className="challan-parties">
            {consignee}
            <div>
              <span className="challan-label">Notify party</span>
              <p className="whitespace-pre-line">{e.notify || "Same as consignee"}</p>
            </div>
            <div>
              <span className="challan-label">Shipment</span>
              <dl>
                <div><dt>By</dt><dd>{e.mode === "air" ? "Air" : "Sea"}{e.vessel ? ` · ${e.vessel}` : ""}</dd></div>
                <div><dt>Loading</dt><dd>{e.port_loading || "—"}</dd></div>
                <div><dt>Discharge</dt><dd>{e.port_discharge || "—"}</dd></div>
                <div><dt>Final dest.</dt><dd>{e.final_dest || e.country || "—"}</dd></div>
                <div><dt>Origin</dt><dd>India</dd></div>
                <div><dt>Terms</dt><dd>{e.incoterm}{e.port_loading && e.incoterm === "FOB" ? ` ${e.port_loading}` : e.port_discharge && e.incoterm !== "EXW" ? ` ${e.port_discharge}` : ""}</dd></div>
              </dl>
            </div>
          </section>
          <div className="table-wrap">
            <table className="tbl challan-tbl">
              <thead><tr><th>#</th><th>HS code</th><th>Description of goods</th><th className="tr">Quantity</th><th className="tr">Rate ({e.currency})</th><th className="tr">Amount ({e.currency})</th></tr></thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td className="code">{r.hs || "—"}</td>
                    <td>{[r.description || (r.product === "fabric" ? "Woven fabric" : "Garment"), r.colour].filter(Boolean).join(", ")} <span className="muted">· style {r.style}</span></td>
                    <td className="num tr">{qty(r.qty)} {r.product === "fabric" ? "m" : "pcs"}</td>
                    <td className="num tr">{r.rate == null ? "—" : m(r.rate)}</td>
                    <td className="num tr">{m(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(t.freight > 0 || t.insurance > 0) && <tr><td colSpan={5}>Goods</td><td className="num tr">{m(t.goods)}</td></tr>}
                {t.freight > 0 && <tr><td colSpan={5}>Freight</td><td className="num tr">{m(t.freight)}</td></tr>}
                {t.insurance > 0 && <tr><td colSpan={5}>Insurance</td><td className="num tr">{m(t.insurance)}</td></tr>}
                <tr><td colSpan={3}>Total {e.incoterm}{cartons ? ` · ${cartons} cartons` : ""}</td><td className="num tr">{goodsLine}</td><td /><td className="num tr">{m(t.total)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="challan-amt"><b>Amount in words:</b> {t.total > 0 ? amountInWords(t.total, e.currency) : "—"}</p>
          <div className="challan-two">
            <div>
              <span className="challan-label">Packages</span>
              <p>{cartons ? `${cartons} cartons` : "—"}{pt.net ? ` · net ${pt.net.toFixed(1)} kg` : ""}{pt.gross ? ` · gross ${pt.gross.toFixed(1)} kg` : ""}{e.cbm ? ` · ${e.cbm} CBM` : ""}</p>
              {e.terms && <><span className="challan-label mt-2">Payment</span><p>{e.terms}</p></>}
            </div>
            <div>
              <span className="challan-label">Bank details</span>
              <p className="whitespace-pre-line">{co?.export_bank || "—"}</p>
            </div>
          </div>
          <p className="challan-decl">
            {co?.lut_no ? `Supply meant for export under LUT ARN ${co.lut_no}${co.lut_date ? ` dated ${day(co.lut_date)}` : ""} without payment of IGST. ` : "Supply meant for export. "}
            We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Country of origin of goods: India.
          </p>
          <footer className="challan-sign">
            <div><span>Buyer&apos;s acceptance</span><i /><small>Name, signature and date</small></div>
            <div><span>For {us}</span><i /><small>Authorised signatory</small></div>
          </footer>
        </article>

        <article className="challan exp-doc" aria-label="Packing list">
          <header className="challan-top">{exporter}{refs("Packing list")}</header>
          <section className="challan-parties">
            {consignee}
            <div>
              <span className="challan-label">Shipping marks</span>
              <p className="whitespace-pre-line">{e.marks || `${buyer}\nPO ${o.buyer_po || o.order_no}\nCarton no. 1 to ${cartons ?? "N"}`}</p>
            </div>
            <div>
              <span className="challan-label">Totals</span>
              <dl>
                <div><dt>Cartons</dt><dd className="num">{cartons ?? "—"}</dd></div>
                <div><dt>Pieces</dt><dd className="num">{pt.pcs ? qty(pt.pcs) : "—"}</dd></div>
                <div><dt>Net kg</dt><dd className="num">{pt.net ? pt.net.toFixed(1) : "—"}</dd></div>
                <div><dt>Gross kg</dt><dd className="num">{pt.gross ? pt.gross.toFixed(1) : "—"}</dd></div>
              </dl>
            </div>
          </section>
          {packed.length === 0 ? (
            <p className="text-warn">No cartons yet. <Link href={`/goods/${d.id}/packing`} className="link no-print">Make the packing list</Link> and it prints here.</p>
          ) : (
            <div className="table-wrap">
              <table className="tbl challan-tbl">
                <thead><tr>
                  <th>Cartons</th><th className="tr">No.</th><th>Style</th><th>Colour</th>
                  {allSizes.map((s) => <th key={s} className="tr">{s}</th>)}
                  <th className="tr">Pcs / ctn</th><th className="tr">Total pcs</th><th className="tr">Net kg</th><th className="tr">Gross kg</th>
                </tr></thead>
                <tbody>
                  {packed.map((r, i) => {
                    const n = r.carton_to - r.carton_from + 1, per = Object.values(r.sizes).reduce((a, x) => a + x, 0);
                    return (
                      <tr key={i}>
                        <td className="nw">{r.carton_from === r.carton_to ? r.carton_from : `${r.carton_from} – ${r.carton_to}`}</td>
                        <td className="num tr">{n}</td>
                        <td className="code">{styleOf.get(r.line_id)?.style ?? "—"}</td>
                        <td>{styleOf.get(r.line_id)?.colour || "—"}</td>
                        {allSizes.map((s) => <td key={s} className="num tr">{r.sizes[s] ? qty(r.sizes[s]) : ""}</td>)}
                        <td className="num tr">{qty(per)}</td>
                        <td className="num tr">{qty(per * n)}</td>
                        <td className="num tr">{r.net_kg != null ? (r.net_kg * n).toFixed(1) : ""}</td>
                        <td className="num tr">{r.gross_kg != null ? (r.gross_kg * n).toFixed(1) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td><td className="num tr">{pt.cartons}</td><td colSpan={2 + allSizes.length + 1} />
                    <td className="num tr">{qty(pt.pcs)}</td>
                    <td className="num tr">{pt.net ? pt.net.toFixed(1) : ""}</td><td className="num tr">{pt.gross ? pt.gross.toFixed(1) : ""}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <footer className="challan-sign"><div /><div><span>For {us}</span><i /><small>Authorised signatory</small></div></footer>
        </article>

        <article className="challan exp-doc" aria-label="Shipment sheet">
          <header className="challan-top">
            <div><span className="challan-label">Booking request from</span><b className="challan-co">{us}</b>{co?.phone || co?.email ? <p>{[co?.phone, co?.email].filter(Boolean).join(" · ")}</p> : null}</div>
            <div className="challan-title">
              <h2>Shipment sheet</h2>
              <dl>
                <div><dt>To</dt><dd>{e.forwarder || "Forwarder"}</dd></div>
                <div><dt>Our ref.</dt><dd className="code">{o.order_no}{e.invoice_no ? ` · ${e.invoice_no}` : ""}</dd></div>
                <div><dt>Prepared</dt><dd>{dayAt(new Date().toISOString())}</dd></div>
              </dl>
            </div>
          </header>
          <div className="table-wrap">
            <table className="tbl challan-tbl">
              <tbody>
                <tr><th>Shipper</th><td>{us}{co?.iec ? ` · IEC ${co.iec}` : ""}</td></tr>
                <tr><th>Consignee</th><td className="whitespace-pre-line">{buyer}{b?.delivery_address ? `\n${b.delivery_address}` : ""}</td></tr>
                <tr><th>Notify</th><td className="whitespace-pre-line">{e.notify || "Same as consignee"}</td></tr>
                <tr><th>Mode</th><td>{e.mode === "air" ? "Air" : "Sea"}{e.container ? ` · ${e.container}` : ""}</td></tr>
                <tr><th>Port of loading</th><td>{e.port_loading || "—"}</td></tr>
                <tr><th>Port of discharge</th><td>{e.port_discharge || "—"}{e.final_dest ? ` · final destination ${e.final_dest}` : ""}{e.country ? `, ${e.country}` : ""}</td></tr>
                <tr><th>Incoterm</th><td>{e.incoterm} · {e.incoterm === "FOB" || e.incoterm === "FCA" || e.incoterm === "EXW" ? "freight payable at destination" : "freight prepaid"}</td></tr>
                <tr><th>Goods</th><td>{lines.some((l) => l.product !== "fabric") ? "Readymade garments" : "Woven fabric"}, made in India · {goodsLine}{hsList ? ` · HS ${hsList}` : ""}</td></tr>
                <tr><th>Packages</th><td className="num">{cartons ? `${cartons} cartons` : "—"}{pt.gross ? ` · gross ${pt.gross.toFixed(1)} kg` : ""}{pt.net ? ` · net ${pt.net.toFixed(1)} kg` : ""}{e.cbm ? ` · ${e.cbm} CBM` : ""}</td></tr>
                <tr><th>Invoice value</th><td className="num">{t.total > 0 ? `${m(t.total)} ${e.incoterm}` : "—"}</td></tr>
                <tr><th>Goods ready</th><td>{e.etd ? day(e.etd) : "—"}{e.vessel ? ` · ${e.vessel}` : ""}</td></tr>
                <tr><th>Papers with goods</th><td>Commercial invoice, packing list{co?.lut_no ? ", LUT copy" : ""}; shipping bill filed against IEC {co?.iec ?? "—"}{co?.ad_code ? `, AD code ${co.ad_code}` : ""}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="challan-note">Please confirm the booking, cut-off and freight on this sheet. Marks: {e.marks ? e.marks.replace(/\n/g, " / ") : `${buyer} / PO ${o.buyer_po || o.order_no}`}.</p>
        </article>
      </div>
    </>
  );
}
