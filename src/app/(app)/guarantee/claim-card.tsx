"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import type { ClaimReason, Decision } from "@/lib/guarantee";
import { decideClaim } from "./actions";

export type TeamClaim = {
  id: string; claim_no: string; order_id: string; order_no: string; buyer_po: string | null; buyer: string; style: string; factory: string | null;
  buyer_rate: number | null; factory_rate: number | null; linked: boolean; reason: ClaimReason; pieces: number; ask: "remake" | "refund";
  detail: string; photos: string[]; by_buyer: boolean; raised_at: string; decide_by: string; decision: Decision | null; amount: number | null;
  answer: string | null; decided_at: string | null; factory_claim_no: string | null;
};

const rupees = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}`;

// Deciding a buyer claim: remake, refund (how much) or decline (why), and whether the factory answers for it.
export function DecideClaim({ c, canDecide }: { c: TeamClaim; canDecide: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>(c.ask);
  const full = c.buyer_rate != null ? Math.round(c.pieces * Number(c.buyer_rate) * 100) / 100 : null;
  const [amount, setAmount] = useState(full != null ? String(full) : "");
  const [answer, setAnswer] = useState("");
  const factoryCost = c.factory_rate != null ? Math.round(c.pieces * Number(c.factory_rate) * 100) / 100 : 0;
  const canPass = !!c.factory && c.linked && factoryCost > 0;
  const [passOn, setPassOn] = useState(canPass);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!canDecide) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = Number(amount.replace(/[₹, ]/g, ""));
    if (decision === "refund" && !(n > 0)) return setError("Write the refund, in rupees.");
    if (decision === "declined" && !answer.trim()) return setError("Say why, so the buyer understands.");
    start(async () => {
      const res = await decideClaim({ id: c.id, decision, amount: decision === "refund" ? n : null, answer, passOn: canPass && passOn });
      if (res.error) return setError(res.error);
      toast(res.factoryClaim ? `Decided. Factory claim ${res.factoryClaim} raised for Accounts.` : "Decided. The buyer can see it.");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) return <button type="button" className="btn primary sm" onClick={() => setOpen(true)}>Decide</button>;
  return (
    <form className="stack gclaim-form" onSubmit={save} noValidate>
      <div className="seg w-full" role="radiogroup" aria-label="Decision">
        {(["remake", "refund", "declined"] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)}>
            {d === "remake" ? "Remake" : d === "refund" ? "Refund" : "Decline"}
          </button>
        ))}
      </div>
      {decision === "refund" && (
        <label className="field"><span>Refund to the buyer <i>*</i></span>
          <input className="inp num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          {full != null && <small className="muted">{c.pieces} pcs at the buyer&apos;s rate is {rupees(full)}</small>}
        </label>
      )}
      <label className="field"><span>{decision === "declined" ? <>Why not <i>*</i></> : "Note for the buyer"}</span>
        <textarea className="inp" rows={2} maxLength={500} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder={decision === "declined" ? "e.g. The pieces passed our Final QC; the holes come from washing on your side" : "e.g. Remade pieces ship with your next lot"} />
      </label>
      {decision !== "declined" && (
        canPass ? (
          <label className="row text-[13px]">
            <input type="checkbox" checked={passOn} onChange={(e) => setPassOn(e.target.checked)} />
            Pass it to {c.factory}: a factory claim of {rupees(factoryCost)} ({c.pieces} pcs at its rate)
          </label>
        ) : (
          <small className="muted">
            {!c.factory ? "No factory is set on this style, so the claim stays with us."
              : !c.linked ? `${c.factory} isn't linked to its Tally ledger, so Accounts raises its claim by hand.`
              : "This style has no factory rate, so Accounts prices the factory's claim by hand."}
          </small>
        )
      )}
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save the decision"}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );
}

