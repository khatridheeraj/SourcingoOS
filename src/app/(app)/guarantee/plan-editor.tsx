"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { MAX_STEPS, planProblem, WHEN_LABEL, WHENS, whenText, type PlanStep, type When } from "@/lib/guarantee";
import { setPayPlan } from "./actions";

type Row = { label: string; pct: string; when: When; days: string };
const toRows = (p: PlanStep[]): Row[] => p.map((s) => ({ label: s.label, pct: String(s.pct), when: s.when, days: s.days ? String(s.days) : "" }));
const toPlan = (r: Row[]): PlanStep[] => r.map((s) => ({ label: s.label.trim(), pct: Number(s.pct), when: s.when, days: s.days.trim() ? Number(s.days) : 0 }));

// The milestones of a payment plan: a name, a share of the PO, the event it waits for and days after it.
// orderId null edits the owner's default; otherwise one order's own plan, which can go back to the default.
export function PlanEditor({ orderId, plan, own, label }: { orderId: string | null; plan: PlanStep[]; own?: boolean; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(toRows(plan));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const total = rows.reduce((n, r) => n + (Number(r.pct) || 0), 0);
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  function save(next: PlanStep[] | null) {
    setError("");
    if (next) {
      const problem = planProblem(next);
      if (problem) return setError(problem);
    }
    start(async () => {
      const res = await setPayPlan(orderId, next);
      if (res.error) return setError(res.error);
      toast(next ? `${label} saved.` : "Back on the default plan.");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" className={orderId ? "btn ghost sm" : "btn"} onClick={() => { setRows(toRows(plan)); setOpen(true); }}>
        {orderId ? "Change plan" : "Change milestones"}
      </button>
    );
  }
  return (
    <form className="gplan-edit" onSubmit={(e) => { e.preventDefault(); save(toPlan(rows)); }} noValidate aria-label={label}>
      <ol className="gplan-rows">
        {rows.map((r, i) => (
          <li key={i} className="gplan-row">
            <label className="field gplan-name"><span>Milestone {i + 1}</span>
              <input className="inp" value={r.label} maxLength={40} onChange={(e) => set(i, "label", e.target.value)} placeholder="e.g. Deposit" />
            </label>
            <label className="field gplan-pct"><span>Share</span>
              <span className="inp-unit"><input className="inp num" inputMode="numeric" maxLength={3} value={r.pct} onChange={(e) => set(i, "pct", e.target.value)} /><i>%</i></span>
            </label>
            <label className="field gplan-when"><span>Falls due</span>
              <select className="inp" value={r.when} onChange={(e) => set(i, "when", e.target.value)}>
                {WHENS.map((w) => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}
              </select>
            </label>
            <label className="field gplan-days"><span>Days after</span>
              <input className="inp num" inputMode="numeric" maxLength={3} value={r.days} placeholder="0" onChange={(e) => set(i, "days", e.target.value)} />
            </label>
            {rows.length > 1 && (
              <button type="button" className="btn ghost sm gplan-x" aria-label={`Remove milestone ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
            )}
            <small className="muted gplan-read">{whenText({ when: r.when, days: Number(r.days) || 0 })}</small>
          </li>
        ))}
      </ol>
      <div className="row justify-between">
        {rows.length < MAX_STEPS
          ? <button type="button" className="btn ghost sm" onClick={() => setRows((rs) => [...rs, { label: "", pct: String(Math.max(0, 100 - total)), when: "shipped", days: "" }])}>Add a milestone</button>
          : <span />}
        <span className={`num text-[13px] ${total === 100 ? "text-ok" : "text-warn"}`}>Total {total}%</span>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary sm" disabled={pending}>{pending ? "Saving…" : "Save plan"}</button>
        {orderId && own && <button type="button" className="btn sm" disabled={pending} onClick={() => save(null)}>Use the default</button>}
        <button type="button" className="btn ghost sm" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );
}
