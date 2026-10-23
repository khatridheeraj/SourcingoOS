import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { FACTORY_PO_TERMS } from "@/lib/factory-po-terms";
import { dayAt, money, qty, todayIST } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { sizeEntries } from "@/lib/sizes";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { PoDetailsForm } from "./po-details";
import { PrintPo } from "./print-po";

type Line = { id: string; style: string; description: string | null; colour: string | null; qty: number; fabric: string | null; sizes: Record<string, number> | null; factory_id: string | null; position: number; photo_path: string | null };

// The steps a factory is held to, shown on its PO.
const KEY_STEPS = [
  { key: "fit_sample", label: "Fit sample" },
  { key: "pp_sample", label: "PP sample" },
  { key: "size_set", label: "Size set" },
  { key: "final_qc", label: "Final QC" },
  { key: "ex_factory", label: "Ex-factory" },
];

// Dates on the PO read the way the team writes them by hand: 15/11/26.
const istDay = (ts: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ts));
const short = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "");

// Our purchase order to one factory for its styles of an order, in Sourcingo's own PO format, with the vendor
// agreement summed up as its terms: printed, or saved as a PDF to send on WhatsApp. It never names the buyer.
export default async function FactoryPoPage({ params }: PageProps<"/orders/[id]/factory-po/[factoryId]">) {
  const { id, factoryId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(factoryId)) notFound();
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const supabase = await createClient();
  const [{ data: o }, { data: f }, { data: pos }, { data: co }, { data: prices }, { data: withPo }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_po, ship_date, revised_ship_date, status, order_lines(id, style, description, colour, qty, fabric, sizes, factory_id, position, photo_path)")
      .eq("id", id).is("order_lines.removed_at", null).maybeSingle(),
    supabase.from("factories").select("id, name, city, contact_name, phone, tally_ledger, address, gstin, email").eq("id", factoryId).maybeSingle(),
    supabase.from("factory_pos").select("factory_id, released_at, buffer_days, created_at, po_no, delivery_note").eq("order_id", id).order("created_at"),
    supabase.from("companies").select("name, legal_name, address, ship_address, gstin, phone, email").eq("id", me.companyId).maybeSingle(),
    supabase.rpc("line_prices", { p_orders: [id] }),
    supabase.rpc("orders_with_po_file", { p_orders: [id] }),
  ]);
  if (!o || !f) notFound();
  const hasBuyerPo = ((withPo ?? []) as string[]).includes(id);
  const lines = ((o.order_lines ?? []) as Line[]).filter((l) => l.factory_id === factoryId).sort((a, b) => a.position - b.position);
  if (!lines.length) notFound();
  const photoPaths = lines.map((l) => l.photo_path).filter(Boolean) as string[];
  const [{ data: stages }, { data: terms }, { data: signed }, { data: ledger }] = await Promise.all([
    supabase.from("line_stages").select("line_id, stage, planned_on, not_needed").in("line_id", lines.map((l) => l.id)).in("stage", KEY_STEPS.map((s) => s.key)),
    // Payment terms are kept per Tally ledger and only Accounts and the owner can read them; everyone else sees the usual 60 days.
    f.tally_ledger ? supabase.from("supplier_terms").select("days").eq("ledger", f.tally_ledger).maybeSingle() : Promise.resolve({ data: null }),
    photoPaths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, 3600) : Promise.resolve({ data: [] }),
    // Tally knows a factory's GSTIN when its ledger has one; what the team typed on the factory comes first.
    f.tally_ledger ? supabase.from("tally_ledgers").select("gstin").eq("name", f.tally_ledger).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const photoOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const po = (pos ?? []).find((p) => p.factory_id === factoryId);
  // The PO number the team set wins. Otherwise the order's own SO number (SO/172/2026) when it was entered with
  // one, else the app's order number; with several factories each gets -1, -2 in the order they were added.
  const n = (pos ?? []).findIndex((p) => p.factory_id === factoryId);
  const base = /^SO\/\d+\/\d{4}$/i.test(o.buyer_po ?? "") ? o.buyer_po!.toUpperCase() : o.order_no;
  const poNo = po?.po_no || ((pos ?? []).length > 1 && n >= 0 ? `${base}-${n + 1}` : base);
  const due = o.revised_ship_date || o.ship_date;
  const readyBy = due && po?.buffer_days != null ? new Date(Date.parse(due) - po.buffer_days * 86_400_000).toISOString().slice(0, 10) : due;
  const rateOf = new Map(((prices ?? []) as LinePrice[]).map((p) => [p.id, p.factory_rate == null ? null : Number(p.factory_rate)]));
  const rows = lines.map((l) => ({ ...l, rate: rateOf.get(l.id) ?? null, photo: (l.photo_path && photoOf.get(l.photo_path)) || null }));
  const pcs = rows.reduce((t, r) => t + r.qty, 0);
  const priced = rows.every((r) => r.rate != null);
  const value = rows.reduce((t, r) => t + r.qty * (r.rate ?? 0), 0);
  const planned = (lineId: string, step: string) => {
    const s = (stages ?? []).find((x) => x.line_id === lineId && x.stage === step);
    return s?.not_needed ? "Not needed" : s?.planned_on ? short(s.planned_on) : "—";
  };
  const days = terms?.days ?? 60;
  const released = !!po?.released_at;
  const isOwner = me.role === "owner";
  const vendorGstin = f.gstin || ledger?.gstin || "";
  const ourName = co?.legal_name || co?.name || "";

  const missing = [
    !f.address && "factory address",
    !vendorGstin && "factory GSTIN",
    !f.phone && "factory mobile",
    !(co?.address && co?.gstin) && (isOwner ? "our address and GSTIN" : null),
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="head no-print">
        <div className="grow">
          <nav className="crumbs" aria-label="Breadcrumb"><Link href={`/orders/${o.id}`}>{o.order_no}</Link><span aria-hidden>/</span><span>Factory PO</span></nav>
          <h1>Purchase order to {f.name}</h1>
          <p>{released ? `Released ${dayAt(po!.released_at)}. Print it, or save it as a PDF and send it to the factory on WhatsApp.`
            : "Draft: this PO isn't locked and released yet, so it prints marked as a draft."}</p>
        </div>
        {(released || hasBuyerPo) && <PrintPo />}
      </div>
      {!released && !hasBuyerPo && (
        <div className="errbox no-print">
          <b>The buyer&apos;s PO isn&apos;t on file.</b> A factory PO is issued only against a PO received from the buyer.{" "}
          <Link href={`/orders/${o.id}#details-po`} className="link font-semibold">Add the buyer&apos;s PO</Link> first, then print this.
        </div>
      )}
      <PoDetailsForm missing={missing} isOwner={isOwner} initial={{
        orderId: o.id, factoryId, hasPo: !!po, poNo: po?.po_no ?? "", deliveryNote: po?.delivery_note ?? "",
        factory: { address: f.address ?? "", gstin: vendorGstin, phone: f.phone ?? "", email: f.email ?? "" },
        company: isOwner ? { legalName: co?.legal_name ?? "", address: co?.address ?? "", shipAddress: co?.ship_address ?? "", gstin: co?.gstin ?? "", phone: co?.phone ?? "", email: co?.email ?? "" } : undefined,
      }} />

      <div className="fpo-doc">
      <article className="fpo" aria-label={`Purchase order ${poNo}`}>
        <h2 className="fpo-title">Purchase order{!released && <em> · Draft</em>}</h2>

        <div className="fpo-head">
          <div className="fpo-cell fpo-h" style={{ gridArea: "bh" }}>Bill to</div>
          <div className="fpo-cell fpo-h" style={{ gridArea: "sh" }}>Ship to</div>
          <dl className="fpo-cell fpo-kv fpo-meta" style={{ gridArea: "mt" }}>
            <div><dt>PO no.</dt><dd>{poNo}</dd></div>
            <div><dt>Date</dt><dd>{short(released ? istDay(po!.released_at!) : todayIST())}</dd></div>
          </dl>
          <div className="fpo-cell" style={{ gridArea: "bc" }}><b>{ourName}</b><p>{co?.address}</p></div>
          <div className="fpo-cell" style={{ gridArea: "sc" }}><b>{ourName}</b><p>{co?.ship_address || co?.address}</p></div>
          <div className="fpo-cell" style={{ gridArea: "vc" }}><b>Vendor: {f.name}</b><p>{f.address || f.city}</p></div>
          <dl className="fpo-cell fpo-kv" style={{ gridArea: "bk" }}>
            <div><dt>GSTIN</dt><dd>{co?.gstin}</dd></div>
            <div><dt>Mob</dt><dd>{co?.phone}</dd></div>
            <div><dt>E-mail</dt><dd>{co?.email}</dd></div>
          </dl>
          <dl className="fpo-cell fpo-kv" style={{ gridArea: "vk" }}>
            <div><dt>GSTIN</dt><dd>{vendorGstin}</dd></div>
            <div><dt>Mob</dt><dd>{[f.phone, f.contact_name].filter(Boolean).join(" · ")}</dd></div>
            <div><dt>E-mail</dt><dd>{f.email}</dd></div>
          </dl>
        </div>

        <div className="fpo-band">Products description &amp; specification</div>
        <p className="fpo-swipe no-print">Swipe the table sideways to see qty, total, colour and image.</p>
        <div className="fpo-tbl-wrap">
        <table className="fpo-tbl">
          <thead>
            <tr><th>Sr no.</th><th>Article</th><th>Size</th><th>Design no.</th><th>Rate</th><th>Qty</th><th>Total</th><th>Colour</th><th className="fpo-img-h">Image</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const sizes = sizeEntries(r.sizes);
              const counted = sizes.some(([, k]) => k > 0);
              return (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{r.description || "—"}{r.fabric && <small>{r.fabric}</small>}</td>
                  <td>{sizes.length ? sizes.map(([s]) => s).join(", ") : "—"}</td>
                  <td className="nw">{r.style}</td>
                  <td className="num">{r.rate == null ? "—" : money(r.rate)}</td>
                  <td className="fpo-qty">{counted ? sizes.map(([s, k]) => <span key={s} className="nw">{s} {qty(k)}</span>) : "Size-wise qty will be confirmed before cutting"}</td>
                  <td className="num">{qty(r.qty)}</td>
                  <td>{r.colour || "—"}</td>
                  <td className="fpo-img">{r.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed one-hour link, printed as is
                    <img src={r.photo} alt={`Style ${r.style}`} />
                  ) : null}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={6}>Total{priced && <span className="fpo-value"> · Value {money(value)} + GST</span>}</td><td className="num">{qty(pcs)}</td><td colSpan={2} /></tr>
          </tfoot>
        </table>
        </div>

        <div className="fpo-foot">
          <div>
            <p><b>Payment terms:</b> {days} days from GRN</p>
            <p><b>Delivery date:</b> {po?.delivery_note || (readyBy ? short(readyBy) : "As agreed")}</p>
            {(stages ?? []).some((s) => s.planned_on) && (
              <p className="fpo-dates"><b>Key dates:</b>{" "}
                {rows.map((r) => (
                  <span key={r.id}>{rows.length > 1 && <>{r.style}: </>}{KEY_STEPS.map((s) => `${s.label} ${planned(r.id, s.key)}`).join(" · ")}{" "}</span>
                ))}
              </p>
            )}
          </div>
          <div className="fpo-sign"><i /><span>Authorized sign.</span><small>For {ourName}</small></div>
        </div>
      </article>

      <section className="fpo-terms" aria-labelledby="fpo-terms-h">
        <h3 id="fpo-terms-h">Terms &amp; conditions</h3>
        <p className="fpo-terms-sub">(Applicable to all purchase orders unless otherwise agreed in writing)</p>
        <ol>
          {FACTORY_PO_TERMS.map((t) => <li key={t.title}><b>{t.title}:</b> {t.text}</li>)}
        </ol>
        <div className="fpo-accept">
          <div><i /><span>Accepted by {f.name}</span><small>Name, signature and stamp · Date</small></div>
          <div><i /><span>For {ourName}</span><small>Authorised signatory</small></div>
        </div>
      </section>
      </div>
    </>
  );
}
