"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { money, qty as fmtQty } from "@/lib/format";
import { saveOrder, type LineInput, type OrderInput } from "./actions";

type Option = { id: string; label: string };

const blankLine = (): LineInput => ({ style: "", description: "", colour: "", qty: "", buyer_rate: "", factory_id: "", factory_rate: "" });
const n = (s: string) => Number(s.replace(/[,₹\s]/g, "")) || 0;

export function OrderForm({ initial, initialLines, buyers, factories, team, incomingId }: {
  initial: OrderInput;
  initialLines: LineInput[];
  buyers: Option[];
  factories: Option[];
  team: Option[];
  incomingId?: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [lines, setLines] = useState<LineInput[]>(initialLines.length ? initialLines : [blankLine()]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const set = (k: keyof OrderInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setOrder({ ...order, [k]: e.target.value });
    setSaved(false);
  };
  const setLine = (i: number, k: keyof LineInput, v: string) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
    setSaved(false);
  };

  const pieces = lines.reduce((s, l) => s + n(l.qty), 0);
  const value = lines.reduce((s, l) => s + n(l.qty) * n(l.buyer_rate), 0);
  const cost = lines.reduce((s, l) => s + n(l.qty) * n(l.factory_rate), 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await saveOrder(order, lines, incomingId);
      if (res.error && !res.id) return setError(res.error);
      setSaved(true);
      if (!order.id && res.id) router.replace(`/orders/${res.id}?saved=1`);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="panel">
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
            <input className="inp" type="date" value={order.ship_date} onChange={set("ship_date")} />
          </label>
          <label className="field">
            <span>Merchandiser</span>
            <select className="inp" value={order.merchandiser_id} onChange={set("merchandiser_id")}>
              <option value="">Not assigned</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select className="inp" value={order.status} onChange={set("status")}>
              <option value="open">Open</option>
              <option value="shipped">Shipped</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <label className="field mt-3">
          <span>Notes</span>
          <textarea className="inp" value={order.notes} onChange={set("notes")} rows={2} />
        </label>
      </div>

      <div className="panel">
        <h2>Styles</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Style no. *</th><th>Description</th><th>Colour</th><th>Qty *</th>
                <th>Buyer rate ₹</th><th>Factory</th><th>Factory rate ₹</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input className="inp min-w-[110px]" value={l.style} onChange={(e) => setLine(i, "style", e.target.value)} aria-label={`Line ${i + 1} style`} /></td>
                  <td><input className="inp min-w-[140px]" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} aria-label={`Line ${i + 1} description`} /></td>
                  <td><input className="inp min-w-[90px]" value={l.colour} onChange={(e) => setLine(i, "colour", e.target.value)} aria-label={`Line ${i + 1} colour`} /></td>
                  <td><input className="inp w-[90px]" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} aria-label={`Line ${i + 1} quantity`} /></td>
                  <td><input className="inp w-[90px]" inputMode="decimal" value={l.buyer_rate} onChange={(e) => setLine(i, "buyer_rate", e.target.value)} aria-label={`Line ${i + 1} buyer rate`} /></td>
                  <td>
                    <select className="inp min-w-[150px]" value={l.factory_id} onChange={(e) => setLine(i, "factory_id", e.target.value)} aria-label={`Line ${i + 1} factory`}>
                      <option value="">Not decided</option>
                      {factories.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                  </td>
                  <td><input className="inp w-[90px]" inputMode="decimal" value={l.factory_rate} onChange={(e) => setLine(i, "factory_rate", e.target.value)} aria-label={`Line ${i + 1} factory rate`} /></td>
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
          <span className="muted text-xs">Factory missing from the list? <Link href="/factories" className="link">Add it in Factories</Link>.</span>
        </div>
      </div>

      <div className="sticky-actions">
        <div className="grow text-[13px]">
          <b className="num">{fmtQty(pieces)}</b> pcs
          {value > 0 && <> · buyer value <b className="num">{money(value)}</b></>}
          {cost > 0 && value > 0 && <> · margin <b className="num">{money(value - cost)}</b></>}
        </div>
        {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
        {saved && !error && <span className="text-[13px] font-semibold text-ok">Saved</span>}
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : order.id ? "Save changes" : "Save order"}</button>
      </div>
    </form>
  );
}
