"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { CLAIM_REASON, CLAIM_REASONS, claimAmount } from "@/lib/claims";
import { money } from "@/lib/format";
import { raiseClaim } from "./actions";

// Raise a claim against one bill: what went wrong, pieces and rate (or the amount), and a note the factory reads.
export function ClaimForm({ ledger, bill, orderId, today, open }: { ledger: string; bill: string; orderId: string | null; today: string; open: number }) {
  const router = useRouter();
  const [shown, setShown] = useState(false);
  const [reason, setReason] = useState("short");
  const [pieces, setPieces] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ no: string } | null>(null);
  const [pending, start] = useTransition();
  const worked = claimAmount("", pieces, rate);
  const value = amount.trim() ? amount : worked ? String(worked) : "";

  if (made) {
    return (
      <p className="claim-done" role="status">
        Claim <b className="code">{made.no}</b> raised. Book the same debit note in Tally; until then it comes off what to pay.{" "}
        <Link className="link" href={`/payables/claims/${encodeURIComponent(made.no)}`}>Print the debit note</Link>
      </p>
    );
  }
  if (!shown) return <button type="button" className="btn sm" onClick={() => setShown(true)}>Raise a claim</button>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value.replace(/[^\d.]/g, ""));
    if (!value.trim() || !(n > 0)) { setError("Write the amount to claim, or pieces and the rate."); return; }
    if (n > open + 1) { setError(`That is more than the ${money(Math.round(open))} left on this bill.`); return; }
    if (!note.trim()) { setError("Say what happened, so the factory knows what the claim is for."); return; }
    start(async () => {
      const r = await raiseClaim({ ledger, bill, orderId, date, reason, pieces, amount: value, note });
      if (r.error) { setError(r.error); return; }
      setError("");
      setMade({ no: r.ok! });
      toast(`Claim ${r.ok} raised`);
      router.refresh();
    });
  };

  return (
    <form className="claim-form" onSubmit={submit} noValidate>
      <h3>Claim against {bill}</h3>
      <div className="claim-grid">
        <label className="field"><span>What went wrong</span>
          <select className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>
            {CLAIM_REASONS.map((r) => <option key={r} value={r}>{CLAIM_REASON[r]}</option>)}
          </select>
        </label>
        <label className="field"><span>Date</span><input className="inp" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Pieces</span><input className="inp num" inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="e.g. 120" /></label>
        <label className="field"><span>Rate per piece (₹)</span><input className="inp num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 245" /></label>
        <label className="field"><span>Amount to claim (₹)</span>
          <input className="inp num" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); if (error) setError(""); }} placeholder={worked ? money(worked) : "e.g. 29,400"} aria-invalid={error ? true : undefined} />
        </label>
      </div>
      <label className="field"><span>What happened (the factory reads this)</span>
        <textarea className="inp" rows={2} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); if (error) setError(""); }} placeholder="e.g. 120 pcs short against challan 45; final QC failed on shade for 80 pcs" />
      </label>
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
      <div className="row">
        <button className="btn sm primary" disabled={pending}>{pending ? "Raising…" : `Raise claim${value ? ` of ${money(Number(value.replace(/[^\d.]/g, "")) || 0)}` : ""}`}</button>
        <button type="button" className="btn sm ghost" onClick={() => setShown(false)}>Cancel</button>
      </div>
    </form>
  );
}
