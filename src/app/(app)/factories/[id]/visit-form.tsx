"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { takeBackVisit, verifyFactory } from "./actions";

// The certificates garment buyers ask for most, one tap each; anything else is typed.
const COMMON = ["BSCI", "SEDEX", "GOTS", "OEKO-TEX", "WRAP", "ISO 9001"];

// Recording a visit: the day, whether the GSTIN checked out, the Udyam number and certificates seen on the wall.
export function VisitForm({ factoryId, today, hasVisit, lastId }: { factoryId: string; today: string; hasVisit: boolean; lastId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(today);
  const [gst, setGst] = useState(false);
  const [udyam, setUdyam] = useState("");
  const [certs, setCerts] = useState<{ name: string; until: string }[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sure, setSure] = useState(false);
  const [pending, start] = useTransition();

  const addCert = (name = "") => setCerts((c) => (c.length >= 8 ? c : [...c, { name, until: "" }]));
  const setCert = (i: number, k: "name" | "until", v: string) => setCerts((c) => c.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await verifyFactory({ factoryId, visitedOn: on, gstOk: gst, udyam, certs, note });
      if (res.error) return setError(res.error);
      toast("Visit saved. The factory is verified.");
      setOpen(false);
      setCerts([]);
      setNote("");
      router.refresh();
    });
  }

  function takeBack() {
    if (!lastId) return;
    setError("");
    start(async () => {
      const res = await takeBackVisit(factoryId, lastId);
      if (res.error) return setError(res.error);
      setSure(false);
      toast("Visit taken back.");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="row">
        <button type="button" className={hasVisit ? "btn" : "btn primary"} onClick={() => setOpen(true)}>Record a visit</button>
        {lastId && (sure ? (
          <>
            <span className="text-[13px]">Take back the last visit?</span>
            <button type="button" className="btn sm" disabled={pending} onClick={takeBack}>{pending ? "Taking back…" : "Yes, take it back"}</button>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setSure(false)}>No</button>
          </>
        ) : <button type="button" className="btn ghost" onClick={() => setSure(true)}>Take back the last visit</button>)}
        {error && <small className="text-bad" role="alert">{error}</small>}
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={save} noValidate>
      <div className="fgrid">
        <label className="field"><span>Day of the visit <i>*</i></span>
          <input className="inp" type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} required autoFocus />
        </label>
        <label className="field"><span>Udyam number</span>
          <input className="inp code" value={udyam} maxLength={24} placeholder="UDYAM-RJ-17-0012345" autoCapitalize="characters"
            onChange={(e) => setUdyam(e.target.value.toUpperCase())} />
        </label>
      </div>
      <label className="row text-[13px]"><input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} /> GSTIN checked on the GST portal: active, in this factory&apos;s name</label>
      <div className="stack gap-2">
        <span className="text-[13px] font-medium">Certificates seen</span>
        {certs.map((c, i) => (
          <div key={i} className="row flex-nowrap">
            <input className="inp" aria-label={`Certificate ${i + 1} name`} value={c.name} maxLength={60} placeholder="Name" onChange={(e) => setCert(i, "name", e.target.value)} />
            <input className="inp" type="date" aria-label={`Certificate ${i + 1} valid until`} value={c.until} onChange={(e) => setCert(i, "until", e.target.value)} />
            <button type="button" className="btn ghost sm" aria-label={`Remove certificate ${i + 1}`} onClick={() => setCerts((x) => x.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        {certs.length < 8 && (
          <div className="row">
            {COMMON.filter((n) => !certs.some((c) => c.name === n)).map((n) => <button key={n} type="button" className="btn sm" onClick={() => addCert(n)}>+ {n}</button>)}
            <button type="button" className="btn sm" onClick={() => addCert()}>+ Other</button>
          </div>
        )}
      </div>
      <label className="field"><span>Note for the team</span>
        <input className="inp" value={note} maxLength={300} placeholder="e.g. 40 machines, clean floor, own cutting table" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save visit"}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );
}
