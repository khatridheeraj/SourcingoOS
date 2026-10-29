"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { money, qtyTotal } from "@/lib/format";
import { NO_WARNINGS, overdueText, type OrderWarnings, type Overdue } from "@/lib/order-checks";
import { PO_ACCEPT, poFileProblem, uploadPoFiles } from "@/lib/po-upload";
import { checkOrder, saveOrder, type LineInput, type OrderInput } from "./actions";

type Option = { id: string; label: string };

const blankLine = (): LineInput => ({ style: "", description: "", colour: "", qty: "", buyer_rate: "", factory_id: "", factory_rate: "" });
const n = (s: string) => Number(s.replace(/[,₹\s]/g, "")) || 0;

// overdueShown: the buyer whose overdue invoices the page already warns about, so the form doesn't say it twice.
// inquiryId: the buyer inquiry this new order comes from.
// companyId: given on a new order typed in by hand, so the buyer's PO file can go with it.
export function OrderForm({ initial, initialLines, buyers, factories, team, incomingId, inquiryId, overdueShown, companyId }: {
  initial: OrderInput;
  initialLines: LineInput[];
  buyers: Option[];
  factories: Option[];
  team: Option[];
  incomingId?: string;
  inquiryId?: string;
  overdueShown?: string;
  companyId?: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [lines, setLines] = useState<LineInput[]>(initialLines.length ? initialLines : [blankLine()]);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<{ id: string; orderNo: string } | null>(null);
  // The order was saved but something after it (linking the incoming PO) failed: say so, and don't move on as if all went fine.
  const [warning, setWarning] = useState("");
  const [created, setCreated] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // Other orders this one may repeat, and the buyer's overdue invoices, checked a moment after typing stops.
  const [checks, setChecks] = useState<{ key: string; warnings: OrderWarnings; overdue: Overdue | null }>({ key: "", warnings: NO_WARNINGS, overdue: null });
  // A very similar PO number is already an order: the next save needs "Save anyway".
  const [confirming, setConfirming] = useState(false);
  // The buyer's PO file picked before saving; it is uploaded once the order exists.
  const [poFiles, setPoFiles] = useState<File[]>([]);
  const [poError, setPoError] = useState("");
  const withFile = !!companyId && !initial.id && !incomingId;
  // A new order is just the buyer's PO: the factory and its rate are picked next, with Start production on the order.
  const fac = !!initial.id;

  const styles = lines.map((l) => l.style.trim()).filter(Boolean);
  const checkKey = JSON.stringify([order.buyer_id, order.buyer_po.trim(), styles]);
  useEffect(() => {
    if (!order.buyer_id) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await checkOrder({ id: order.id, buyer_id: order.buyer_id, buyer_po: order.buyer_po }, styles).catch(() => null);
      if (live && res) setChecks({ key: checkKey, ...res });
    }, 500);
    return () => { live = false; clearTimeout(t); };
    // checkKey holds the buyer, PO number and styles the check depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);
  // Only what was checked for this buyer still shows while a new check runs.
  const shown = order.buyer_id && checks.key && JSON.parse(checks.key)[0] === order.buyer_id ? checks : { warnings: NO_WARNINGS, overdue: null };
  const buyerLabel = buyers.find((b) => b.id === order.buyer_id)?.label ?? "";

  const set = (k: keyof OrderInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setOrder({ ...order, [k]: e.target.value });
    setSaved(false);
    if (k === "buyer_id" || k === "buyer_po") setConfirming(false);
  };
  const setLine = (i: number, k: keyof LineInput, v: string) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    setSaved(false);
  };

  // A style described "Fabric" is saved as fabric (bought by the metre), as the database does.
  const isFabric = (l: LineInput) => ["fabric", "fabrics"].includes(l.description.trim().toLowerCase());
  const total = qtyTotal(lines.map((l) => ({ qty: n(l.qty), product: isFabric(l) ? "fabric" : "garment" })));
  const value = lines.reduce((s, l) => s + n(l.qty) * n(l.buyer_rate), 0);
  const cost = lines.reduce((s, l) => s + n(l.qty) * n(l.factory_rate), 0);

  function save(confirmed: boolean) {
    setError("");
    setWarning("");
    setExisting(null);
    start(async () => {
      const res = await saveOrder(order, lines, incomingId, confirmed, inquiryId);
      if (res.confirm) {
        setChecks({ key: checkKey, warnings: res.confirm, overdue: shown.overdue });
        setConfirming(true);
        return;
      }
      setConfirming(false);
      if (res.error && !res.id) {
        setExisting(res.existing ?? null);
        return setError(res.error);
      }
      setSaved(true);
      if (res.error) {
        setWarning(res.error);
        if (!order.id && res.id) return setCreated(res.id);
        return router.refresh();
      }
      if (!order.id && res.id && withFile && poFiles.length) {
        const up = await uploadPoFiles(companyId!, res.id, poFiles);
        if (up.error) {
          setWarning(`Order saved, but the PO file didn't go with it (${up.error}). Add it in the order's Details.`);
          return setCreated(res.id);
        }
      }
      if (!order.id && res.id) router.replace(`/orders/${res.id}?saved=1`);
      else router.refresh();
    });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false);
  }

  const w = shown.warnings;
  const orderLink = (o: { id: string; order_no: string }) => <Link href={`/orders/${o.id}`} className="link code" target="_blank">{o.order_no}</Link>;
  // On an order already confirmed the warning only matters when its buyer is being changed.
  const showOverdue = shown.overdue && order.buyer_id !== overdueShown && !(initial.id && order.buyer_id === initial.buyer_id);
  const hasChecks = showOverdue || w.same_po.length > 0 || w.similar_po.length > 0 || w.same_style.length > 0;

  const notesField = (
    <label className="field mt-3">
      <span>Notes</span>
      <textarea className="inp" value={order.notes} onChange={set("notes")} rows={2} />
    </label>
  );
  const termsField = order.buyer_terms !== undefined && (
    <label className="field mt-3">
      <span>Buyer&apos;s terms</span>
      <textarea className="inp" value={order.buyer_terms} onChange={set("buyer_terms")} rows={2} maxLength={2000}
        placeholder="Inspection 3 days before dispatch, 2% penalty a week late, packing and labelling rules" />
    </label>
  );

  return (
    <form onSubmit={submit} className="stack">
      <div className="panel scroll-mt-20" id="details">
        <h2>Buyer PO</h2>
        <div className="fgrid">
          <label className="field">
            <span>Buyer <i>*</i></span>
            <select className="inp" value={order.buyer_id} onChange={set("buyer_id")} required>
              <option value="">Pick a buyer</option>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Buyer PO number <i>*</i></span>
            <input className="inp" value={order.buyer_po} onChange={set("buyer_po")} required placeholder="As printed on the buyer's PO" />
          </label>
          <label className="field">
            <span>PO date</span>
            <input className="inp" type="date" value={order.po_date} onChange={set("po_date")} />
          </label>
          <label className="field">
            <span>Ship date</span>
            <input className="inp" type="date" min={order.po_date || undefined} value={order.ship_date} onChange={set("ship_date")} />
          </label>
          <label className="field">
            <span>Merchandiser</span>
            <select className="inp" value={order.merchandiser_id} onChange={set("merchandiser_id")}>
              <option value="">Not assigned</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {/* A new order is always open; Status only matters once it exists. */}
          {initial.id && <label className="field">
            <span>Status</span>
            <select className="inp" value={order.status} onChange={set("status")}>
              <option value="open">Open</option>
              {/* Shipped is set with Mark shipped on the order, which first checks the factory bill and invoice are in Dispatch. */}
              <option value="shipped" disabled={order.status !== "shipped"}>{order.status === "shipped" ? "Shipped" : "Shipped (use Mark shipped)"}</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>}
        </div>
        {withFile && (
          <div className="field mt-3">
            <span>Buyer&apos;s PO file</span>
            <div className="row">
              <label className="btn sm">
                {poFiles.length ? "Change file" : "Attach PO file"}
                <input type="file" multiple accept={PO_ACCEPT} className="sr-only" aria-label="Buyer's PO file"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    const problem = files.map(poFileProblem).find(Boolean) ?? "";
                    setPoError(problem);
                    if (!problem) setPoFiles(files);
                  }} />
              </label>
              {poFiles.length > 0 ? (
                <>
                  <span className="min-w-0 truncate text-[13px] font-semibold">{poFiles.map((f) => f.name).join(", ")}</span>
                  <button type="button" className="btn sm ghost" onClick={() => setPoFiles([])}>Remove</button>
                </>
              ) : <span className="muted text-[12.5px]">PDF, Excel, or a photo or screenshot from WhatsApp. Needed before a factory PO is locked; you can add it later too.</span>}
            </div>
            {poError && <span className="text-[12.5px] font-semibold text-bad" role="alert">{poError}</span>}
          </div>
        )}
        {/* On a new order these are extras: folded away unless the PO already filled them in. */}
        {initial.id ? <>{notesField}{termsField}</> : (
          <details className="mt-3" open={!!(initial.notes || initial.buyer_terms)}>
            <summary className="cursor-pointer text-[13px] font-semibold text-accent">Notes and buyer&apos;s terms</summary>
            {notesField}{termsField}
          </details>
        )}
      </div>

      <div className="panel">
        <h2>Styles</h2>
        <div className="table-wrap">
          <table className="tbl lines-tbl">
            <thead>
              <tr>
                <th>Style no. *</th><th>Description</th><th>Colour</th><th>Qty *</th>
                <th>Buyer rate ₹</th>{fac && <><th>Factory</th><th>Factory rate ₹</th></>}<th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="Style no."><input className="inp min-w-[110px]" value={l.style} onChange={(e) => setLine(i, "style", e.target.value)} aria-label={`Line ${i + 1} style`} /></td>
                  <td data-label="Description"><input className="inp min-w-[140px]" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} aria-label={`Line ${i + 1} description`} /></td>
                  <td data-label="Colour"><input className="inp min-w-[90px]" value={l.colour} onChange={(e) => setLine(i, "colour", e.target.value)} aria-label={`Line ${i + 1} colour`} /></td>
                  <td data-label="Qty"><input className="inp w-[90px]" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder={isFabric(l) ? "metres" : "pcs"} aria-label={`Line ${i + 1} quantity in ${isFabric(l) ? "metres" : "pieces"}`} /></td>
                  <td data-label="Buyer rate ₹"><input className="inp w-[90px]" inputMode="decimal" value={l.buyer_rate} onChange={(e) => setLine(i, "buyer_rate", e.target.value)} aria-label={`Line ${i + 1} buyer rate`} /></td>
                  {fac && <><td data-label="Factory">
                    <select className="inp min-w-[150px]" value={l.factory_id} onChange={(e) => setLine(i, "factory_id", e.target.value)} aria-label={`Line ${i + 1} factory`}>
                      <option value="">Not decided</option>
                      {factories.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </td>
                  <td data-label="Factory rate ₹"><input className="inp w-[90px]" inputMode="decimal" value={l.factory_rate} onChange={(e) => setLine(i, "factory_rate", e.target.value)} aria-label={`Line ${i + 1} factory rate`} /></td></>}
                  <td>
                    <button type="button" className="btn sm danger" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row mt-3">
          <button type="button" className="btn sm" onClick={() => setLines([...lines, blankLine()])}>Add style</button>
          {fac ? <span className="muted text-xs">Factory missing from the list? <Link href="/factories" className="link">Add it in Factories</Link>.</span>
            : <span className="muted text-xs">The factory and its rate come next, when you start production.</span>}
        </div>
      </div>

      {hasChecks && (
        <div className="stack" aria-live="polite">
          {showOverdue && shown.overdue && <div className="warnbox" role="status">{overdueText(buyerLabel, shown.overdue)}</div>}
          {w.same_po.map((o) => (
            <div key={o.id} className="errbox" role="alert">
              PO {o.buyer_po} from this buyer is already order {orderLink(o)}. A PO can be entered only once. Add new styles on that order.
            </div>
          ))}
          {w.similar_po.length > 0 && (
            <div className="warnbox" role="status">
              <b>This PO number looks like one already entered.</b>{" "}
              {w.similar_po.map((o, i) => <span key={o.id}>{i > 0 && ", "}PO {o.buyer_po} is order {orderLink(o)}</span>)}.
              {" "}Check it is not the same PO before saving.
              {confirming && (
                <div className="row mt-2">
                  <button type="button" className="btn primary sm" disabled={pending} onClick={() => save(true)}>{pending ? "Saving…" : "Save anyway"}</button>
                  <button type="button" className="btn sm" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              )}
            </div>
          )}
          {w.same_style.length > 0 && (
            <div className="warnbox" role="status">
              <b>{w.same_style.length === 1 ? "A style here is already on an open order." : "Styles here are already on open orders."}</b>
              <ul className="mt-1">
                {w.same_style.map((o) => <li key={o.id}>{o.styles.join(", ")} on {orderLink(o)} (PO {o.buyer_po})</li>)}
              </ul>
              A buyer can repeat a style. Check this is a new PO and not a copy.
            </div>
          )}
        </div>
      )}

      <div className="sticky-actions">
        <div className="grow text-[13px]">
          <b className="num">{total}</b>
          {value > 0 && <> · buyer value <b className="num">{money(value)}</b></>}
          {cost > 0 && value > 0 && <> · margin <b className="num">{money(value - cost)}</b></>}
        </div>
        {confirming && <span className="text-[13px] font-semibold text-warn">Check the warning above, then Save anyway.</span>}
        {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
        {existing && <Link href={`/orders/${existing.id}`} className="link text-[13px] font-semibold">Open {existing.orderNo}</Link>}
        {warning && <span className="text-[13px] font-semibold text-warn" role="status">{warning}</span>}
        {created && <Link href={`/orders/${created}`} className="link text-[13px] font-semibold">Open the order</Link>}
        {saved && !error && !warning && <span className="text-[13px] font-semibold text-ok">Saved</span>}
        <button className="btn primary" disabled={pending || !!created || confirming}>{pending ? "Saving…" : order.id ? "Save changes" : "Create order"}</button>
      </div>
    </form>
  );
}
