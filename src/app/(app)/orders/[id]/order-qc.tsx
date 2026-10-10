"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day } from "@/lib/format";
import { addQc, cancelQc, type QcInput } from "../actions";

export type QcCheck = {
  id: string; kind: string; checked_on: string; result: string; pieces_checked: number | null; defects: number;
  notes: string | null; by: string; cancelled_at: string | null; cancel_reason: string | null;
};

const KIND: Record<string, string> = { inline: "Inline", final: "Final" };
const pct = (d: number, p: number | null) => (p ? `${((d / p) * 100).toFixed(1)}%` : "");

// Inline and final inspections on this order. Saved checks are cancelled, never edited.
export function OrderQc({ orderId, open, today, checks, finalPassed }: {
  orderId: string;
  open: boolean;
  today: string;
  checks: QcCheck[];
  finalPassed: boolean;
}) {
  const router = useRouter();
  const blank: QcInput = { kind: "final", checked_on: today, result: "", pieces_checked: "", defects: "", notes: "" };
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(blank);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof QcInput, v: string) => setQ({ ...q, [k]: v });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await addQc(orderId, q);
      if (res.error) return setError(res.error);
      setQ(blank);
      setAdding(false);
      router.refresh();
    });
  }

  function cancel(id: string) {
    const reason = window.prompt("Why cancel this QC check? For example: entered on the wrong order.");
    if (reason == null) return;
    start(async () => {
      const res = await cancelQc(orderId, id, reason);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  const live = checks.filter((c) => !c.cancelled_at);
  const lastFinal = live.find((c) => c.kind === "final");

  return (
    <section className="panel">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Quality checks</h2>
        {finalPassed ? <span className="chip ok">Final QC passed</span>
          : lastFinal ? <span className="chip bad">Final QC failed</span>
          : open ? <span className="chip warn">Final QC not done</span> : null}
        {open && !adding && <button type="button" className="btn sm ml-auto" onClick={() => setAdding(true)}>Record QC</button>}
      </div>
      {open && !finalPassed && <p className="muted mb-3 text-[13px]">The order can be marked Shipped once its latest final QC has passed.</p>}

      {adding && (
        <form onSubmit={submit} className="mb-4 rounded-[10px] border border-line p-3">
          <div className="fgrid">
            <div className="field">
              <span>Type of check</span>
              <div className="steps" role="group" aria-label="Type of check">
                {(["inline", "final"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={q.kind === k} onClick={() => set("kind", k)}>{KIND[k]}</button>
                ))}
              </div>
              <small>Inline: during production. Final: before shipping.</small>
            </div>
            <div className="field">
              <span>Result <i>*</i></span>
              <div className="steps" role="group" aria-label="Result">
                <button type="button" aria-pressed={q.result === "pass"} onClick={() => set("result", "pass")}>Pass</button>
                <button type="button" aria-pressed={q.result === "fail"} onClick={() => set("result", "fail")}>Fail</button>
              </div>
            </div>
            <label className="field">
              <span>Date checked</span>
              <input className="inp" type="date" max={today} value={q.checked_on} onChange={(e) => set("checked_on", e.target.value)} />
            </label>
            <label className="field">
              <span>Pieces checked</span>
              <input className="inp" inputMode="numeric" value={q.pieces_checked} onChange={(e) => set("pieces_checked", e.target.value)} />
            </label>
            <label className="field">
              <span>Defects found</span>
              <input className="inp" inputMode="numeric" value={q.defects} placeholder="0" onChange={(e) => set("defects", e.target.value)} />
            </label>
          </div>
          <label className="field mt-3">
            <span>Notes{q.result === "fail" && <i> *</i>}</span>
            <textarea className="inp" rows={2} value={q.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder={q.result === "fail" ? "What failed, and what the factory must fix" : "Anything worth remembering"} />
          </label>
          <div className="row mt-3">
            <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save QC"}</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setError(""); setQ(blank); }}>Close</button>
            {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          </div>
        </form>
      )}

      {checks.length === 0 ? (
        !adding && <p className="muted text-[13px]">No QC recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checks.map((c) => (
            <li key={c.id} className={`rounded-[10px] border border-line p-3 text-[13px] ${c.cancelled_at ? "opacity-60" : ""}`}>
              <div className="row">
                <b>{KIND[c.kind]}</b>
                <span className={c.cancelled_at ? "chip" : c.result === "pass" ? "chip ok" : "chip bad"}>
                  {c.cancelled_at ? "Cancelled" : c.result === "pass" ? "Pass" : "Fail"}
                </span>
                <span className="muted">{day(c.checked_on)} · {c.by}</span>
                {open && !c.cancelled_at && (
                  <button type="button" className="btn sm danger ml-auto" disabled={pending} onClick={() => cancel(c.id)}>Cancel</button>
                )}
              </div>
              {(c.pieces_checked != null || c.defects > 0) && (
                <div className="mt-1">
                  {c.pieces_checked != null && <>{c.pieces_checked} pcs checked · </>}
                  {c.defects} {c.defects === 1 ? "defect" : "defects"}
                  {c.pieces_checked ? ` (${pct(c.defects, c.pieces_checked)})` : ""}
                </div>
              )}
              {c.notes && <div className="mt-1 whitespace-pre-line">{c.notes}</div>}
              {c.cancelled_at && <div className="muted mt-1">Cancelled: {c.cancel_reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
