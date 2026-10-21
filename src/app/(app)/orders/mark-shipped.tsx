"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { markShipped } from "./actions";
import { closeOldOrder } from "./quick-actions";

// Closes an order once it has gone out, after a second tap so it isn't done by accident.
// blocked: why it can't be closed yet (no factory bill or no invoice in Dispatch); the tap says so instead.
// old: the order shipped before the app was in use (nothing in Dispatch, ship date two weeks past), so it can be
// closed with a note on how it went instead.
export function MarkShipped({ orderId, orderNo, blocked, old }: { orderId: string; orderNo: string; blocked?: string | null; old?: boolean }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [why, setWhy] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function ship() {
    setError("");
    start(async () => {
      const res = await markShipped(orderId);
      if (res.error) {
        setError(res.error);
        setSure(false);
      }
    });
  }
  function closeOld() {
    setError("");
    start(async () => {
      const res = await closeOldOrder(orderId, note);
      if (res.error) setError(res.error);
      else toast(`${orderNo} closed as shipped`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {sure ? (
        <div className="row">
          <button className="btn sm" onClick={() => setSure(false)} disabled={pending}>Keep open</button>
          <button className="btn sm primary" onClick={ship} disabled={pending}>{pending ? "Closing…" : `Yes, ${orderNo} shipped`}</button>
        </div>
      ) : (
        <button className="btn sm" aria-expanded={blocked ? why : undefined} onClick={() => (blocked ? setWhy(!why) : setSure(true))}>Mark shipped</button>
      )}
      {blocked && why && (old ? (
        <div className="old-close" role="group" aria-label={`Close ${orderNo}`}>
          <b>Shipped before we used the app?</b>
          <span>Say how it went and it closes. Nothing needs to go in Dispatch.</span>
          <div className="row mt-1.5">
            <input className="inp" value={note} maxLength={300} autoFocus placeholder="e.g. Shipped end of July by road" aria-label="How it shipped"
              onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && note.trim().length >= 3) closeOld(); }} />
            <button className="btn sm primary" disabled={pending || note.trim().length < 3} onClick={closeOld}>{pending ? "Closing…" : "Close it"}</button>
          </div>
        </div>
      ) : (
        <span className="max-w-[300px] text-right text-xs font-semibold text-warn" role="status">
          Not yet: {blocked} <Link className="link" href={`/orders/${orderId}#dispatch`}>Open Dispatch</Link>
        </span>
      ))}
      {error && <span className="max-w-[300px] text-right text-xs font-semibold text-bad" role="alert">{error}</span>}
    </div>
  );
}
