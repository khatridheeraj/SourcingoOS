"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { poToInquiry, poToOrder, type PoResult, setPoStatus } from "./actions";

export type PoState = { id: string; po_number: string; status: "new" | "in_progress" | "converted" | "rejected"; inquiry_id: string | null; so_id: string | null };

// The buttons that move a received PO along: inquiry, sales order, reject.
export function PoActions({ po, compact = false }: { po: PoState; compact?: boolean }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [busy, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const sm = compact ? "btn sm" : "btn";

  const run = (fn: () => Promise<PoResult>, go = false) =>
    start(async () => {
      const r = await fn();
      toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
      if (r.error) return;
      setRejecting(false);
      if (go && r.href) router.push(r.href);
      else router.refresh();
    });

  const convert = async () => {
    if (!(await confirm(`Create a draft sales order for PO ${po.po_number}? Lines from the email become styles you can edit.`, "Create sales order"))) return;
    run(() => poToOrder(po.id), true);
  };

  if (rejecting) {
    return (
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(() => setPoStatus(po.id, "rejected", reason)); }}>
        <input className="inp" style={{ minWidth: 180, flex: 1 }} autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why? e.g. duplicate, cancelled by buyer" aria-label="Reason for rejecting" />
        <button type="submit" className={`${sm} danger`} disabled={busy || !reason.trim()}>Reject</button>
        <button type="button" className={sm} disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
      </form>
    );
  }

  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {po.so_id ? (
        <Link className={sm} href={`/orders/${po.so_id}`}>Open {po.so_id}</Link>
      ) : po.status !== "rejected" && (
        <button type="button" className={`${sm} primary`} disabled={busy} onClick={convert}>Convert to sales order</button>
      )}
      {po.inquiry_id ? (
        <Link className={sm} href={`/inquiries?status=all&q=${encodeURIComponent(po.inquiry_id)}`}>Open {po.inquiry_id}</Link>
      ) : po.status !== "rejected" && (
        <button type="button" className={sm} disabled={busy} onClick={() => run(() => poToInquiry(po.id), !compact)}>Create inquiry</button>
      )}
      {po.status === "new" && !compact && (
        <button type="button" className={sm} disabled={busy} onClick={() => run(() => setPoStatus(po.id, "in_progress"))}>Mark in progress</button>
      )}
      {(po.status === "new" || po.status === "in_progress") && (
        <button type="button" className={`${sm} ${compact ? "" : "danger"}`} disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
      )}
      {po.status === "rejected" && (
        <button type="button" className={sm} disabled={busy} onClick={() => run(() => setPoStatus(po.id, po.inquiry_id ? "in_progress" : "new"))}>Reopen</button>
      )}
    </div>
  );
}
