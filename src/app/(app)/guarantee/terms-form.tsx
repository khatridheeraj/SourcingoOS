"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { setGuarantee } from "./actions";

// The owner's terms: the deposit share, how soon factories are paid, and the switch that shows it all to buyers and factories.
export function TermsForm({ live, depositPct, payDays }: { live: boolean; depositPct: number; payDays: number }) {
  const router = useRouter();
  const [pct, setPct] = useState(String(depositPct));
  const [days, setDays] = useState(String(payDays));
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const changed = pct !== String(depositPct) || days !== String(payDays);

  function save(nextLive: boolean) {
    setError("");
    const p = Number(pct), d = Number(days);
    if (!Number.isInteger(p) || p < 0 || p > 90) return setError("The deposit is a share of the PO from 0% to 90%.");
    if (!Number.isInteger(d) || d < 1 || d > 60) return setError("Pay factories within 1 to 60 days of their QC pass.");
    start(async () => {
      const res = await setGuarantee(nextLive, p, d);
      if (res.error) return setError(res.error);
      toast(nextLive === live ? "Terms saved." : nextLive ? "The Guarantee is on. Buyers and factories see it now." : "The Guarantee is off for buyers and factories.");
      setSure(false);
      router.refresh();
    });
  }

  return (
    <div className="stack">
      <div className="fgrid">
        <label className="field"><span>Buyer deposit with the PO</span>
          <span className="inp-unit"><input className="inp num" inputMode="numeric" value={pct} maxLength={2} onChange={(e) => setPct(e.target.value)} /><i>%</i></span>
        </label>
        <label className="field"><span>Pay factories within</span>
          <span className="inp-unit"><input className="inp num" inputMode="numeric" value={days} maxLength={2} onChange={(e) => setDays(e.target.value)} /><i>days of their pass</i></span>
        </label>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        {changed && <button type="button" className="btn" disabled={pending} onClick={() => save(live)}>{pending ? "Saving…" : "Save terms"}</button>}
        {sure ? (
          <>
            <span className="text-[13px]">{live ? "Hide it from buyers and factories?" : "Every buyer and factory sees its plan and can raise claims. Turn it on?"}</span>
            <button type="button" className="btn primary sm" disabled={pending} onClick={() => save(!live)}>{pending ? "Saving…" : live ? "Yes, turn it off" : "Yes, turn it on"}</button>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setSure(false)}>No</button>
          </>
        ) : (
          <button type="button" className={live ? "btn ghost" : "btn"} onClick={() => setSure(true)}>{live ? "Turn off for buyers and factories" : "Turn on for buyers and factories"}</button>
        )}
      </div>
    </div>
  );
}
