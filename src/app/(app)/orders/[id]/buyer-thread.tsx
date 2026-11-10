"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { answerBuyer, buyerMessagesDone } from "../buyer-talk-actions";

export type BuyerLine = { id: string; body: string; fromBuyer: boolean; by: string; when: string; open: boolean };

const MAX = 2000;

// What the buyer wrote about this order on its own page, and Sourcingo's answers. Writing here reaches the buyer;
// the team's own notes stay on the Notes tab.
export function BuyerThread({ orderId, buyer, lines, canWrite }: { orderId: string; buyer: string; lines: BuyerLine[]; canWrite: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const waiting = lines.filter((l) => l.open).length;

  function send() {
    const text = body.trim();
    setError("");
    if (!text) { setError("Write the answer first."); box.current?.focus(); return; }
    if (text.length > MAX) { setError(`Keep the answer under ${MAX.toLocaleString("en-IN")} characters (it has ${text.length.toLocaleString("en-IN")}).`); box.current?.focus(); return; }
    start(async () => {
      try {
        const res = await answerBuyer(orderId, text);
        if (res.error) { setError(res.error); box.current?.focus(); return; }
        setBody("");
        toast(`Sent. ${buyer} sees it on their page.`);
        router.refresh();
      } catch (e) {
        setError(caught(e, "The answer didn't send. Try again."));
      }
    });
  }

  function done() {
    start(async () => {
      const res = await buyerMessagesDone(orderId);
      if (res.error) { toast(res.error, "bad"); return; }
      router.refresh();
    });
  }

  return (
    <section className="panel scroll-mt-20" id="buyer-talk" aria-labelledby="buyer-talk-h">
      <div className="row mb-1">
        <h2 id="buyer-talk-h" className="font-bold text-base">Messages with {buyer}</h2>
        {waiting > 0 && canWrite && <button type="button" className="btn sm ml-auto" disabled={pending} onClick={done}>No answer needed</button>}
      </div>
      {lines.length === 0 ? (
        <p className="muted mb-2 text-[13px]">{buyer} hasn&apos;t written about this order. What they write on their page shows here.</p>
      ) : (
        <ul className="talk-list">
          {lines.map((l) => (
            <li key={l.id} className={`talk-row${l.open ? " for-me" : ""}`}>
              <span className="talk-av" aria-hidden>{l.fromBuyer ? "B" : "S"}</span>
              <div className="min-w-0">
                <div className="talk-meta"><b>{l.fromBuyer ? buyer : `${l.by} for Sourcingo`}</b><span>{l.when}</span></div>
                <p className="talk-body">{l.body}</p>
                {l.open && <p className="talk-acts"><span className="why warn">Waiting for an answer</span></p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className="talk-new" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="field">
            <span>{waiting ? `Answer ${buyer}` : `Write to ${buyer}`}</span>
            <textarea ref={box} className="inp" rows={3} value={body} maxLength={MAX + 200}
              placeholder={`${buyer} reads this on their page, signed Sourcingo.`}
              aria-invalid={!!error || undefined} aria-describedby={error ? "buyer-talk-err" : undefined}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          </label>
          {error && <p id="buyer-talk-err" className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send to buyer"}</button>
        </form>
      )}
      <details className="howto mt-4 border-t border-line pt-3">
        <summary>How buyer messages work</summary>
        <p>The buyer writes under each PO on their own page. A new message shows on the merchandiser&apos;s Home (the owner&apos;s when no one owns the order) until someone answers here or taps No answer needed. Your answer shows on the buyer&apos;s page signed Sourcingo, never with your name. Team notes on the Notes tab are never shown to the buyer.</p>
      </details>
    </section>
  );
}
