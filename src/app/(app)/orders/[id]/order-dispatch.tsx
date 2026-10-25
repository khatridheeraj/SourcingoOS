"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, money, qty } from "@/lib/format";
import { garmentBill, gstLabel, gstRate } from "@/lib/gst";
import { uploadPhotos, uploadReports } from "@/lib/photos";
import {
  attachDispatchCopy, cancelDispatch, recordDispatchInvoice, recordEwayBill, recordGrn, recordPurchase, recordShipping,
  type PurchaseInput, type ShippingInput,
} from "../dispatch-actions";
import { closeShort } from "../actions";

// Each style's pieces across the order's dispatches: ordered, bought, billed (invoiced) and shipped.
export type ShipLine = { id: string; style: string; colour: string; ordered: number; bought: number; billed: number; shipped: number };
export type DispatchFactory = { id: string; name: string; lines: { id: string; style: string; colour: string; qty: number; factoryRate: string; buyerRate: string }[] };
// Bills in Tally that no dispatch has taken yet (the order's factories' purchase bills and its buyer's invoices),
// to check a typed number against. Not shown as a list. buyerInTally: the buyer has a Tally ledger, so its invoice is picked up by itself.
export type TallyBills = {
  purchases: { factory_id: string; no: string; date: string; amount: number }[];
  sales: { no: string; date: string; amount: number; eway: string | null }[];
  buyerInTally: boolean;
};
export type Dispatch = {
  id: string; factoryName: string; billNo: string; billDate: string; purchaseTaxable: number; purchaseGst: number; purchaseTallyAmount: number | null;
  billUrl: string | null; invoiceUrl: string | null;
  purchasedAt: string; invoiceDueAt: string; invoiceNo: string | null; invoiceTaxable: number | null; invoiceGst: number | null; invoicedAt: string | null;
  ewayNo: string | null; ewayDate: string | null; ewayValidUntil: string | null; ewayUrl: string | null; ewayFromTally: boolean;
  transporter: string | null; vehicleNo: string | null; lrNo: string | null; lrDate: string | null; lrUrl: string | null; cartons: number | null;
  shippedAt: string | null; grnDueOn: string | null; grnUrl: string | null; grnQty: number | null; grnNotes: string | null; grnAt: string | null;
  photoUrls: string[]; lines: { style: string; qty: number; purchaseRate: number; saleRate: number | null }[];
  // Styles in this dispatch whose final QC hasn't passed yet.
  qcNotPassed?: string[];
};

const at = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const n = (s: string) => Number(s.replace(/[,₹\s]/g, "")) || 0;
const STEPS = ["Purchase", "Invoice", "E-way bill", "Shipped", "GRN"];
const DOC_ACCEPT = "image/*,.pdf";
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const digits = (s: string) => s.replace(/[,\s]/g, "");

// One file (a PDF or a phone photo) into the dispatch's folder; returns its storage path.
async function uploadDoc(folder: string, file: File): Promise<string> {
  if (file.type.startsWith("image/")) return (await uploadPhotos(folder, [file]))[0];
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(`${file.name} isn't a PDF or a photo.`);
  return (await uploadReports(folder, [file]))[0].path;
}

export function OrderDispatch({ orderId, orderNo, companyId, open, owner, factories, dispatches, tally, now, today, ship, closedShort }: {
  orderId: string; orderNo: string; companyId: string; open: boolean; owner: boolean; factories: DispatchFactory[]; dispatches: Dispatch[]; tally: TallyBills; now: number; today: string;
  ship: ShipLine[]; closedShort: { at: string; reason: string; by: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});
  const fail = (k: string, m: string) => setError((e) => ({ ...e, [k]: m }));

  const blank = (f?: DispatchFactory): PurchaseInput => ({
    factory_id: f?.id ?? "", bill_no: "", bill_date: today, notes: "",
    // The next part starts with what is left to buy of each style.
    lines: (f?.lines ?? []).map((l) => {
      const s = ship.find((x) => x.id === l.id);
      const left = s ? s.ordered - s.bought : 0;
      return { line_id: l.id, qty: s?.bought && left > 0 ? String(left) : "", purchase_rate: l.factoryRate, sale_rate: l.buyerRate };
    }),
  });
  const [p, setP] = useState<PurchaseInput>(blank(factories.length === 1 ? factories[0] : undefined));
  const [billCopy, setBillCopy] = useState<File | null>(null);
  // Sent in parts: some pieces have gone and some are still to go.
  const shipped = ship.reduce((t, l) => t + l.shipped, 0);
  const part = open && shipped > 0 && ship.some((l) => l.shipped < l.ordered);
  const numbered = dispatches.length > 1 || part;
  const toBuy = ship.some((l) => l.bought < l.ordered);

  function savePurchase(e: React.FormEvent) {
    e.preventDefault();
    fail("new", "");
    if (billCopy && !billCopy.type.startsWith("image/") && !billCopy.name.toLowerCase().endsWith(".pdf")) return fail("new", `${billCopy.name} isn't a PDF or a photo.`);
    start(async () => {
      const res = await recordPurchase(orderId, p);
      if (res.error || !res.id) return fail("new", res.error ?? "The purchase didn't save. Try again.");
      setAdding(false);
      setP(blank(factories.length === 1 ? factories[0] : undefined));
      // The bill's copy goes into the new dispatch's folder; if it fails, the purchase stays and the copy can be added on the dispatch.
      if (billCopy) {
        const id = res.id;
        try {
          const up = await attachDispatchCopy(orderId, id, "bill", await uploadDoc(`${companyId}/${orderId}/dispatch/${id}`, billCopy));
          if (up.error) fail(id, `The purchase is saved, but the bill copy wasn't: ${up.error}`);
        } catch {
          fail(id, "The purchase is saved, but the bill copy didn't upload. Add it again below.");
        }
        setBillCopy(null);
      }
      router.refresh();
    });
  }

  function attach(id: string, kind: "bill" | "invoice", file: File) {
    step(id, async (folder) => attachDispatchCopy(orderId, id, kind, await uploadDoc(folder, file)));
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
    <section className="panel scroll-mt-20" id="dispatch">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Dispatch</h2>
        {open && !adding && factories.length > 0 && (
          <button type="button" className={`btn sm ml-auto ${part && toBuy ? "primary" : ""}`} onClick={() => { setP(blank(factories.length === 1 ? factories[0] : undefined)); setAdding(true); }}>
            {dispatches.length ? "Record the next part" : "Record a purchase"}
          </button>
        )}
      </div>

      {dispatches.length > 0 && (
        <ShipSummary orderId={orderId} orderNo={orderNo} ship={ship} open={open} closedShort={closedShort} pending={pending} start={start}
          onRefresh={() => router.refresh()} />
      )}

      {adding && (
        <PurchaseForm p={p} setP={setP} blank={blank} factories={factories} ship={ship} bills={tally.purchases} today={today} pending={pending}
          copy={billCopy} setCopy={setBillCopy} error={error.new} onSubmit={savePurchase} onClose={() => setAdding(false)} />
      )}

      {dispatches.length === 0 && !adding && <p className="muted text-[13px]">Nothing dispatched yet.</p>}

      <div className="flex flex-col gap-3">
        {dispatches.map((d, di) => {
          const done = [true, !!d.invoicedAt, !!d.ewayNo, !!d.shippedAt, !!d.grnAt];
          const next = done.indexOf(false);
          const pcs = d.lines.reduce((s, l) => s + l.qty, 0);
          const invoiceLate = !d.invoicedAt && Date.parse(d.invoiceDueAt) < now;
          const billTotal = Math.round(d.purchaseTaxable + d.purchaseGst);
          const tallyOff = d.purchaseTallyAmount != null && Math.abs(d.purchaseTallyAmount - billTotal) > 1;
          const grnLate = !!d.shippedAt && !d.grnAt && !!d.grnDueOn && d.grnDueOn < today;
          return (
            <article key={d.id} className="rounded-[10px] border border-line p-3" aria-label={`Dispatch ${d.billNo}`}>
              <div className="row">
                <b>{numbered && <span className="part-no">Part {di + 1}</span>}{d.factoryName} · bill {d.billNo}</b>
                <span className="muted text-[13px]">{day(d.billDate)} · {qty(pcs)} pcs · {money(billTotal)} with GST</span>
                {d.purchaseTallyAmount == null
                  ? <span className="chip" title="Linked by itself once Accounts books this bill in Tally.">Not in Tally yet</span>
                  : tallyOff ? <span className="chip bad">Tally says {money(d.purchaseTallyAmount)}</span> : <span className="chip ok">In Tally</span>}
                <span className="ml-auto flex gap-2">
                  <a href={`/goods/${d.id}/challan`} className="btn sm">Delivery challan</a>
                  {!d.invoicedAt && <button type="button" className="btn sm ghost" disabled={pending} onClick={() => cancel(d.id)}>Cancel</button>}
                </span>
              </div>
              <ol className="steps mt-2" aria-label="Dispatch steps">
                {STEPS.map((s, i) => (
                  <li key={s}><span className={done[i] ? "chip ok" : i === next ? (i === 1 && invoiceLate) || (i === 4 && grnLate) ? "chip bad" : "chip warn" : "chip"}>{done[i] ? "✓ " : ""}{s}</span></li>
                ))}
              </ol>
              <p className="muted mt-1 text-[13px]">{d.lines.map((l) => `${l.style} ${qty(l.qty)} pcs at ${money(l.purchaseRate)}`).join(" · ")}</p>

              <Copies d={d} pending={pending} onAttach={(kind, file) => attach(d.id, kind, file)} />

              {d.invoicedAt && (
                <p className="mt-2 text-[13px]">Invoice <b>{d.invoiceNo}</b>{d.invoiceTaxable != null && `: ${money(Math.round(d.invoiceTaxable + (d.invoiceGst ?? 0)))} with GST`}, made {at.format(new Date(d.invoicedAt))}.</p>
              )}
              {d.ewayNo && (
                <p className="text-[13px]">E-way bill <b className="num">{d.ewayNo}</b>{d.ewayDate && ` of ${day(d.ewayDate)}`}{d.ewayValidUntil && `, valid till ${day(d.ewayValidUntil)}`}{d.ewayFromTally && ", from Tally"}. {d.ewayUrl && <a className="link" href={d.ewayUrl} target="_blank" rel="noreferrer">Open</a>}</p>
              )}
              {d.shippedAt && (
                <div className="text-[13px]">
                  Shipped by {d.transporter}{d.vehicleNo && ` (${d.vehicleNo})`}, LR <b>{d.lrNo}</b>{d.lrDate && ` of ${day(d.lrDate)}`}{d.cartons && `, ${d.cartons} cartons`}. {d.lrUrl && <a className="link" href={d.lrUrl} target="_blank" rel="noreferrer">LR copy</a>}
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

              {/* Each dispatch goes on to its next step even once the order is shipped or cancelled: the goods are already on their way. */}
              {next === 1 && <InvoiceStep d={d} bills={tally.sales} buyerInTally={tally.buyerInTally} today={today} late={invoiceLate} pending={pending} onSave={(v) => step(d.id, () => recordDispatchInvoice(orderId, d.id, v))} />}
              {next === 2 && <EwayStep invoiceNo={d.invoiceNo ?? ""} today={today} pending={pending} onSave={(v, file) => step(d.id, async (folder) => recordEwayBill(orderId, d.id, { ...v, path: await uploadDoc(folder, file) }))} />}
              {next === 3 && <ShipStep today={today} pending={pending} qcBlock={owner ? [] : d.qcNotPassed ?? []} onSave={(v, lr, photos) => step(d.id, async (folder) => recordShipping(orderId, d.id, { ...v, lr_path: await uploadDoc(folder, lr), photos: await uploadPhotos(folder, photos) }))} />}
              {next === 4 && <GrnStep d={d} pcs={pcs} late={grnLate} pending={pending} onSave={(v, file) => step(d.id, async (folder) => recordGrn(orderId, d.id, { ...v, path: await uploadDoc(folder, file) }))} />}
              {error[d.id] && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error[d.id]}</p>}
            </article>
          );
        })}
      </div>
      <details className="howto mt-4 border-t border-line pt-3">
        <summary>How dispatch works</summary>
        <p>Purchase from the factory, then invoice the buyer within 4 hours, add the e-way bill, ship with photos and the LR, and collect the buyer&apos;s GRN in time.</p>
      </details>
    </section>
  );
}

const paise = (x: number) => Math.round(x * 100) / 100;
// Rupees with paise when there are any: ₹15,977.50, ₹3,35,528.
const rs = (x: number) => (Number.isInteger(x) ? money(x) : `₹${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type TallyBill = { no: string; date: string; amount: number };

// Copies of the factory's bill and our sales invoice as printed from Tally (a PDF or a photo), kept on record.
// Either can be added or replaced at any time, even after Tally has filled in the numbers.
function Copies({ d, pending, onAttach }: { d: Dispatch; pending: boolean; onAttach: (kind: "bill" | "invoice", file: File) => void }) {
  const one = (kind: "bill" | "invoice", what: string, url: string | null) => (
    <span className="copy">
      {url ? <a className="link" href={url} target="_blank" rel="noreferrer">{what}</a> : <span className="muted">{what}: none yet</span>}
      <label className={`btn sm ${pending ? "disabled" : ""}`}>
        {url ? "Replace" : "Upload"}
        <input type="file" accept={DOC_ACCEPT} className="sr-only" disabled={pending} aria-label={`${url ? "Replace" : "Upload"} the ${what.toLowerCase()}`}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAttach(kind, f); }} />
      </label>
    </span>
  );
  return (
    <div className="copies mt-2 text-[13px]" aria-label="Copies on record">
      {one("bill", "Factory bill copy", d.billUrl)}
      {one("invoice", "Sales invoice copy", d.invoiceUrl)}
    </div>
  );
}

// The foot of a GST bill: goods, GST, round off and the total.
function BillSum({ taxable, gst, rates, total, label }: { taxable: number; gst: number; rates: number[]; total: number; label: string }) {
  const off = paise(total - taxable - gst);
  return (
    <>
      <div><span>Value before GST</span><span>{rs(taxable)}</span></div>
      <div><span>{gstLabel(rates)}</span><span>{rs(gst)}</span></div>
      {off !== 0 && <div><span>Round off</span><span>{off > 0 ? "+" : "−"}{rs(Math.abs(off))}</span></div>}
      <div className="total"><span>{label}</span><span>{rs(total)}</span></div>
    </>
  );
}

// Whether the bill here comes to the bill in Tally.
function TallyMatch({ what, no, total, tally, none, fix }: {
  what: string; no: string; total: number; tally: TallyBill | undefined; none: string; fix?: React.ReactNode;
}) {
  if (!tally) return <p className="tally-match none">{none}</p>;
  const diff = paise(tally.amount - total);
  if (Math.abs(diff) <= 1) return <p className="tally-match ok" role="status">✓ Matches {what.toLowerCase()} {no} in Tally.</p>;
  return (
    <div className="tally-match bad" role="alert">
      <p>{what} {tally.no} is <b>{money(tally.amount)}</b> in Tally, {rs(Math.abs(diff))} {diff > 0 ? "more" : "less"} than this.</p>
      {typeof fix === "string" ? <p className="mt-0.5">{fix}</p> : fix}
    </div>
  );
}

function PurchaseForm({ p, setP, blank, factories, ship, bills, today, pending, copy, setCopy, error, onSubmit, onClose }: {
  p: PurchaseInput; setP: (p: PurchaseInput) => void; blank: (f?: DispatchFactory) => PurchaseInput; factories: DispatchFactory[]; ship: ShipLine[];
  bills: TallyBills["purchases"]; today: string; pending: boolean; copy: File | null; setCopy: (f: File | null) => void;
  error?: string; onSubmit: (e: React.FormEvent) => void; onClose: () => void;
}) {
  const factory = factories.find((f) => f.id === p.factory_id);
  // The factory's bills in Tally aren't listed: the typed number is only checked against them.
  const mine = bills.filter((b) => b.factory_id === p.factory_id);
  const tally = mine.find((b) => b.no.toLowerCase() === p.bill_no.trim().toLowerCase());
  const bill = garmentBill(p.lines.map((l) => ({ qty: n(l.qty), rate: n(l.purchase_rate) })));
  return (
    <form onSubmit={onSubmit} className="mb-4 flex flex-col gap-4 rounded-[10px] border border-line p-3">
      <div className="row">
        <h3 className="font-semibold">{ship.some((l) => l.bought > 0) ? "Next part: the factory\u2019s bill" : "Purchase: the factory\u2019s bill"}</h3>
        {factories.length === 1 && <span className="muted text-[13px]">from {factories[0].name}</span>}
      </div>
      {factories.length > 1 && (
        <label className="field max-w-[320px]">
          <span>Factory <i>*</i></span>
          <select className="inp" value={p.factory_id} onChange={(e) => { setP(blank(factories.find((f) => f.id === e.target.value))); }} aria-label="Purchase factory">
            <option value="">Pick the factory</option>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      {factory && (
        <div className="fgrid">
          <label className="field">
            <span>Bill number <i>*</i></span>
            <input className="inp" value={p.bill_no} onChange={(e) => setP({ ...p, bill_no: e.target.value })} aria-label="Factory bill number" placeholder="As printed on the bill" />
          </label>
          <label className="field">
            <span>Bill date <i>*</i></span>
            <input className="inp" type="date" max={today} value={p.bill_date} onChange={(e) => setP({ ...p, bill_date: e.target.value })} aria-label="Factory bill date" />
          </label>
          <label className="field">
            <span>Copy of the bill</span>
            <input className="inp" type="file" accept={DOC_ACCEPT} onChange={(e) => setCopy(e.target.files?.[0] ?? null)} aria-label="Copy of the factory bill" />
            <small>{copy ? copy.name : "PDF or photo, for the record. You can add it later too."}</small>
          </label>
        </div>
      )}
      {factory && (
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium">What the bill is for</p>
          <div className="bill-lines">
            <div className="bill-line hidden text-[12px] text-muted sm:grid" aria-hidden><span>Style</span><span>Pieces bought</span><span>Purchase rate ₹</span><span>Sale rate ₹</span></div>
            {p.lines.map((l, i) => {
              const line = factory.lines.find((x) => x.id === l.line_id);
              const set = (k: "qty" | "purchase_rate" | "sale_rate", v: string) => setP({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
              const sh = ship.find((x) => x.id === l.line_id);
              const left = sh ? sh.ordered - sh.bought : 0;
              const over = sh && n(l.qty) > Math.max(0, left) ? n(l.qty) - Math.max(0, left) : 0;
              return (
                <div key={l.line_id} className="bill-line">
                  <div className="who">
                    <b className="code">{line?.style}{line?.colour && <span className="muted font-normal"> · {line.colour}</span>}</b>
                    <span className="muted text-[12px]">
                      {!sh?.bought ? `${qty(line?.qty)} ordered` : left > 0 ? `${qty(sh.bought)} of ${qty(sh.ordered)} bought · ${qty(left)} left` : `All ${qty(sh.ordered)} bought`}
                    </span>
                    {over > 0 && <span className="text-[12px] font-semibold text-warn">{qty(over)} more than ordered</span>}
                  </div>
                  <label><span className="sm:hidden">Pieces bought</span><input className="inp" inputMode="numeric" value={l.qty} onChange={(e) => set("qty", e.target.value)} aria-label={`${line?.style} pieces bought`} /></label>
                  <label><span className="sm:hidden">Purchase rate ₹</span><input className="inp" inputMode="decimal" value={l.purchase_rate} onChange={(e) => set("purchase_rate", e.target.value)} aria-label={`${line?.style} purchase rate`} /></label>
                  <label><span className="sm:hidden">Sale rate ₹</span><input className="inp" inputMode="decimal" value={l.sale_rate} onChange={(e) => set("sale_rate", e.target.value)} aria-label={`${line?.style} sale rate`} /></label>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {factory && bill.taxable > 0 && (
        <div className="bill-sum" aria-label="Bill total">
          <BillSum taxable={bill.taxable} gst={bill.gst} rates={bill.rates} total={bill.total} label="Bill total" />
          <TallyMatch what="Bill" no={tally?.no ?? ""} total={bill.total} tally={tally}
            none={p.bill_no.trim() ? `Not in Tally yet. It links by itself once Accounts books bill ${p.bill_no.trim()} in Tally.` : "Enter the bill number to check it against Tally."}
            fix="Check the pieces and rates against the paper bill." />
        </div>
      )}
      <div>
        <div className="row">
          <button className="btn primary" disabled={pending || !factory}>{pending ? "Saving…" : "Save purchase"}</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
        </div>
        <p className="muted mt-2 text-[13px]">GST is worked out for you: 5% on styles up to ₹2,500 a piece, 18% above. Saving starts the 4 hours to invoice the buyer.</p>
      </div>
    </form>
  );
}

function InvoiceStep({ d, bills, buyerInTally, today, late, pending, onSave }: {
  d: Dispatch; bills: TallyBills["sales"]; buyerInTally: boolean; today: string; late: boolean; pending: boolean;
  onSave: (v: { invoice_no: string; invoice_date: string; taxable: string }) => void;
}) {
  const pcs = d.lines.reduce((s, l) => s + l.qty, 0);
  const sale = d.lines.length && d.lines.every((l) => l.saleRate != null) ? garmentBill(d.lines.map((l) => ({ qty: l.qty, rate: l.saleRate ?? 0 }))) : null;
  const [v, setV] = useState({ invoice_no: "", invoice_date: today, taxable: sale?.taxable ? String(sale.taxable) : "" });
  // The invoice comes from Tally by itself when the buyer is in Tally and the sale rates are known; typing is the fallback.
  const auto = buyerInTally && !!sale && sale.taxable > 0;
  const [manual, setManual] = useState(false);
  const due = (
    <p className={`text-[13px] font-semibold ${late ? "text-bad" : "text-warn"}`}>
      {late ? `Emergency: the invoice was due by ${at.format(new Date(d.invoiceDueAt))}.` : `Invoice the buyer by ${at.format(new Date(d.invoiceDueAt))}.`}
    </p>
  );
  if (auto && !manual) {
    return (
      <div className="mt-3 flex flex-col gap-3 rounded-[10px] bg-surface-2 p-3">
        {due}
        <div className="tally-wait" role="status">
          <div className="say">
            <b><span className="dot" aria-hidden />Waiting for the invoice from Tally</b>
            <span>Make the sales invoice in Tally for <b className="num">{rs(sale.total)}</b>, with its e-way bill.</span>
            <span className="muted text-[13px]">The app picks up its number, date and e-way bill by itself, within about 15 minutes while Tally is open on the office PC. It then goes into Payments.</span>
          </div>
          <div className="bill-sum" aria-label="Invoice total">
            <BillSum taxable={sale.taxable} gst={sale.gst} rates={sale.rates} total={sale.total} label="Invoice total" />
          </div>
        </div>
        <button type="button" className="btn sm self-start" onClick={() => setManual(true)}>Enter it by hand instead</button>
      </div>
    );
  }
  const taxable = n(v.taxable);
  // The same as the database: the styles' own GST rates when every sale rate is known, else the average piece's.
  const ratio = sale && sale.taxable > 0 ? sale.gst / sale.taxable : gstRate(taxable / Math.max(pcs, 1));
  const rates = sale && sale.taxable > 0 ? sale.rates : [gstRate(taxable / Math.max(pcs, 1))];
  const gst = paise(taxable * ratio);
  const tally = bills.find((b) => b.no.toLowerCase() === v.invoice_no.trim().toLowerCase());
  const off = tally ? Math.abs(tally.amount - (taxable + gst)) > 1 : false;
  const total = tally && !off ? tally.amount : Math.round(taxable + gst);
  return (
    <form className="mt-3 flex flex-col gap-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      {due}
      {!buyerInTally && <p className="muted text-[13px]">This buyer has no ledger in Tally yet, so enter the invoice here once it&apos;s made.</p>}
      <div className="fgrid">
        <label className="field"><span>Tally invoice number <i>*</i></span><input className="inp" value={v.invoice_no} onChange={(e) => setV({ ...v, invoice_no: e.target.value })} aria-label="Invoice number" placeholder="SPL/26-27/…" /></label>
        <label className="field"><span>Invoice date <i>*</i></span><input className="inp" type="date" value={v.invoice_date} onChange={(e) => setV({ ...v, invoice_date: e.target.value })} aria-label="Invoice date" /></label>
        <label className="field">
          <span>Value before GST ₹ <i>*</i></span>
          <input className="inp" inputMode="decimal" value={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.value })} aria-label="Invoice value before GST" />
          <small>{sale ? `${qty(pcs)} pcs at the sale rates.` : "Pieces times the sale rate."}</small>
        </label>
      </div>
      {taxable > 0 && (
        <div className="bill-sum" aria-label="Invoice total">
          <BillSum taxable={taxable} gst={gst} rates={rates} total={total} label="Invoice total" />
          <TallyMatch what="Invoice" no={tally?.no ?? ""} total={taxable + gst} tally={tally}
            none={v.invoice_no.trim() ? "Not in Tally yet: make it in Tally with its e-way bill, so the e-way bill fills in by itself." : "Enter the invoice number from Tally."}
            fix={tally && <button type="button" className="btn sm mt-1.5" onClick={() => setV({ ...v, taxable: String(paise(tally.amount / (1 + ratio))) })}>Use Tally&apos;s value</button>} />
        </div>
      )}
      <div className="row">
        <button className="btn primary" disabled={pending || off}>{pending ? "Saving…" : "Save invoice"}</button>
        {auto && <button type="button" className="btn" onClick={() => setManual(false)}>Wait for Tally instead</button>}
        <span className="muted text-[13px]">It also goes into Payments{tally?.eway ? `, with e-way bill ${tally.eway}` : ""}.</span>
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
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => {
      e.preventDefault();
      // The same checks as the server, before the copy is uploaded, so a refused form leaves no file behind.
      if (!/^\d{12}$/.test(v.no.replace(/\s/g, ""))) return setErr("An e-way bill number has 12 digits.");
      if (!isDate(v.date)) return setErr("Enter the e-way bill date.");
      if (!file) return setErr("Attach the e-way bill.");
      setErr("");
      onSave(v, file);
    }}>
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

function ShipStep({ today, pending, qcBlock, onSave }: {
  today: string; pending: boolean; qcBlock: string[]; onSave: (v: Omit<ShippingInput, "lr_path" | "photos">, lr: File, photos: File[]) => void;
}) {
  const [v, setV] = useState({ transporter: "", vehicle_no: "", lr_no: "", lr_date: today, cartons: "" });
  const [lr, setLr] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [err, setErr] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    // The same checks as the server, before anything is uploaded, so a refused form leaves no files behind.
    if (qcBlock.length) return setErr(`Final QC has not passed for ${qcBlock.join(", ")}. Quality must pass it before these goods ship.`);
    if (!photos.length) return setErr("Add photos of the goods.");
    if (!lr) return setErr("Attach the LR copy.");
    if (!v.transporter.trim()) return setErr("Enter the transporter.");
    if (!v.lr_no.trim() || !isDate(v.lr_date)) return setErr("Enter the LR number and date.");
    const cartons = digits(v.cartons);
    if (cartons !== "" && !(Number.isInteger(Number(cartons)) && Number(cartons) > 0)) return setErr("Cartons must be a whole number.");
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
    <form className="mt-3 rounded-[10px] bg-surface-2 p-3" onSubmit={(e) => {
      e.preventDefault();
      if (!file) return setErr("Attach the GRN report.");
      // The same check as the server, before the report is uploaded.
      const q = digits(v.received_qty);
      if (q === "" || !Number.isInteger(Number(q)) || Number(q) < 0) return setErr("Enter the pieces the buyer received.");
      setErr("");
      onSave(v, file);
    }}>
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

// Where the order's pieces are, style by style, and what is left to send. An order whose rest won't go
// (the buyer took less, or the factory can't make it) is closed short here, with the reason.
function ShipSummary({ orderId, orderNo, ship, open, closedShort, pending, start, onRefresh }: {
  orderId: string; orderNo: string; ship: ShipLine[]; open: boolean; closedShort: { at: string; reason: string; by: string } | null;
  pending: boolean; start: React.TransitionStartFunction; onRefresh: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const ordered = ship.reduce((t, l) => t + l.ordered, 0);
  const shipped = ship.reduce((t, l) => t + l.shipped, 0);
  const billed = ship.reduce((t, l) => t + l.billed, 0);
  const unbilled = ship.reduce((t, l) => t + Math.max(0, l.ordered - l.billed), 0);
  const toShip = ship.reduce((t, l) => t + Math.max(0, l.ordered - l.shipped), 0);
  // Of what is still to ship: pieces already bought on a dispatch on its way, and the rest not bought yet.
  const moving = ship.reduce((t, l) => t + Math.max(0, Math.min(l.ordered, l.bought) - l.shipped), 0);
  function close(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setErr("Say why the rest won't be sent.");
    setErr("");
    start(async () => {
      const res = await closeShort(orderId, reason);
      if (res.error) return setErr(res.error);
      setClosing(false);
      onRefresh();
    });
  }
  return (
    <div className="ship-sum mb-3" aria-label="Pieces shipped">
      <div className="row">
        <b className="text-[14px]">{toShip === 0 ? `All ${qty(ordered)} pcs shipped` : `${qty(shipped)} of ${qty(ordered)} pcs shipped`}</b>
        {closedShort ? <span className="chip warn">Closed short</span> : toShip > moving && shipped > 0 ? <span className="chip info">{qty(toShip - moving)} to send</span>
          : moving > 0 && shipped > 0 ? <span className="chip info">{qty(moving)} on the way</span> : null}
      </div>
      <ul className="ship-lines">
        {ship.map((l) => (
          <li key={l.id}>
            <span className="code">{l.style}{l.colour && <span className="muted font-normal"> · {l.colour}</span>}</span>
            <span className="bar" aria-hidden><i className="ok" style={{ width: `${Math.min(100, (100 * l.shipped) / Math.max(1, l.ordered))}%` }} /></span>
            <span className="num text-[13px]">
              {qty(l.shipped)}/{qty(l.ordered)}
              {l.bought > l.shipped && <span className="muted"> · {qty(l.bought - l.shipped)} on the way</span>}
            </span>
          </li>
        ))}
      </ul>
      {closedShort && (
        <p className="mt-2 text-[13px]">Closed short with {qty(billed)} of {qty(ordered)} pcs by {closedShort.by}, {at.format(new Date(closedShort.at))}: {closedShort.reason}</p>
      )}
      {open && unbilled > 0 && billed > 0 && !closing && (
        <div className="row mt-2">
          <p className="muted grow text-[13px]">The order stays open until the rest is sent. If the rest won&apos;t go, close it short with the quantity shipped.</p>
          <button type="button" className="btn sm" onClick={() => setClosing(true)}>Close short</button>
        </div>
      )}
      {open && closing && (
        <form className="mt-3 flex flex-col gap-2 rounded-[10px] bg-surface-2 p-3" onSubmit={close}>
          <p className="text-[13px] font-semibold text-warn">Close {orderNo} with {qty(billed)} of {qty(ordered)} pcs? The other {qty(unbilled)} won&apos;t be sent.</p>
          <label className="field">
            <span>Why <i>*</i></span>
            <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why the rest won't be sent" placeholder="For example: buyer accepted 579 pcs" autoFocus />
          </label>
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? "Closing…" : "Close short"}</button>
            <button type="button" className="btn" onClick={() => { setClosing(false); setErr(""); }}>Keep open</button>
            {err && <span className="text-[13px] font-semibold text-bad" role="alert">{err}</span>}
          </div>
          <p className="muted text-[12px]">The order is marked shipped and the owner sees the reason in the morning brief. Opening it again later undoes this.</p>
        </form>
      )}
    </div>
  );
}
