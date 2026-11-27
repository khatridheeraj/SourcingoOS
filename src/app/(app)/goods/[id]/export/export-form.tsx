"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { COUNTRIES, CURRENCIES } from "@/lib/landed";
import { INCOTERMS, INCOTERM_WORDS, exportProblem, hsHint, type DocLine, type ExportDetails } from "@/lib/export-docs";
import { saveExport, saveExporter, type Exporter } from "../../actions";

// The lot's export details, filled in once; the papers below are drawn from them.
export function ExportForm({ dispatchId, initial, lines, fxToday }: { dispatchId: string; initial: ExportDetails; lines: DocLine[]; fxToday: Record<string, number> }) {
  const router = useRouter();
  const [e, setE] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof ExportDetails) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setE({ ...e, [k]: ev.target.value });
  const setLine = (id: string, k: "hs" | "rate", v: string) => setE({ ...e, lines: { ...e.lines, [id]: { ...e.lines[id], [k]: v } } });
  const withFreight = ["CIF", "CFR", "DAP", "DDP"].includes(e.incoterm);
  const withIns = ["CIF", "DAP", "DDP"].includes(e.incoterm);

  function save() {
    const bad = exportProblem(e);
    if (bad) return setError(bad);
    setError("");
    start(async () => {
      let r: { error?: string };
      try { r = await saveExport(dispatchId, e); } catch (x) { r = { error: caught(x, "It didn't save. Try again.") }; }
      if (r.error) return setError(r.error);
      toast("Export details saved. The papers below are up to date.");
      router.refresh();
    });
  }

  return (
    <section className="panel exp-form" aria-labelledby="exp-h">
      <div>
        <h2 id="exp-h" className="!mb-0">Export details for this lot</h2>
        <p className="text-[13px] text-muted">Fill what you know; the papers show what is still missing. Nothing goes to anyone until you print it.</p>
      </div>

      <h3>Invoice</h3>
      <div className="fgrid">
        <label className="field"><span>Invoice no.</span><input className="inp" value={e.invoice_no} maxLength={40} onChange={set("invoice_no")} /></label>
        <label className="field"><span>Invoice date</span><input className="inp" type="date" value={e.invoice_date} onChange={set("invoice_date")} /></label>
        <label className="field"><span>Currency</span>
          <select className="inp" value={e.currency} onChange={(ev) => {
            const c = ev.target.value, r = fxToday[c];
            setE({ ...e, currency: c, fx: r ? String(Math.round(r * 100) / 100) : e.fx });
          }}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>₹ for 1 {e.currency}</span><input className="inp num" inputMode="decimal" value={e.fx} maxLength={10} onChange={set("fx")} placeholder="88.50" /></label>
        <label className="field"><span>Incoterm</span>
          <select className="inp" value={e.incoterm} onChange={set("incoterm")}>
            {INCOTERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <small className="muted">{INCOTERM_WORDS[e.incoterm]}</small>
        </label>
        <label className="field"><span>Payment terms</span><input className="inp" value={e.terms} maxLength={200} onChange={set("terms")} placeholder="30% advance, 70% against BL copy" /></label>
        {withFreight && <label className="field"><span>Freight, {e.currency}</span><input className="inp num" inputMode="decimal" value={e.freight} maxLength={12} onChange={set("freight")} /></label>}
        {withIns && <label className="field"><span>Insurance, {e.currency}</span><input className="inp num" inputMode="decimal" value={e.insurance} maxLength={12} onChange={set("insurance")} /></label>}
      </div>

      <h3>Styles <small className="font-normal text-muted">HS code and rate a piece or metre in {e.currency}</small></h3>
      <ul className="exp-lines">
        {lines.map((l) => (
          <li key={l.id} className="exp-line">
            <b>{l.style}<small>{[l.description, l.colour, `${l.qty.toLocaleString("en-IN")} ${l.product === "fabric" ? "m" : "pcs"}`].filter(Boolean).join(" · ")}</small></b>
            <label className="field"><span>HS code</span>
              <input className="inp num" inputMode="numeric" value={e.lines[l.id]?.hs ?? ""} maxLength={10} placeholder={hsHint(l.product)} onChange={(ev) => setLine(l.id, "hs", ev.target.value)} />
            </label>
            <label className="field"><span>Rate, {e.currency}</span>
              <input className="inp num" inputMode="decimal" value={e.lines[l.id]?.rate ?? ""} maxLength={12} onChange={(ev) => setLine(l.id, "rate", ev.target.value)} />
            </label>
          </li>
        ))}
      </ul>

      <h3>Shipment</h3>
      <div className="fgrid">
        <div className="field"><span>Ships by</span>
          <div className="seg" role="radiogroup" aria-label="Ships by">
            {(["sea", "air"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={e.mode === m} onClick={() => setE({ ...e, mode: m })}>{m === "sea" ? "Sea" : "Air"}</button>)}
          </div>
        </div>
        <label className="field"><span>Country of destination</span>
          <input className="inp" list="exp-countries" value={e.country} maxLength={60} onChange={set("country")} placeholder="United Kingdom" />
          <datalist id="exp-countries">{COUNTRIES.map((c) => <option key={c.code} value={c.name} />)}</datalist>
        </label>
        <label className="field"><span>Port of loading</span><input className="inp" value={e.port_loading} maxLength={80} onChange={set("port_loading")} placeholder={e.mode === "air" ? "Jaipur Air Cargo (JAI)" : "Nhava Sheva (JNPT)"} /></label>
        <label className="field"><span>Port of discharge</span><input className="inp" value={e.port_discharge} maxLength={80} onChange={set("port_discharge")} placeholder={e.mode === "air" ? "London Heathrow" : "Felixstowe"} /></label>
        <label className="field"><span>Final destination</span><input className="inp" value={e.final_dest} maxLength={80} onChange={set("final_dest")} placeholder="Buyer's warehouse city" /></label>
        <label className="field"><span>{e.mode === "air" ? "Flight" : "Vessel / voyage"} <small className="muted">when booked</small></span><input className="inp" value={e.vessel} maxLength={80} onChange={set("vessel")} /></label>
        <label className="field"><span>Container</span><input className="inp" value={e.container} maxLength={40} onChange={set("container")} placeholder={e.mode === "air" ? "Loose cartons" : "LCL, or 20 ft"} /></label>
        <label className="field"><span>Volume (CBM)</span><input className="inp num" inputMode="decimal" value={e.cbm} maxLength={8} onChange={set("cbm")} placeholder="2.4" /></label>
        <label className="field"><span>Goods ready on</span><input className="inp" type="date" value={e.etd} onChange={set("etd")} /></label>
        <label className="field"><span>Forwarder</span><input className="inp" value={e.forwarder} maxLength={120} onChange={set("forwarder")} /></label>
      </div>
      <div className="fgrid">
        <label className="field"><span>Notify party <small className="muted">optional</small></span><textarea className="inp" rows={2} value={e.notify} maxLength={500} onChange={set("notify")} placeholder="Same as consignee" /></label>
        <label className="field"><span>Shipping marks <small className="muted">on every carton</small></span><textarea className="inp" rows={2} value={e.marks} maxLength={500} onChange={set("marks")} placeholder={"Buyer name / PO no.\nCarton 1 of N"} /></label>
      </div>

      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <div className="row"><button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save export details"}</button></div>
    </section>
  );
}

// Our exporter details, kept for every export invoice. Owner only; shown closed once filled.
export function ExporterFix({ dispatchId, initial }: { dispatchId: string; initial: Exporter }) {
  const router = useRouter();
  const filled = !!(initial.iec && initial.ad_code && initial.lut_no);
  const [x, setX] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof Exporter) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setX({ ...x, [k]: ev.target.value });
  return (
    <details className="panel" open={!filled}>
      <summary className="cursor-pointer font-semibold">Our exporter details {filled ? <small className="font-normal text-muted">· IEC {initial.iec}</small> : <small className="font-normal text-warn">· needed once</small>}</summary>
      <p className="mt-1 text-[13px] text-muted">Printed on every commercial invoice. The IEC comes from DGFT, the AD code from our bank, and the LUT (filed each year on the GST portal) lets us ship without paying IGST.</p>
      <div className="fgrid mt-3">
        <label className="field"><span>IEC</span><input className="inp code" value={x.iec} maxLength={12} onChange={set("iec")} placeholder="ABCDE1234F" autoComplete="off" /></label>
        <label className="field"><span>AD code</span><input className="inp code" value={x.ad_code} maxLength={20} onChange={set("ad_code")} placeholder="0510005" autoComplete="off" /></label>
        <label className="field"><span>LUT ARN</span><input className="inp code" value={x.lut_no} maxLength={40} onChange={set("lut_no")} placeholder="AD080326000123X" autoComplete="off" /></label>
        <label className="field"><span>LUT date</span><input className="inp" type="date" value={x.lut_date} onChange={set("lut_date")} /></label>
        <label className="field"><span>Usual port of loading</span><input className="inp" value={x.export_port} maxLength={80} onChange={set("export_port")} placeholder="Nhava Sheva (JNPT)" /></label>
      </div>
      <label className="field mt-3"><span>Bank details for the buyer to pay</span>
        <textarea className="inp" rows={3} value={x.export_bank} maxLength={500} onChange={set("export_bank")} placeholder={"Bank, branch\nAccount no., SWIFT code"} />
      </label>
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <div className="row mt-3">
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
          let r: { error?: string };
          try { r = await saveExporter(dispatchId, x); } catch (e) { r = { error: caught(e, "It didn't save. Try again.") }; }
          if (r.error) return setError(r.error);
          setError("");
          toast("Exporter details saved for every invoice");
          router.refresh();
        })}>{pending ? "Saving…" : "Save exporter details"}</button>
      </div>
    </details>
  );
}
