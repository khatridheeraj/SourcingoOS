"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { recordPayment, takeBackPayment, type PaymentInput } from "./actions";

// "Record": a payment against one step of the plan, with the amount still owed filled in.
export function PayButton({ orderId, kind, factoryId, left, today, label }: {
  orderId: string; kind: PaymentInput["kind"]; factoryId: string | null; left: number; today: string; label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(left));
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = Number(amount.replace(/[₹, ]/g, ""));
    if (!(n > 0)) return setError("Write the amount paid.");
    start(async () => {
      const res = await recordPayment({ orderId, kind, factoryId, amount: n, paidOn: on, note });
      if (res.error) return setError(res.error);
      toast(`${label} recorded.`);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)} aria-label={`Record ${label}`}>Record</button>;
  return (
    <form className="gpay-form" onSubmit={save} noValidate>
      <label className="field"><span>Amount</span><input className="inp num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <label className="field"><span>Paid on</span><input className="inp" type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} /></label>
      <label className="field gpay-note"><span>Note</span><input className="inp" maxLength={200} value={note} placeholder="e.g. NEFT ref" onChange={(e) => setNote(e.target.value)} /></label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary sm" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" className="btn sm" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );
}

export function TakeBack({ id }: { id: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!sure) return <button type="button" className="btn ghost sm" onClick={() => setSure(true)}>Take back</button>;
  return (
    <span className="row gap-1.5">
      <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => {
        const res = await takeBackPayment(id);
        if (res.error) return setError(res.error);
        toast("Payment taken back.");
        router.refresh();
      })}>{pending ? "Taking back…" : "Yes, take it back"}</button>
      <button type="button" className="btn ghost sm" onClick={() => setSure(false)}>No</button>
      {error && <small className="text-bad" role="alert">{error}</small>}
    </span>
  );
}
