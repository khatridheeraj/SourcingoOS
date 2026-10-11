"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, money, qty } from "@/lib/format";
import { uploadPhotos, uploadReports } from "@/lib/photos";
import {
  cancelDispatch, recordDispatchInvoice, recordEwayBill, recordGrn, recordPurchase, recordShipping,
  type PurchaseInput, type ShippingInput,
} from "../dispatch-actions";

export type DispatchFactory = { id: string; name: string; lines: { id: string; style: string; colour: string; qty: number; factoryRate: string; buyerRate: string }[] };
export type Dispatch = {
  id: string; factoryName: string; billNo: string; billDate: string; purchaseTaxable: number; purchaseGst: number;
  purchasedAt: string; invoiceDueAt: string; invoiceNo: string | null; invoiceTaxable: number | null; invoiceGst: number | null; invoicedAt: string | null;
  ewayNo: string | null; ewayDate: string | null; ewayValidUntil: string | null; ewayUrl: string | null; ewayFromTally: boolean;
  transporter: string | null; vehicleNo: string | null; lrNo: string | null; lrDate: string | null; lrUrl: string | null; cartons: number | null;
  shippedAt: string | null; grnDueOn: string | null; grnUrl: string | null; grnQty: number | null; grnNotes: string | null; grnAt: string | null;
  photoUrls: string[]; lines: { style: string; qty: number; purchaseRate: number; saleRate: number | null }[];
};

const at = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const n = (s: string) => Number(s.replace(/[,₹\s]/g, "")) || 0;
const STEPS = ["Purchase", "Invoice", "E-way bill", "Shipped", "GRN"];
const DOC_ACCEPT = "image/*,.pdf";

// One file (a PDF or a phone photo) into the dispatch's folder; returns its storage path.
async function uploadDoc(folder: string, file: File): Promise<string> {
  if (file.type.startsWith("image/")) return (await uploadPhotos(folder, [file]))[0];
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(`${file.name} isn't a PDF or a photo.`);
  return (await uploadReports(folder, [file]))[0].path;
}

export function OrderDispatch({ orderId, companyId, open, factories, dispatches, now, today }: {
  orderId: string; companyId: string; open: boolean; factories: DispatchFactory[]; dispatches: Dispatch[]; now: number; today: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});
  const fail = (k: string, m: string) => setError((e) => ({ ...e, [k]: m }));

  const blank = (f?: DispatchFactory): PurchaseInput => ({
    factory_id: f?.id ?? "", bill_no: "", bill_date: today, gst: "", notes: "",
    lines: (f?.lines ?? []).map((l) => ({ line_id: l.id, qty: "", purchase_rate: l.factoryRate, sale_rate: l.buyerRate })),
  });
  const [p, setP] = useState<PurchaseInput>(blank(factories.length === 1 ? factories[0] : undefined));
  const purchaseValue = p.lines.reduce((s, l) => s + n(l.qty) * n(l.purchase_rate), 0);

  function savePurchase(e: React.FormEvent) {
    e.preventDefault();
    fail("new", "");
    start(async () => {
      const res = await recordPurchase(orderId, p);
      if (res.error) return fail("new", res.error);
      setAdding(false);
      setP(blank(factories.length === 1 ? factories[0] : undefined));
      router.refresh();
    });
  }

  function step(id: string, work: (folder: string) => Promise<{ error?: string }>) {
    fail(id, "");
    start(async () => {
      try {
        const res = await work(`${companyId}/${orderId}/dispatch/${id}`);
        if (res.error) return fail(id, res.error);
      } catch (err) {
        return fail(id, err instanceof Error ? err.message : "The files didn't upload. Try again.");
      }
      router.refresh();
    });
  }

  function cancel(id: string) {
    const reason = window.prompt("Why cancel this dispatch? For example: entered twice.");
    if (reason == null) return;
    step(id, () => cancelDispatch(orderId, id, reason));
  }

  return (
    <section className="panel" id="dispatch">
      <div className="row mb-1">
        <h2 className="font-bold text-base">Dispatch</h2>
        {open && !adding && factories.length > 0 && <button type="button" className="btn sm ml-auto" onClick={() => setAdding(true)}>Record a purchase</button>}
      </div>
      <p className="muted mb-3 text-[13px]">
        Purchase from the factory, then invoice the buyer within 4 hours, add the e-way bill, ship with photos and the LR, and collect the buyer&apos;s GRN in time.
      </p>

      {adding && (
        <form onSubmit={savePurchase} className="mb-4 rounded-[10px] border border-line p-3">
          <h3 className="mb-2 font-semibold">Purchase: the factory&apos;s bill</h3>
          <div className="fgrid">
            <label className="field">
              <span>Factory <i>*</i></span>
              <select className="inp" value={p.factory_id} onChange={(e) => setP(blank(factories.find((f) => f.id === e.target.value)))} aria-label="Purchase factory">
                <option value="">Pick the factory</option>
                {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Bill number <i>*</i></span>
              <input className="inp" value={p.bill_no} onChange={(e) => setP({ ...p, bill_no: e.target.value })} aria-label="Factory bill number" />
            </label>
            <label className="field">
              <span>Bill date <i>*</i></span>
              <input className="inp" type="date" max={today} value={p.bill_date} onChange={(e) => setP({ ...p, bill_date: e.target.value })} aria-label="Factory bill date" />
            </label>
            <label className="field">
              <span>GST on the bill ₹</span>
              <input className="inp" inputMode="decimal" value={p.gst} onChange={(e) => setP({ ...p, gst: e.target.value })} aria-label="Purchase GST" />
            </label>
          </div>
          {p.lines.length > 0 && (
            <div className="table-wrap mt-3">
              <table className="tbl">
                <thead><tr><th>Style</th><th className="r">Ordered</th><th>Pieces bought</th><th>Purchase rate ₹</th><th>Sale rate ₹</th></tr></thead>
                <tbody>
                  {p.lines.map((l, i) => {
                    const line = factories.find((f) => f.id === p.factory_id)?.lines.find((x) => x.id === l.line_id);
                    const set = (k: "qty" | "purchase_rate" | "sale_rate", v: string) => setP({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
                    return (
                      <tr key={l.line_id}>
                        <td className="code">{line?.style}{line?.colour && <span className="muted"> · {line.colour}</span>}</td>
                        <td className="r num">{qty(line?.qty)}</td>
                        <td><input className="inp w-[90px]" inputMode="numeric" value={l.qty} onChange={(e) => set("qty", e.target.value)} aria-label={`${line?.style} pieces bought`} /></td>
                        <td><input className="inp w-[90px]" inputMode="decimal" value={l.purchase_rate} onChange={(e) => set("purchase_rate", e.target.value)} aria-label={`${line?.style} purchase rate`} /></td>
                        <td><input className="inp w-[90px]" inputMode="decimal" value={l.sale_rate} onChange={(e) => set("sale_rate", e.target.value)} aria-label={`${line?.style} sale rate`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row mt-3">
            <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save purchase"}</button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>Close</button>
            {purchaseValue > 0 && <span className="text-[13px]">Value before GST <b className="num">{money(purchaseValue)}</b></span>}
            {error.new && <span className="text-[13px] font-semibold text-bad" role="alert">{error.new}</span>}
          </div>
          <p className="muted mt-2 text-[13px]">Saving starts the 4 hours to invoice the buyer.</p>
        </form>
      )}

      {dispatches.length === 0 && !adding && <p className="muted text-[13px]">Nothing dispatched yet.</p>}

      <div className="flex flex-col gap-3">
        {dispatches.map((d) => {
          const done = [true, !!d.invoicedAt, !!d.ewayNo, !!d.shippedAt, !!d.grnAt];
          const next = done.indexOf(false);
          const pcs = d.lines.reduce((s, l) => s + l.qty, 0);
          const invoiceLate = !d.invoicedAt && Date.parse(d.invoiceDueAt) < now;
          const grnLate = !!d.shippedAt && !d.grnAt && !!d.grnDueOn && d.grnDueOn < today;
          return (
            <article key={d.id} className="rounded-[10px] border border-line p-3" aria-label={`Dispatch ${d.billNo}`}>
              <div className="row">
                <b>{d.factoryName} · bill {d.billNo}</b>
                <span className="muted text-[13px]">{day(d.billDate)} · {qty(pcs)} pcs · {money(d.purchaseTaxable + d.purchaseGst)} with GST</span>
                {open && !d.invoicedAt && <button type="button" className="btn sm ml-auto" disabled={pending} onClick={() => cancel(d.id)}>Cancel</button>}
              </div>
              <ol className="steps mt-2" aria-label="Dispatch steps">
                {STEPS.map((s, i) => (
                  <li key={s}><span className={done[i] ? "chip ok" : i === next ? (i === 1 && invoiceLate) || (i === 4 && grnLate) ? "chip bad" : "chip warn" : "chip"}>{done[i] ? "✓ " : ""}{s}</span></li>
                ))}
              </ol>
              <p className="muted mt-1 text-[13px]">{d.lines.map((l) => `${l.style} ${qty(l.qty)} pcs at ${money(l.purchaseRate)}`).join(" · ")}</p>

              {d.invoicedAt && (
                <p className="mt-2 text-[13px]">Invoice <b>{d.invoiceNo}</b>: {money((d.invoiceTaxable ?? 0) + (d.invoiceGst ?? 0))} with GST, made {at.format(new Date(d.invoicedAt))}.</p>
              )}
              {d.ewayNo && (
                <p className="text-[13px]">E-way bill <b className="num">{d.ewayNo}</b> of {day(d.ewayDate)}{d.ewayValidUntil && `, valid till ${day(d.ewayValidUntil)}`}{d.ewayFromTally && ", from Tally"}. {d.ewayUrl && <a className="link" href={d.ewayUrl} target="_blank" rel="noreferrer">Open</a>}</p>
              )}
              {d.shippedAt && (
                <div className="text-[13px]">
                  Shipped by {d.transporter}{d.vehicleNo && ` (${d.vehicleNo})`}, LR <b>{d.lrNo}</b> of {day(d.lrDate)}{d.cartons && `, ${d.cartons} cartons`}. {d.lrUrl && <a className="link" href={d.lrUrl} target="_blank" rel="noreferrer">LR copy</a>}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {d.photoUrls.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Goods photo" className="h-16 w-16 rounded-md object-cover" /></a>
                    ))}
                  </div>
                </div>
              )}
              {d.grnAt && (
                <p className="text-[13px]">GRN: buyer received <b className="num">{qty(d.grnQty)}</b> of {qty(pcs)} pcs{d.grnNotes && ` (${d.grnNotes})`}. {d.grnUrl && <a className="link" href={d.grnUrl} target="_blank" rel="noreferrer">GRN report</a>}</p>
              )}

              {open && next === 1 && <InvoiceStep d={d} today={today} late={invoiceLate} pending={pending} onSave={(v) => step(d.id, () => recordDispatchInvoice(orderId, d.id, v))} />}
              {open && next === 2 && <EwayStep invoiceNo={d.invoiceNo ?? ""} today={today} pending={pending} onSave={(v, file) => step(d.id, async (folder) => recordEwayBill(orderId, d.id, { ...v, path: await uploadDoc(folder, file) }))} />}
              {open && next === 3 && <ShipStep today={today} pending={pending} onSave={(v, lr, photos) => step(d.id, async (folder) => recordShipping(orderId, d.id, { ...v, lr_path: await uploadDoc(folder, lr), photos: await uploadPhotos(folder, photos) }))} />}
              {next === 4 && <GrnStep d={d} pcs={pcs} late={grnLate} pending={pending} onSave={(v, file) => step(d.id, async (folder) => recordGrn(orderId, d.id, { ...v, path: await uploadDoc(folder, file) }))} />}
              {error[d.id] && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error[d.id]}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function InvoiceStep({ d, today, late, pending, onSave }: {
  d: Dispatch; today: string; late: boolean; pending: boolean; onSave: (v: { invoice_no: string; invoice_date: string; taxable: string; gst: string }) => void;
}) {
  const sale = d.lines.every((l) => l.saleRate != null) ? d.lines.reduce((s, l) => s + l.qty * (l.saleRate ?? 0), 0) : 0;
  const [v, setV] = useState({ invoice_no: "", invoice_date: today, taxable: sale ? String(sale) : "", gst: sale ? String(Math.round(sale * 0.05 * 100) / 100) : "" });
  return (
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <p className={`mb-2 text-[13px] font-semibold ${late ? "text-bad" : "text-warn"}`}>
        {late ? `Emergency: the invoice was due by ${at.format(new Date(d.invoiceDueAt))}.` : `Invoice the buyer by ${at.format(new Date(d.invoiceDueAt))}.`}
      </p>
      <div className="fgrid">
        <label className="field"><span>Tally invoice number <i>*</i></span><input className="inp" value={v.invoice_no} onChange={(e) => setV({ ...v, invoice_no: e.target.value })} aria-label="Invoice number" /></label>
        <label className="field"><span>Invoice date <i>*</i></span><input className="inp" type="date" value={v.invoice_date} onChange={(e) => setV({ ...v, invoice_date: e.target.value })} aria-label="Invoice date" /></label>
        <label className="field"><span>Value before GST ₹ <i>*</i></span><input className="inp" inputMode="decimal" value={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.value })} aria-label="Invoice value before GST" /></label>
        <label className="field"><span>GST ₹</span><input className="inp" inputMode="decimal" value={v.gst} onChange={(e) => setV({ ...v, gst: e.target.value })} aria-label="Invoice GST" /></label>
      </div>
      <div className="row mt-3">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save invoice"}</button>
        <span className="muted text-[13px]">Make the invoice in Tally, with its e-way bill, then enter it here. It also goes into Payments. Total {money(n(v.taxable) + n(v.gst))}.</span>
      </div>
    </form>
  );
}

// The e-way bill comes from Tally with invoice invoiceNo. Typing it in is for when Tally hasn't synced yet.
function EwayStep({ invoiceNo, today, pending, onSave }: {
  invoiceNo: string; today: string; pending: boolean; onSave: (v: { no: string; date: string; valid_until: string }, file: File) => void;
}) {
  const [byHand, setByHand] = useState(false);
  const [v, setV] = useState({ no: "", date: today, valid_until: "" });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  if (!byHand) {
    return (
      <div className="mt-3 rounded-[10px] bg-surface-2 p-3 text-[13px]">
        <p className="font-semibold text-warn">Waiting for the e-way bill of invoice {invoiceNo} from Tally.</p>
        <p className="muted mt-1">It fills in here by itself once Tally has made it and the app reads Tally.</p>
        <button type="button" className="btn sm mt-2" onClick={() => setByHand(true)}>Enter it by hand instead</button>
      </div>
    );
  }
  return (
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); if (!file) return setErr("Attach the e-way bill."); setErr(""); onSave(v, file); }}>
      <p className="mb-2 text-[13px] font-semibold text-warn">Enter the e-way bill for invoice {invoiceNo} and attach its copy.</p>
      <div className="fgrid">
        <label className="field"><span>E-way bill number <i>*</i></span><input className="inp" inputMode="numeric" value={v.no} onChange={(e) => setV({ ...v, no: e.target.value })} aria-label="E-way bill number" placeholder="12 digits" /></label>
        <label className="field"><span>Date <i>*</i></span><input className="inp" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="E-way bill date" /></label>
        <label className="field"><span>Valid till</span><input className="inp" type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} aria-label="E-way bill valid till" /></label>
        <label className="field"><span>E-way bill copy <i>*</i></span><input className="inp" type="file" accept={DOC_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="E-way bill copy" /></label>
      </div>
      <div className="row mt-3">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save e-way bill"}</button>
        {err && <span className="text-[13px] font-semibold text-bad" role="alert">{err}</span>}
      </div>
    </form>
  );
}

function ShipStep({ today, pending, onSave }: {
  today: string; pending: boolean; onSave: (v: Omit<ShippingInput, "lr_path" | "photos">, lr: File, photos: File[]) => void;
}) {
  const [v, setV] = useState({ transporter: "", vehicle_no: "", lr_no: "", lr_date: today, cartons: "" });
  const [lr, setLr] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [err, setErr] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photos.length) return setErr("Add photos of the goods.");
    if (!lr) return setErr("Attach the LR copy.");
    setErr("");
    onSave(v, lr, photos);
  }
  return (
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={submit}>
      <p className="mb-2 text-[13px] font-semibold text-warn">Before the goods leave: photos of the packed goods, the transporter and the LR.</p>
      <div className="fgrid">
        <label className="field"><span>Transporter <i>*</i></span><input className="inp" value={v.transporter} onChange={(e) => setV({ ...v, transporter: e.target.value })} aria-label="Transporter" /></label>
        <label className="field"><span>Vehicle number</span><input className="inp" value={v.vehicle_no} onChange={(e) => setV({ ...v, vehicle_no: e.target.value })} aria-label="Vehicle number" /></label>
        <label className="field"><span>LR number <i>*</i></span><input className="inp" value={v.lr_no} onChange={(e) => setV({ ...v, lr_no: e.target.value })} aria-label="LR number" /></label>
        <label className="field"><span>LR date <i>*</i></span><input className="inp" type="date" value={v.lr_date} onChange={(e) => setV({ ...v, lr_date: e.target.value })} aria-label="LR date" /></label>
        <label className="field"><span>Cartons</span><input className="inp" inputMode="numeric" value={v.cartons} onChange={(e) => setV({ ...v, cartons: e.target.value })} aria-label="Cartons" /></label>
        <label className="field"><span>LR copy <i>*</i></span><input className="inp" type="file" accept={DOC_ACCEPT} onChange={(e) => setLr(e.target.files?.[0] ?? null)} aria-label="LR copy" /></label>
        <label className="field">
          <span>Photos of the goods <i>*</i></span>
          <input className="inp" type="file" accept="image/*" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])])} aria-label="Photos of the goods" />
          <small>{photos.length ? `${photos.length} ready` : "As many as you need."}</small>
        </label>
      </div>
      <div className="row mt-3">
        <button className="btn primary" disabled={pending}>{pending ? "Uploading…" : "Save shipping"}</button>
        {err && <span className="text-[13px] font-semibold text-bad" role="alert">{err}</span>}
      </div>
    </form>
  );
}

function GrnStep({ d, pcs, late, pending, onSave }: {
  d: Dispatch; pcs: number; late: boolean; pending: boolean; onSave: (v: { received_qty: string; notes: string }, file: File) => void;
}) {
  const [v, setV] = useState({ received_qty: String(pcs), notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  return (
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); if (!file) return setErr("Attach the GRN report."); setErr(""); onSave(v, file); }}>
      <p className={`mb-2 text-[13px] font-semibold ${late ? "text-bad" : "text-warn"}`}>
        {late ? `GRN overdue: it was due ${day(d.grnDueOn)}.` : `Get the buyer's GRN report by ${day(d.grnDueOn)}.`}
      </p>
      <div className="fgrid">
        <label className="field"><span>GRN report <i>*</i></span><input className="inp" type="file" accept={DOC_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="GRN report" /></label>
        <label className="field"><span>Pieces received <i>*</i></span><input className="inp" inputMode="numeric" value={v.received_qty} onChange={(e) => setV({ ...v, received_qty: e.target.value })} aria-label="Pieces received" /></label>
        <label className="field"><span>Shortages or remarks</span><input className="inp" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} aria-label="GRN remarks" /></label>
      </div>
      <div className="row mt-3">
        <button className="btn primary" disabled={pending}>{pending ? "Uploading…" : "Save GRN"}</button>
        {err && <span className="text-[13px] font-semibold text-bad" role="alert">{err}</span>}
      </div>
    </form>
  );
}
