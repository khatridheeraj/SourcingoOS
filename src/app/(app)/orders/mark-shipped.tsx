"use client";

import { useState, useTransition } from "react";
import { markShipped } from "./actions";

// Closes an order that left the factory long ago, after a second tap so it isn't done by accident.
export function MarkShipped({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
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
        <button className="btn sm" onClick={() => setSure(true)}>Mark shipped</button>
      )}
      {error && <span className="max-w-[260px] text-right text-xs font-semibold text-bad">{error}</span>}
    </div>
  );
}
