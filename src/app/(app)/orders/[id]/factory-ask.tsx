"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear } from "@/lib/format";
import { answerFactoryDate } from "../factory-ask-actions";

export type FactoryAsk = {
  id: string; step: string; target: string; oldOn: string; newOn: string; reason: string; at: string;
  agreed: boolean | null; answer: string;
};

// The factory asked for a new date on a step of this style. The orders team agrees (the factory's date moves; the
// target stays, so lateness still shows) or says no, with a word for the factory if it wants.
export function FactoryAskBox({ orderId, asks, canEdit }: { orderId: string; asks: FactoryAsk[]; canEdit: boolean }) {
  if (!asks.length) return null;
  return (
    <div className="fask-team">
      {asks.map((a) => <AskRow key={a.id} orderId={orderId} a={a} canEdit={canEdit} />)}
    </div>
  );
}

function AskRow({ orderId, a, canEdit }: { orderId: string; a: FactoryAsk; canEdit: boolean }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const waiting = a.agreed === null;
  const late = !!a.target && a.newOn > a.target;

  function reply(agree: boolean) {
    setError("");
    setBusy(agree ? "yes" : "no");
    start(async () => {
      try {
        const res = await answerFactoryDate(orderId, a.id, agree, answer);
        if (res.error) { setError(res.error); return; }
        toast(agree ? `Agreed. The factory's ${a.step} date is now ${dayNear(a.newOn)}.` : "Sent. The factory sees your answer.");
        router.refresh();
      } catch (e) {
        setError(caught(e, "It didn't save. Try again."));
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className={`fask-ask${waiting ? " open" : ""}`}>
      <p className="fask-what">
        <b>{waiting ? "Factory asks for a new date" : a.agreed ? "New date agreed" : "New date not agreed"}</b>
        {" · "}{a.step} <span className="num">{a.oldOn ? dayNear(a.oldOn) : "no date"} → <b>{dayNear(a.newOn)}</b></span>
      </p>
      <p className="fask-why">&ldquo;{a.reason}&rdquo;</p>
      {waiting && late && <p className="text-[13px] text-warn">After your target of {dayNear(a.target)}. Agreeing keeps the target, so the step shows late.</p>}
      {a.answer && <p className="fask-why"><b>Answer</b> {a.answer}</p>}
      {waiting && canEdit && (
        <div className="fask-act">
          <input className="inp" value={answer} maxLength={300} disabled={pending} placeholder="A word for the factory (optional)"
            aria-label={`Answer to the factory about ${a.step}`} onChange={(e) => setAnswer(e.target.value)} />
          <div className="fask-btns">
            <button type="button" className="btn sm" disabled={pending} onClick={() => reply(false)}>{busy === "no" ? "Sending…" : "Say no"}</button>
            <button type="button" className="btn sm primary" disabled={pending} onClick={() => reply(true)}>{busy === "yes" ? "Saving…" : "Agree"}</button>
          </div>
        </div>
      )}
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
