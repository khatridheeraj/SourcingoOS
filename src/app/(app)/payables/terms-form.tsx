"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { DEFAULT_DAYS, MSME_DAYS, type Msme } from "@/lib/payables";
import { saveTerms } from "./actions";

// One supplier's payment days and MSME registration. Saving moves the due date of every bill it has.
export function TermsForm({ ledger, days, msme, udyam }: { ledger: string; days: number; msme: Msme | null; udyam: string | null }) {
  const router = useRouter();
  const start0 = { days: days === DEFAULT_DAYS ? "" : String(days), msme: msme ?? "", udyam: udyam ?? "" };
  const [v, setV] = useState(start0);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dirty = v.days !== start0.days || v.msme !== start0.msme || v.udyam !== start0.udyam;
  const small = v.msme === "micro" || v.msme === "small";
  return (
    <form className="terms" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveTerms(ledger, v.days, v.msme, v.udyam);
        if (r.error) { setError(r.error); return; }
        setError("");
        toast(r.ok!);
        router.refresh();
      });
    }}>
      <label>
        <span>Payment days</span>
        <input className="inp num" inputMode="numeric" value={v.days} placeholder={String(DEFAULT_DAYS)} onChange={(e) => setV({ ...v, days: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
      </label>
      <label>
        <span>MSME (Udyam)</span>
        <select className="inp" value={v.msme} onChange={(e) => setV({ ...v, msme: e.target.value })}>
          <option value="">Not known yet</option>
          <option value="micro">Micro</option>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="none">Not registered</option>
        </select>
      </label>
      {v.msme && v.msme !== "none" && (
        <label className="terms-udyam">
          <span>Udyam number</span>
          <input className="inp" value={v.udyam} placeholder="UDYAM-RJ-17-0012345" autoCapitalize="characters" onChange={(e) => setV({ ...v, udyam: e.target.value.toUpperCase() })} />
        </label>
      )}
      {small && Number(v.days || DEFAULT_DAYS) > MSME_DAYS && (
        <p className="terms-warn">Micro and small enterprises must be paid within {MSME_DAYS} days, whatever the agreed terms, so bills fall due on day {MSME_DAYS}.</p>
      )}
      {dirty && <button className="btn sm primary" disabled={pending}>{pending ? "Saving…" : "Save terms"}</button>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </form>
  );
}
