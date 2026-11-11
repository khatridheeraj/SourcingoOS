"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear as day, todayIST } from "@/lib/format";
import { askNewDate } from "./actions";
import type { PanelOrder } from "./factory-order";
import { errorText, words, type Lang } from "./i18n";

export type DateAsk = {
  id: string; order_id: string; line_id: string; stage: string; old_on: string | null; new_on: string; reason: string;
  at: string; agreed: boolean | null; answer: string | null; answered_at: string | null;
};

const MAX = 300;

// Once the PO is released the factory's dates are fixed. When a step will slip, the factory asks here for a new date
// with the reason; Sourcingo agrees or says no, and the answer shows here. Folded away until there is something to read.
export function FactoryDateAsk({ order, asks, lang, canWrite, label }: {
  order: PanelOrder; asks: DateAsk[]; lang: Lang; canWrite: boolean; label: (stage: string, own: string | null | undefined) => string;
}) {
  const router = useRouter();
  const w = words(lang);
  const lines = order.lines.filter((l) => l.stages.some((s) => !s.done_on));
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [stage, setStage] = useState("");
  const [newOn, setNewOn] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!asks.length && !canWrite) return null;

  const line = order.lines.find((l) => l.id === lineId);
  const open = line?.stages.filter((s) => !s.done_on) ?? [];
  const step = open.find((s) => s.stage === stage);
  const styleOf = (id: string) => order.lines.find((l) => l.id === id);
  const stepOf = (a: DateAsk) => styleOf(a.line_id)?.stages.find((s) => s.stage === a.stage);
  const waiting = asks.filter((a) => a.agreed === null).length;

  function send() {
    setError("");
    if (!lineId || !step || !newOn) { setError(w.askPick); return; }
    if (reason.trim().length < 3) { setError(errorText(lang, "Say why the date moves.")); return; }
    start(async () => {
      try {
        const res = await askNewDate(lineId, stage, newOn, reason.trim());
        if (res.error) { setError(errorText(lang, res.error)); return; }
        setStage(""); setNewOn(""); setReason("");
        toast(w.askSent);
        router.refresh();
      } catch (e) {
        setError(errorText(lang, caught(e, "It didn't send. Try again.")));
      }
    });
  }

  return (
    <details className="fsmp fask" open={asks.length > 0 || undefined}>
      <summary>
        {asks.length ? w.askList : w.askTitle}
        {waiting > 0 && <span className="muted"> · {w.askWaiting}</span>}
      </summary>
      {asks.length > 0 && (
        <ul className="fask-list">
          {asks.map((a) => {
            const st = stepOf(a);
            return (
              <li key={a.id} className="fask-row">
                <div className="fask-head">
                  <b><span className="code">{styleOf(a.line_id)?.style}</span> · {label(a.stage, st?.label)}</b>
                  <span className={`chip ${a.agreed === null ? "warn" : a.agreed ? "ok" : "bad"}`}>
                    {a.agreed === null ? w.askWaiting : a.agreed ? w.askAgreed : w.askNo}
                  </span>
                </div>
                <p className="num">{a.old_on ? day(a.old_on) : w.askNoDate} → <b>{day(a.new_on)}</b></p>
                <p className="muted">{a.reason}</p>
                {a.answer && <p className="fask-answer"><b>Sourcingo</b> {a.answer}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (lines.length === 0 ? <p className="muted">{w.askNothingOpen}</p> : (
        <form className="fask-new" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {asks.length > 0 && <p className="text-[13px] font-semibold">{w.askTitle}</p>}
          <div className="fask-fields">
            {lines.length > 1 && (
              <label className="field">
                <span>{w.askStyle}</span>
                <select className="inp" value={lineId} disabled={pending} onChange={(e) => { setLineId(e.target.value); setStage(""); }}>
                  {lines.map((l) => <option key={l.id} value={l.id}>{l.style}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>{w.askStep}</span>
              <select className="inp" value={stage} disabled={pending} onChange={(e) => setStage(e.target.value)}>
                <option value="">—</option>
                {open.map((s) => (
                  <option key={s.stage} value={s.stage}>
                    {label(s.stage, s.label)} ({(s.factory_on ?? s.planned_on) ? w.askNow(day(s.factory_on ?? s.planned_on)) : w.askNoDate})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{w.askNew}</span>
              <input className="inp" type="date" min={todayIST()} value={newOn} disabled={pending} onChange={(e) => setNewOn(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>{w.askReason}</span>
            <textarea className="inp" rows={2} maxLength={MAX} value={reason} placeholder={w.askReasonPh} disabled={pending}
              onChange={(e) => setReason(e.target.value)} aria-invalid={!!error || undefined} />
          </label>
          {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <button type="submit" className="btn" disabled={pending}>{pending ? w.askSending : w.askSend}</button>
        </form>
      ))}
    </details>
  );
}
