"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { day, dayAt } from "@/lib/format";
import { reviewStepUpdate } from "../actions";

export type PendingUpdate = {
  id: string; style: string; step: string; factory: string; doneOn: string; target: string; note: string; sentAt: string; photos: string[];
};

// Steps a factory marked done in its panel, with its photos. They count once the orders team or Quality confirms them.
export function FactoryUpdates({ orderId, updates, canReview }: { orderId: string; updates: PendingUpdate[]; canReview: boolean }) {
  const router = useRouter();
  const [declining, setDeclining] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();

  function answer(u: PendingUpdate, confirm: boolean) {
    setError(null);
    setBusy(u.id);
    start(async () => {
      const res = await reviewStepUpdate(orderId, u.id, confirm, confirm ? "" : reason);
      setBusy("");
      if (res.error) return setError({ id: u.id, text: res.error });
      setDeclining("");
      setReason("");
      toast(confirm ? `${u.style} ${u.step} marked done ${day(u.doneOn)}.` : `Sent back to ${u.factory}.`);
      router.refresh();
    });
  }

  if (!updates.length) return null;
  return (
    <section className="panel fupd" aria-labelledby="fupd-h">
      <div className="row mb-1">
        <h2 id="fupd-h" className="font-bold text-base">Factory updates to confirm</h2>
        <span className="chip info">{updates.length}</span>
      </div>
      <p className="muted mb-3 text-[13px]">
        {canReview ? "Check the photos. Confirm puts the done date in; Not yet sends it back to the factory with your reason." : "The orders team or Quality confirms these."}
      </p>
      <ul className="fupd-list">
        {updates.map((u) => (
          <li key={u.id} className="fupd-row">
            <div className="fupd-what">
              <b><span className="code">{u.style}</span> · {u.step} done {day(u.doneOn)}</b>
              <small>
                {u.factory} · sent {dayAt(u.sentAt)}
                {u.target && (u.doneOn > u.target ? <span className="text-bad"> · after target {day(u.target)}</span> : <span> · target {day(u.target)}</span>)}
              </small>
              {u.note && <p className="fupd-note">&ldquo;{u.note}&rdquo;</p>}
            </div>
            <div className="fupd-photos">
              {u.photos.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1} of ${u.style} ${u.step}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                  <img src={url} alt="" loading="lazy" />
                </a>
              ))}
            </div>
            {canReview && (
              declining === u.id ? (
                <div className="fupd-acts">
                  <input className="inp" autoFocus maxLength={300} value={reason} placeholder="Why not yet? e.g. photo of cut panels needed"
                    aria-label={`Why ${u.style} ${u.step} is not done yet`} disabled={pending}
                    onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) answer(u, false); }} />
                  <button type="button" className="btn" disabled={pending || !reason.trim()} onClick={() => answer(u, false)}>{busy === u.id ? "Sending…" : "Send back"}</button>
                  <button type="button" className="btn ghost" disabled={pending} onClick={() => { setDeclining(""); setReason(""); }}>Cancel</button>
                </div>
              ) : (
                <div className="fupd-acts">
                  <button type="button" className="btn done-btn" disabled={pending} onClick={() => answer(u, true)}>
                    {busy === u.id ? "Saving…" : <><span aria-hidden className="done-tick">✓</span>Confirm</>}
                  </button>
                  <button type="button" className="btn" disabled={pending} onClick={() => { setDeclining(u.id); setReason(""); setError(null); }}>Not yet</button>
                </div>
              )
            )}
            {error?.id === u.id && <p className="text-[13px] font-semibold text-bad" role="alert">{error.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
