"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { costingMath, CURRENCIES, money } from "@/lib/model";
import { type CostingInput, deleteCosting, saveCosting } from "../../costing-actions";

const STATUS = [["draft", "Working"], ["quoted", "Quoted to buyer"], ["accepted", "Buyer accepted"], ["rejected", "Buyer rejected"]] as const;
const EXTRA_HINTS = ["Freight to buyer", "Testing", "Packing material", "Sampling", "Agent commission", "Inspection"];

export function CostSheet({ initial, factories, canDelete }: { initial: CostingInput; factories: { id: string; label: string }[]; canDelete?: boolean }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [c, setC] = useState<CostingInput>(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(c) !== JSON.stringify(initial);
  const set = <K extends keyof CostingInput>(k: K, v: CostingInput[K]) => setC({ ...c, [k]: v });
  const m = costingMath({ ...c, extras: c.extras.map((e) => ({ ...e, amount: Number(e.amount) || 0 })) });
  const q = Number(c.quoted_price) || 0;
  const below = q > 0 && m.realMargin != null && m.realMargin < Number(c.margin_pct || 0);

  return (
    <form className="panel stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveCosting(c);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (!r.error) { if (!c.id) setC(initial); router.refresh(); }
      });
    }}>
      <div className="fgrid">
        <label className="field"><span>Style <i>*</i></span><input className="inp" value={c.style_name} onChange={(e) => set("style_name", e.target.value)} placeholder="Printed kurta, cambric 60s" /></label>
        <label className="field"><span>Quantity</span><input className="inp" type="number" min={0} value={c.qty} onChange={(e) => set("qty", e.target.value)} /></label>
        <label className="field"><span>Currency</span><select className="inp" value={c.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Factory</span>
          <select className="inp" value={c.factory_id} onChange={(e) => set("factory_id", e.target.value)}>
            <option value="">Not decided</option>{factories.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <div className="fgrid">
        <label className="field"><span>Factory price per piece</span><input className="inp" type="number" min={0} step="0.01" value={c.factory_cost} onChange={(e) => set("factory_cost", e.target.value)} /></label>
        <label className="field"><span>Overhead %</span><input className="inp" type="number" min={0} max={100} step="0.1" value={c.overhead_pct} onChange={(e) => set("overhead_pct", e.target.value)} /></label>
        <label className="field"><span>Target margin %</span><input className="inp" type="number" min={0} max={99} step="0.1" value={c.margin_pct} onChange={(e) => set("margin_pct", e.target.value)} /></label>
        <label className="field"><span>Status</span>
          <select className="inp" value={c.status} onChange={(e) => set("status", e.target.value as CostingInput["status"])}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="sub">Our costs per piece</span>
        {c.extras.map((e, i) => (
          <div key={i} className="row">
            <input className="inp" style={{ maxWidth: 240 }} list="extra-hints" value={e.label} placeholder="Freight to buyer" aria-label="Cost name"
              onChange={(ev) => set("extras", c.extras.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} />
            <input className="inp" style={{ maxWidth: 120 }} type="number" min={0} step="0.01" value={String(e.amount)} aria-label="Amount"
              onChange={(ev) => set("extras", c.extras.map((x, j) => (j === i ? { ...x, amount: ev.target.value as unknown as number } : x)))} />
            <button type="button" className="btn icon" aria-label="Remove" onClick={() => set("extras", c.extras.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <datalist id="extra-hints">{EXTRA_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
        <div><button type="button" className="btn sm" onClick={() => set("extras", [...c.extras, { label: "", amount: 0 }])}>+ Cost</button></div>
      </div>
      <div className="tiles">
        <div className="tile"><span>Our cost per piece</span><b className="money">{money(m.cost, c.currency)}</b><small>Factory + our costs + overhead</small></div>
        <div className="tile blue"><span>Price for {c.margin_pct || 0}% margin</span><b className="money">{money(m.suggested, c.currency)}</b>
          <small><button type="button" className="link" onClick={() => set("quoted_price", String(m.suggested))}>Use this price</button></small></div>
        <label className={`tile ${below ? "yellow" : "green"}`}><span>Price quoted to buyer</span>
          <input className="inp mt-1.5" type="number" min={0} step="0.01" value={c.quoted_price} onChange={(e) => set("quoted_price", e.target.value)} aria-label="Quoted price" />
          <small>{m.realMargin != null ? `${m.realMargin.toFixed(1)}% margin${Number(c.qty) ? ` · ${money((q - m.cost) * Number(c.qty), c.currency)} on ${c.qty} pcs` : ""}` : "Not quoted yet"}</small>
        </label>
      </div>
      <label className="field"><span>Notes</span><textarea className="inp" rows={2} value={c.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Factory quote valid till 15 Oct; buyer asked for ₹10 less" /></label>
      <div className="row">
        <button className="btn primary" disabled={pending || !dirty}>{pending ? "Saving…" : c.id ? "Save" : "Add cost sheet"}</button>
        {c.id && canDelete && (
          <button type="button" className="btn danger" disabled={pending} onClick={async () => {
            if (!(await confirm(`Delete the cost sheet for ${c.style_name}?`, "Delete", true))) return;
            start(async () => { const r = await deleteCosting(c.id!); toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined); router.refresh(); });
          }}>Delete</button>
        )}
        {dirty && c.id && <span className="text-xs text-muted">Unsaved changes</span>}
      </div>
    </form>
  );
}
