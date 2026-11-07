"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { issueChallan, setBuyerDelivery, setCompanyDetails } from "../../actions";

// Number the challan (first time only) and print it.
export function ChallanBar({ dispatchId, challanNo }: { dispatchId: string; challanNo: string | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="row no-print">
      {challanNo ? (
        <button type="button" className="btn primary" onClick={() => window.print()}>Print challan</button>
      ) : (
        <button type="button" className="btn primary" disabled={pending}
          onClick={() => start(async () => {
            const r = await issueChallan(dispatchId);
            if (r.error) return setError(r.error);
            toast("Challan number given");
            router.refresh();
          })}>
          {pending ? "Saving…" : "Give it a challan number"}
        </button>
      )}
      {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
    </div>
  );
}

const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;

// A missing address, filled in once and kept for every later challan.
export function AddressFix({ dispatchId, kind, id, address, gstin }: { dispatchId: string; kind: "buyer" | "company"; id: string; address: string; gstin?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(!address);
  const [a, setA] = useState(address);
  const [g, setG] = useState(gstin ?? "");
  const [error, setError] = useState("");
  const [badGstin, setBadGstin] = useState(false);
  const [pending, start] = useTransition();
  const gRef = useRef<HTMLInputElement>(null);
  if (!open) return <button type="button" className="link no-print text-[12.5px]" onClick={() => setOpen(true)}>Change</button>;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || !a.trim()) return;
    // A wrong GSTIN is said under its own box, before the trip to the server.
    if (kind === "company" && g && !GSTIN.test(g)) { setError(""); setBadGstin(true); gRef.current?.focus(); return; }
    start(async () => {
      const r = kind === "buyer" ? await setBuyerDelivery(dispatchId, id, a) : await setCompanyDetails(dispatchId, a, g);
      if (r.error) return setError(r.error);
      setError("");
      setOpen(false);
      toast("Address saved for every challan");
      router.refresh();
    });
  };
  return (
    <form className="no-print mt-2 grid gap-2" onSubmit={save} noValidate>
      <textarea className="inp" rows={3} value={a} maxLength={500} onChange={(e) => setA(e.target.value)} aria-label={kind === "buyer" ? "Buyer's delivery address" : "Our address"}
        placeholder={kind === "buyer" ? "Delivery address: name, street, city, PIN, phone" : "Our address: street, city, PIN"} />
      {kind === "company" && (
        <>
          {/* Spaces go as they are typed or pasted ("08 ABCDE 1234F 1Z5"), so the length limit leaves room for them. */}
          <input ref={gRef} className="inp code" value={g} maxLength={24} autoCapitalize="characters" aria-invalid={badGstin || undefined} aria-describedby={badGstin ? `gstin-err-${dispatchId}` : undefined}
            onChange={(e) => { setG(e.target.value.replace(/\s+/g, "").toUpperCase()); setBadGstin(false); }} placeholder="Our GSTIN, like 08ABCDE1234F1Z5" aria-label="Our GSTIN" />
          {badGstin && <small id={`gstin-err-${dispatchId}`} className="text-[12.5px] font-semibold text-bad" role="alert">That GSTIN doesn&apos;t look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5.</small>}
        </>
      )}
      <div className="row">
        <button type="submit" className="btn sm primary" disabled={pending || !a.trim()}>
          {pending ? "Saving…" : "Save address"}
        </button>
        {address && <button type="button" className="btn sm" disabled={pending} onClick={() => { setA(address); setG(gstin ?? ""); setError(""); setBadGstin(false); setOpen(false); }}>Cancel</button>}
        {error && <span className="text-[12.5px] font-semibold text-bad" role="alert">{error}</span>}
      </div>
    </form>
  );
}
