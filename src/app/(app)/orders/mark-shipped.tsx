"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { markShipped } from "./actions";

// Closes an order once it has gone out, after a second tap so it isn't done by accident.
// blocked: why it can't be closed yet (no factory bill or no invoice in Dispatch); the tap says so instead.
export function MarkShipped({ orderId, orderNo, blocked }: { orderId: string; orderNo: string; blocked?: string | null }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [why, setWhy] = useState(false);
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
      {blocked && why && (
        <span className="max-w-[300px] text-right text-xs font-semibold text-warn" role="status">
          Not yet: {blocked} <Link className="link" href={`/orders/${orderId}#dispatch`}>Open Dispatch</Link>
        </span>
      )}
      {error && <span className="max-w-[300px] text-right text-xs font-semibold text-bad" role="alert">{error}</span>}
    </div>
  );
}
