"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

// A missing address, filled in once and kept for every later challan.
export function AddressFix({ dispatchId, kind, id, address, gstin }: { dispatchId: string; kind: "buyer" | "company"; id: string; address: string; gstin?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(!address);
  const [a, setA] = useState(address);
  const [g, setG] = useState(gstin ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="link no-print text-[12.5px]" onClick={() => setOpen(true)}>Change</button>;
  return (
    <div className="no-print mt-2 grid gap-2">
      <textarea className="inp" rows={3} value={a} maxLength={500} onChange={(e) => setA(e.target.value)} aria-label={kind === "buyer" ? "Buyer's delivery address" : "Our address"}
        placeholder={kind === "buyer" ? "Delivery address: name, street, city, PIN, phone" : "Our address: street, city, PIN"} />
      {kind === "company" && <input className="inp" value={g} maxLength={15} onChange={(e) => setG(e.target.value.toUpperCase())} placeholder="Our GSTIN, like 08ABCDE1234F1Z5" aria-label="Our GSTIN" />}
      <div className="row">
        <button type="button" className="btn sm primary" disabled={pending || !a.trim()}
          onClick={() => start(async () => {
            const r = kind === "buyer" ? await setBuyerDelivery(dispatchId, id, a) : await setCompanyDetails(dispatchId, a, g);
            if (r.error) return setError(r.error);
            setError("");
            setOpen(false);
            toast("Address saved for every challan");
            router.refresh();
          })}>
          {pending ? "Saving…" : "Save address"}
        </button>
        {address && <button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button>}
        {error && <span className="text-[12.5px] font-semibold text-bad" role="alert">{error}</span>}
      </div>
    </div>
  );
}
