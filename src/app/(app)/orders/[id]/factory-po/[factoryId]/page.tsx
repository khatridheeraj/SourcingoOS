import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { day, dayAt, money, qty } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { sizeEntries } from "@/lib/sizes";
import { createClient } from "@/lib/supabase/server";
import { PrintPo } from "./print-po";

type Line = { id: string; style: string; description: string | null; colour: string | null; qty: number; fabric: string | null; sizes: Record<string, number> | null; factory_id: string | null; position: number };

// The steps a factory is held to, shown on its PO.
const KEY_STEPS = [
  { key: "fit_sample", label: "Fit sample" },
  { key: "pp_sample", label: "PP sample" },
  { key: "size_set", label: "Size set" },
  { key: "final_qc", label: "Final QC" },
  { key: "ex_factory", label: "Ex-factory" },
];

// Our purchase order to one factory for its styles of an order: printed, or saved as a PDF to send on WhatsApp.
// It never names the buyer or the buyer's rates.
export default async function FactoryPoPage({ params }: PageProps<"/orders/[id]/factory-po/[factoryId]">) {
  const { id, factoryId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(factoryId)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const [{ data: o }, { data: f }, { data: pos }, { data: co }, { data: prices }] = await Promise.all([
    supabase.from("orders").select("id, order_no, ship_date, revised_ship_date, status, order_lines(id, style, description, colour, qty, fabric, sizes, factory_id, position)")
      .eq("id", id).is("order_lines.removed_at", null).maybeSingle(),
    supabase.from("factories").select("id, name, city, contact_name, phone, tally_ledger").eq("id", factoryId).maybeSingle(),
    supabase.from("factory_pos").select("factory_id, released_at, buffer_days, created_at").eq("order_id", id).order("created_at"),
    supabase.from("companies").select("name, address, gstin").eq("id", me.companyId).maybeSingle(),
    supabase.rpc("line_prices", { p_orders: [id] }),
  ]);
  if (!o || !f) notFound();
  const lines = ((o.order_lines ?? []) as Line[]).filter((l) => l.factory_id === factoryId).sort((a, b) => a.position - b.position);
  if (!lines.length) notFound();
  const [{ data: stages }, { data: terms }] = await Promise.all([
    supabase.from("line_stages").select("line_id, stage, planned_on, not_needed").in("line_id", lines.map((l) => l.id)).in("stage", KEY_STEPS.map((s) => s.key)),
    // Payment terms are kept per Tally ledger and only Accounts and the owner can read them; everyone else sees the usual 60 days.
    f.tally_ledger ? supabase.from("supplier_terms").select("days").eq("ledger", f.tally_ledger).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const po = (pos ?? []).find((p) => p.factory_id === factoryId);
  // One factory keeps the order's number; with several, each gets its own in the order they were added.
  const n = (pos ?? []).findIndex((p) => p.factory_id === factoryId);
  const poNo = (pos ?? []).length > 1 && n >= 0 ? `${o.order_no}-${n + 1}` : o.order_no;
  const due = o.revised_ship_date || o.ship_date;
  const readyBy = due && po?.buffer_days != null ? new Date(Date.parse(due) - po.buffer_days * 86_400_000).toISOString().slice(0, 10) : null;
  const rateOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p.factory_rate == null ? null : Number(p.factory_rate)]));
  const rows = lines.map((l) => ({ ...l, rate: rateOf.get(l.id) ?? null }));
  const pcs = rows.reduce((t, r) => t + r.qty, 0);
  const priced = rows.every((r) => r.rate != null);
  const value = rows.reduce((t, r) => t + r.qty * (r.rate ?? 0), 0);
  const planned = (lineId: string, step: string) => {
    const s = (stages ?? []).find((x) => x.line_id === lineId && x.stage === step);
    return s?.not_needed ? "Not needed" : s?.planned_on ? day(s.planned_on).replace(/ \d{4}$/, "") : "—";
  };
  const days = terms?.days ?? 60;
  const released = !!po?.released_at;

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href={`/orders/${o.id}`}>{o.order_no}</Link><span aria-hidden>/</span><span>Factory PO</span></nav>
          <h1>Purchase order to {f.name}</h1>
          <p>{released ? `Released ${dayAt(po!.released_at)}. Print it, or save it as a PDF and send it to the factory on WhatsApp.`
            : "Draft: this PO isn't locked and released yet, so it prints marked as a draft."}</p>
        </div>
        <PrintPo />
      </div>

      <article className="challan">
        <header className="challan-top">
          <div>
            <b className="challan-co">{co?.name}</b>
            {co?.address && <p className="whitespace-pre-line">{co.address}</p>}
            {co?.gstin && <p>GSTIN {co.gstin}</p>}
          </div>
          <div className="challan-title">
            <h2>{released ? "Purchase order" : "Purchase order · Draft"}</h2>
            <dl>
              <div><dt>PO no.</dt><dd className="code">{poNo}</dd></div>
              <div><dt>Date</dt><dd>{released ? dayAt(po!.released_at) : "Not released yet"}</dd></div>
              <div><dt>Ready by</dt><dd>{readyBy ? day(readyBy) : "—"}</dd></div>
            </dl>
          </div>
        </header>

        <section className="challan-parties">
          <div>
            <span className="challan-label">To</span>
            <b>{f.name}</b>
            {f.city && <p>{f.city}</p>}
            {(f.contact_name || f.phone) && <p>{[f.contact_name, f.phone].filter(Boolean).join(" · ")}</p>}
          </div>
          <div>
            <span className="challan-label">Order</span>
            <dl>
              <div><dt>Styles</dt><dd>{rows.length}</dd></div>
              <div><dt>Pieces</dt><dd className="num">{qty(pcs)}</dd></div>
              <div><dt>Value</dt><dd className="num">{priced ? money(value) : "Rates to be confirmed"}</dd></div>
            </dl>
          </div>
        </section>

        <div className="table-wrap">
          <table className="tbl challan-tbl">
            <thead><tr><th>#</th><th>Style</th><th>Description</th><th>Colour</th><th>Fabric</th><th>Sizes</th><th className="text-right">Pieces</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
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
                    <td className="num text-right">{qty(r.qty)}</td>
                    <td className="num text-right">{r.rate == null ? "—" : money(r.rate)}</td>
                    <td className="num text-right">{r.rate == null ? "—" : money(r.qty * r.rate)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>Total</td><td className="num text-right">{qty(pcs)}</td><td /><td className="num text-right">{priced ? money(value) : "—"}</td></tr>
            </tfoot>
          </table>
        </div>

        {(stages ?? []).some((s) => s.planned_on) && <div>
          <span className="challan-label">Key dates</span>
          <div className="table-wrap">
            <table className="tbl challan-tbl">
              <thead><tr><th>Style</th>{KEY_STEPS.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}><td className="code">{r.style}</td>{KEY_STEPS.map((s) => <td key={s.key}>{planned(r.id, s.key)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}

        <div>
          <span className="challan-label">Terms</span>
          <ol className="po-terms">
            <li>Rates are per piece, before GST. GST is charged as applicable on the bill.</li>
            <li>Payment {days} days from the date of your bill, against goods received in full and in good condition.</li>
            <li>Every style must pass our final QC before it leaves the factory.</li>
            <li>Keep to the dates above and update each step in your Sourcingo factory panel with photos. Tell us at once if any date will slip.</li>
            <li>Quote PO no. {poNo} and the style numbers on your bill and packing list.</li>
          </ol>
        </div>

        <footer className="challan-sign">
          <div>
            <span>Accepted by {f.name}</span>
            <i />
            <small>Name, signature and stamp · Date</small>
          </div>
          <div>
            <span>For {co?.name}</span>
            <i />
            <small>Authorised signatory</small>
          </div>
        </footer>
      </article>
    </>
  );
}
