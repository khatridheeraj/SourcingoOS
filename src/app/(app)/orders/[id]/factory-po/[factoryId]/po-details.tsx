"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { savePoDetails, type PoDetails } from "./actions";

// The details printed on the factory PO, filled in once: the factory's ones are kept for every later PO.
export function PoDetailsForm({ initial, missing, isOwner }: { initial: PoDetails; missing: string[]; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(missing.length > 0);
  const [d, setD] = useState(initial);
  const canSetNo = initial.hasPo;
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const f = (k: keyof PoDetails["factory"]) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, factory: { ...d.factory, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value } });
  const c = (k: keyof NonNullable<PoDetails["company"]>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    d.company && setD({ ...d, company: { ...d.company, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value } });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const r = await savePoDetails(d);
      if (r.error) return setError(r.error);
      setOpen(false);
      toast("PO details saved");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="row no-print">
        {missing.length > 0 && <span className="chip warn">Missing: {missing.join(", ")}</span>}
        <button type="button" className="btn sm" onClick={() => setOpen(true)}>Edit PO details</button>
      </div>
    );
  }
  return (
    <form id="po-details" onSubmit={submit} className="panel stack no-print scroll-mt-20" aria-label="PO details">
      <div>
        <h2 className="font-bold">PO details</h2>
        <p className="muted text-[13px]">{missing.length > 0 ? `Fill in ${missing.join(", ")} so the PO prints complete. ` : ""}The factory&apos;s details are kept for its next POs too.</p>
      </div>
      <div className="fgrid">
        <label className="field"><span>PO number</span>
          <input className="inp" value={d.poNo} maxLength={40} disabled={!canSetNo} onChange={(e) => setD({ ...d, poNo: e.target.value })} placeholder="Like SO/172/2026" />
          {!canSetNo && <small>Can be set once the factory has been asked for its plan.</small>}
        </label>
        <label className="field"><span>Delivery</span>
          <input className="inp" value={d.deliveryNote} maxLength={300} disabled={!canSetNo} onChange={(e) => setD({ ...d, deliveryNote: e.target.value })} placeholder="Like 15/11/26 half lot, 2nd lot 20/11/26" />
          <small>Leave empty to print the ready-by date.</small>
        </label>
      </div>
      <fieldset className="stack">
        <legend className="challan-label">Factory</legend>
        <div className="fgrid">
          <label className="field sm:col-span-2"><span>Address</span><textarea className="inp" rows={2} maxLength={500} value={d.factory.address} onChange={f("address")} placeholder="Street, area, city, state, PIN" /></label>
          <label className="field"><span>GSTIN</span><input className="inp" maxLength={15} value={d.factory.gstin} onChange={f("gstin")} placeholder="08ABCDE1234F1Z5" /></label>
          <label className="field"><span>Mobile</span><input className="inp" type="tel" value={d.factory.phone} onChange={f("phone")} /></label>
          <label className="field"><span>Email</span><input className="inp" type="email" value={d.factory.email} onChange={f("email")} /></label>
        </div>
      </fieldset>
      {isOwner && d.company && (
        <fieldset className="stack">
          <legend className="challan-label">Our details (owner only)</legend>
          <div className="fgrid">
            <label className="field"><span>Name on PO</span><input className="inp" maxLength={120} value={d.company.legalName} onChange={c("legalName")} placeholder="Sourcingo Pvt. Ltd." /></label>
            <label className="field"><span>GSTIN</span><input className="inp" maxLength={15} value={d.company.gstin} onChange={c("gstin")} /></label>
            <label className="field"><span>Bill to address</span><textarea className="inp" rows={2} maxLength={500} value={d.company.address} onChange={c("address")} /></label>
            <label className="field"><span>Ship to address</span><textarea className="inp" rows={2} maxLength={500} value={d.company.shipAddress} onChange={c("shipAddress")} placeholder="Leave empty if same as bill to" /></label>
            <label className="field"><span>Mobile</span><input className="inp" type="tel" value={d.company.phone} onChange={c("phone")} /></label>
            <label className="field"><span>Email</span><input className="inp" type="email" value={d.company.email} onChange={c("email")} /></label>
          </div>
        </fieldset>
      )}
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={() => { setD(initial); setError(""); setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}
