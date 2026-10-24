"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { restoreOrder } from "./actions";

export type DeletedPo = { id: string; orderNo: string; buyer: string; buyerPo: string; when: string; by: string; reason: string; pieces: string };

// POs the owner deleted, newest first, each one tap from coming back.
export function DeletedPos({ rows }: { rows: DeletedPo[] }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();

  function bringBack(r: DeletedPo) {
    setError("");
    setBusy(r.id);
    start(async () => {
      const res = await restoreOrder(r.id);
      if (res.error) setError(`${r.orderNo}: ${res.error}`);
      else toast(`${r.orderNo} is back`);
      setBusy("");
    });
  }

  return (
    <section className="panel mt-4 scroll-mt-20" id="deleted" aria-labelledby="deleted-h">
      <h2 id="deleted-h" className="font-bold text-base">Deleted POs</h2>
      <p className="muted mt-1 text-[13px]">Only you see these. Bring one back and it returns as it was.</p>
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <ul className="mt-3 flex flex-col divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.id} className="row gap-3 py-2.5">
            <div className="grow min-w-0">
              <b className="num">{r.orderNo}</b> · {r.buyer} · PO {r.buyerPo}
              <div className="muted text-[12px]">{r.pieces} · deleted {r.when} by {r.by}: {r.reason}</div>
            </div>
            <button type="button" className="btn sm" disabled={pending} onClick={() => bringBack(r)}>{pending && busy === r.id ? "Bringing back…" : "Bring back"}</button>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-[13px]"><summary className="muted">What happens to a deleted PO</summary>
        <p className="muted mt-1">It leaves Orders, Home, Today, the factory and buyer panels, emails and the morning brief. Its PO number is free, so the right PO
          can be added again. Everything it had stays saved, and the delete is in the <Link className="link" href="/activity">activity log</Link>.</p>
      </details>
    </section>
  );
}
