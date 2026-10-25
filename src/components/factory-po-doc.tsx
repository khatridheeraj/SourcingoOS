import type { ReactNode } from "react";
import { FACTORY_PO_TERMS } from "@/lib/factory-po-terms";
import { money, qty, qtyTotal, qtyU } from "@/lib/format";
import { sizeEntries } from "@/lib/sizes";

export type FpoLine = { id: string; style: string; description: string | null; colour: string | null; fabric: string | null; qty: number; sizes: Record<string, number> | null; rate: number | null; photo: string | null; product?: string | null };
export type FpoDocData = {
  poNo: string;
  date: string;
  draft: boolean;
  company: { name: string; address: string | null; shipAddress: string | null; gstin: string | null; phone: string | null; email: string | null };
  factory: { name: string; address: string | null; gstin: string | null; phone: string | null; contact: string | null; email: string | null };
  lines: FpoLine[];
  paymentDays: number;
  delivery: string;
  keyDates?: string | null;
  accepted?: string | null;
};

// The factory PO in Sourcingo's own format (the Kkora Fashions sample, Oct 2026), with the vendor agreement summed up
// as its terms. Accepted by email or on the PO link, so it carries no signature lines. Used by the team's PO page
// and by the PO link the factory opens. photoSlot lets the team add a missing style photo right on the PO.
export function FactoryPoDoc({ d, photoSlot }: { d: FpoDocData; photoSlot?: (line: FpoLine) => ReactNode }) {
  const priced = d.lines.every((r) => r.rate != null);
  const value = d.lines.reduce((t, r) => t + r.qty * (r.rate ?? 0), 0);
  return (
    <div className="fpo-doc">
      <article className="fpo" aria-label={`Purchase order ${d.poNo}`}>
        <h2 className="fpo-title">Purchase order{d.draft && <em> · Draft</em>}</h2>

        <div className="fpo-head">
          <div className="fpo-cell fpo-h" style={{ gridArea: "bh" }}>Bill to</div>
          <div className="fpo-cell fpo-h" style={{ gridArea: "sh" }}>Ship to</div>
          <dl className="fpo-cell fpo-kv fpo-meta" style={{ gridArea: "mt" }}>
            <div><dt>PO no.</dt><dd>{d.poNo}</dd></div>
            <div><dt>Date</dt><dd>{d.date}</dd></div>
          </dl>
          <div className="fpo-cell" style={{ gridArea: "bc" }}><b>{d.company.name}</b><p>{d.company.address}</p></div>
          <div className="fpo-cell" style={{ gridArea: "sc" }}><b>{d.company.name}</b><p>{d.company.shipAddress || d.company.address}</p></div>
          <div className="fpo-cell" style={{ gridArea: "vc" }}><b>Vendor: {d.factory.name}</b><p>{d.factory.address}</p></div>
          <dl className="fpo-cell fpo-kv" style={{ gridArea: "bk" }}>
            <div><dt>GSTIN</dt><dd>{d.company.gstin}</dd></div>
            <div><dt>Mob</dt><dd>{d.company.phone}</dd></div>
            <div><dt>E-mail</dt><dd>{d.company.email}</dd></div>
          </dl>
          <dl className="fpo-cell fpo-kv" style={{ gridArea: "vk" }}>
            <div><dt>GSTIN</dt><dd>{d.factory.gstin}</dd></div>
            <div><dt>Mob</dt><dd>{[d.factory.phone, d.factory.contact].filter(Boolean).join(" · ")}</dd></div>
            <div><dt>E-mail</dt><dd>{d.factory.email}</dd></div>
          </dl>
        </div>

        <div className="fpo-band">Products description &amp; specification</div>
        {/* On a phone the photos come first, big, one card per style; the full table follows for the details. */}
        <ul className="fpo-cards no-print" aria-label="Styles with photos">
          {d.lines.map((r) => (
            <li key={r.id}>
              {r.photo ? (
                <a href={r.photo} target="_blank" rel="noreferrer" aria-label={`Open the photo of ${r.style}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed link */}
                  <img src={r.photo} alt={`Style ${r.style}`} />
                </a>
              ) : photoSlot ? photoSlot(r) : <span className="fpo-nophoto">No photo</span>}
              <div>
                <b>{r.style}</b>
                <span>{[r.description, r.colour].filter(Boolean).join(" · ")}</span>
                <span className="num">{qtyU(r.qty, r.product)}{r.rate != null && ` · ${money(r.rate)}`}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="fpo-swipe no-print">Swipe the table sideways to see qty, total, colour and image.</p>
        <div className="fpo-tbl-wrap">
          <table className="fpo-tbl">
            <thead>
              <tr><th>Sr no.</th><th>Article</th><th>Size</th><th>Design no.</th><th>Rate</th><th>Qty</th><th>Total</th><th>Colour</th><th className="fpo-img-h">Image</th></tr>
            </thead>
            <tbody>
              {d.lines.map((r, i) => {
                const sizes = sizeEntries(r.sizes);
                const counted = sizes.some(([, k]) => k > 0);
                return (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.description || "—"}{r.fabric && <small>{r.fabric}</small>}</td>
                    <td>{sizes.length ? sizes.map(([s]) => s).join(", ") : "—"}</td>
                    <td className="nw">{r.style}</td>
                    <td className="num">{r.rate == null ? "—" : money(r.rate)}</td>
                    <td className="fpo-qty">{counted ? sizes.map(([s, k]) => <span key={s} className="nw">{s} {qty(k)}</span>) : r.product === "fabric" ? qtyU(r.qty, r.product) : "Size-wise qty will be confirmed before cutting"}</td>
                    <td className="num nw">{qtyU(r.qty, r.product)}</td>
                    <td>{r.colour || "—"}</td>
                    <td className={`fpo-img ${r.photo ? "" : "missing"}`}>
                      {r.photo ? (
                        <a href={r.photo} target="_blank" rel="noreferrer" aria-label={`Open the photo of ${r.style}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- a signed link, printed as is */}
                          <img src={r.photo} alt={`Style ${r.style}`} />
                        </a>
                      ) : photoSlot ? photoSlot(r) : <span>No photo</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>Total{priced && <span className="fpo-value"> · Value {money(value)} + GST</span>}</td><td className="num nw">{qtyTotal(d.lines)}</td><td colSpan={2} /></tr>
            </tfoot>
          </table>
        </div>

        <div className="fpo-foot">
          <div>
            <p><b>Payment terms:</b> {d.paymentDays} days from GRN</p>
            <p><b>Delivery date:</b> {d.delivery}</p>
            {d.keyDates && <p className="fpo-dates"><b>Key dates:</b> {d.keyDates}</p>}
          </div>
          <div className={`fpo-acc ${d.accepted ? "ok" : ""}`}>
            {d.accepted ? <><b>Accepted</b><span>{d.accepted}</span></>
              : <><b>No signature needed</b><span>Accept by replying &quot;Accepted&quot; to the PO email, or tap Accept on the PO link.</span></>}
          </div>
        </div>
      </article>

      <section className="fpo-terms" aria-labelledby="fpo-terms-h">
        <h3 id="fpo-terms-h">Terms &amp; conditions</h3>
        <p className="fpo-terms-sub">(Applicable to all purchase orders unless otherwise agreed in writing)</p>
        <ol>
          {FACTORY_PO_TERMS.map((t) => <li key={t.title}><b>{t.title}:</b> {t.text}</li>)}
        </ol>
      </section>
    </div>
  );
}
