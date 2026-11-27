"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";
import { CERT_NAMES, certState } from "@/lib/factory-record";
import { day } from "@/lib/format";
import { uploadPhotos, uploadReports } from "@/lib/photos";

export type CertRow = {
  id: string; name: string; cert_no: string | null; valid_until: string | null; url: string | null; file_name: string | null;
  status: "pending" | "checked" | "turned_down"; status_note: string | null; from_factory?: boolean;
};
export type CertInput = { name: string; no: string; until: string; path: string | null; fileName: string | null };
type Result = Promise<{ error?: string }>;

const WORDS = {
  en: {
    title: "Certificates",
    teamSub: "Buyers read the ones in date as “certified” under their PO, never the factory's name. We remind you 60 days before one runs out.",
    factorySub: "GOTS, OEKO-TEX, Sedex and the like. Buyers ask for these first. Add a photo or PDF; Sourcingo checks it, then it shows on your record.",
    none: "No certificates yet.",
    add: "Add a certificate", name: "Name", no: "Certificate number", until: "Valid until", file: "Photo or PDF of the certificate",
    other: "Other", save: "Save certificate", saving: "Saving…", cancel: "Cancel",
    waiting: "Waiting for Sourcingo's check", toCheck: "Sent by the factory: check it", turnedDown: "Turned down",
    real: "It's real", turnDown: "Turn down", why: "Why? The factory reads this", send: "Send", remove: "Remove", open: "Open",
    expired: (d: string) => `Ran out ${d}`, soon: (d: string) => `Runs out ${d}`, to: (d: string) => `Valid to ${d}`, noDate: "No expiry",
    saved: "Certificate saved.", savedFactory: "Sent to Sourcingo to check.", needName: "Pick or type the certificate's name.",
  },
  hi: {
    title: "सर्टिफिकेट",
    teamSub: "",
    factorySub: "GOTS, OEKO-TEX, Sedex जैसे सर्टिफिकेट। खरीदार सबसे पहले यही पूछते हैं। फोटो या PDF लगाएँ; Sourcingo जाँचकर आपके रिकॉर्ड पर दिखाएगा।",
    none: "अभी कोई सर्टिफिकेट नहीं।",
    add: "सर्टिफिकेट जोड़ें", name: "नाम", no: "सर्टिफिकेट नंबर", until: "कब तक मान्य", file: "सर्टिफिकेट की फोटो या PDF",
    other: "दूसरा", save: "सर्टिफिकेट भेजें", saving: "भेज रहे हैं…", cancel: "रद्द करें",
    waiting: "Sourcingo जाँच रहा है", toCheck: "", turnedDown: "नहीं माना गया",
    real: "", turnDown: "", why: "", send: "", remove: "हटाएँ", open: "खोलें",
    expired: (d: string) => `${d} को ख़त्म हो गया`, soon: (d: string) => `${d} को ख़त्म होगा`, to: (d: string) => `${d} तक मान्य`, noDate: "कोई अंतिम तारीख नहीं",
    saved: "", savedFactory: "Sourcingo को जाँच के लिए भेजा।", needName: "सर्टिफिकेट का नाम चुनें या लिखें।",
  },
} as const;

// A factory's certificates with their expiry. The team adds checked ones and checks what a factory sends; the factory
// sends its own from its panel. `actions` are server actions already bound to the factory.
export function FactoryCerts({ rows, today, folder, mode, lang = "en", canEdit, actions }: {
  rows: CertRow[]; today: string; folder: string; mode: "team" | "factory"; lang?: "en" | "hi"; canEdit: boolean;
  actions: { save: (c: CertInput) => Result; remove: (id: string) => Result; check?: (id: string, ok: boolean, note: string) => Result };
}) {
  const w = WORDS[mode === "team" ? "en" : lang];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [no, setNo] = useState("");
  const [until, setUntil] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [downId, setDownId] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  const run = (fn: () => Result, said: string, after?: () => void) => start(async () => {
    setError("");
    const r = await fn();
    if (r.error) return setError(r.error);
    if (said) toast(said);
    after?.();
    router.refresh();
  });

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError(w.needName);
    start(async () => {
      setError("");
      let path: string | null = null;
      let fileName: string | null = null;
      try {
        if (file) {
          if (/\.pdf$/i.test(file.name)) [{ path, file_name: fileName }] = await uploadReports(folder, [file]);
          else { [path] = await uploadPhotos(folder, [file]); fileName = file.name; }
        }
      } catch (err) {
        return setError((err as Error).message);
      }
      const r = await actions.save({ name: name.trim(), no: no.trim(), until, path, fileName });
      if (r.error) return setError(r.error);
      toast(mode === "team" ? w.saved : w.savedFactory);
      setOpen(false); setName(""); setNo(""); setUntil(""); setFile(null);
      router.refresh();
    });
  }

  const live = rows.filter((r) => r.status !== "turned_down" || mode === "factory");
  return (
    <section className="panel stack" aria-labelledby="certs-h">
      <div className="row">
        <div className="grow">
          <h2 id="certs-h" className="font-bold">{w.title}</h2>
          <p className="muted text-[13px]">{mode === "team" ? w.teamSub : w.factorySub}</p>
        </div>
      </div>
      {live.length === 0 ? <p className="muted text-[13px]">{w.none}</p> : (
        <ul className="cert-list">
          {live.map((c) => {
            const st = certState(c.valid_until, today);
            const tone = c.status === "turned_down" ? "bad" : st === "expired" ? "bad" : st === "soon" ? "warn" : "";
            return (
              <li key={c.id} className="cert-row">
                <div className="grow min-w-0">
                  <div className="row gap-2">
                    <b>{c.name}</b>
                    {c.status === "pending" && <span className={`chip ${mode === "team" ? "warn" : ""}`}>{mode === "team" ? w.toCheck : w.waiting}</span>}
                    {c.status === "turned_down" && <span className="chip bad">{w.turnedDown}</span>}
                    {c.status !== "turned_down" && st !== "ok" && <span className={`chip ${tone}`}>{st === "expired" ? w.expired(day(c.valid_until)) : w.soon(day(c.valid_until))}</span>}
                  </div>
                  <small className="muted num">
                    {[c.cert_no, st === "ok" ? (c.valid_until ? w.to(day(c.valid_until)) : w.noDate) : ""].filter(Boolean).join(" · ")}
                    {c.url && <>{(c.cert_no || st === "ok") ? " · " : ""}<a className="link" href={c.url} target="_blank" rel="noreferrer">{w.open}{c.file_name ? ` ${c.file_name}` : ""}</a></>}
                  </small>
                  {c.status === "turned_down" && c.status_note && <small className="block text-bad">{c.status_note}</small>}
                  {canEdit && mode === "team" && c.status === "pending" && actions.check && downId !== c.id && (
                    <div className="row mt-2 gap-2">
                      <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => actions.check!(c.id, true, ""), `${c.name} checked.`)}>{w.real}</button>
                      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setDownId(c.id)}>{w.turnDown}</button>
                    </div>
                  )}
                  {downId === c.id && (
                    <div className="row mt-2 flex-nowrap">
                      <input className="inp" autoFocus maxLength={200} placeholder={w.why} aria-label={w.why} value={why} onChange={(e) => setWhy(e.target.value)} />
                      <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => actions.check!(c.id, false, why), "", () => { setDownId(null); setWhy(""); })}>{w.send}</button>
                      <button type="button" className="btn ghost sm" onClick={() => setDownId(null)}>{w.cancel}</button>
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="row cert-act">
                    {(mode === "team" || c.status !== "checked") && downId !== c.id && (
                      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => run(() => actions.remove(c.id), "")}>{w.remove}</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && !open && <div><button type="button" className={`btn ${rows.length ? "" : "primary"}`} onClick={() => setOpen(true)}>{w.add}</button></div>}
      {canEdit && open && (
        <form className="stack" onSubmit={save} noValidate>
          <div className="row cert-pick">
            {CERT_NAMES.map((n) => (
              <button key={n} type="button" className="btn sm" aria-pressed={name === n} onClick={() => setName(n)}>{n}</button>
            ))}
          </div>
          <div className="fgrid">
            <label className="field"><span>{w.name} <i>*</i></span>
              <input className="inp" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={w.other} required />
            </label>
            <label className="field"><span>{w.no}</span>
              <input className="inp code" value={no} maxLength={60} onChange={(e) => setNo(e.target.value)} />
            </label>
            <label className="field"><span>{w.until}</span>
              <input className="inp" type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <label className="field"><span>{w.file}{mode === "factory" ? <> <i>*</i></> : null}</span>
              <input className="inp" type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {error && <div className="errbox" role="alert">{error}</div>}
          <div className="row cert-go">
            <button className="btn primary" disabled={pending}>{pending ? w.saving : w.save}</button>
            <button type="button" className="btn" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>{w.cancel}</button>
          </div>
        </form>
      )}
      {!open && error && <div className="errbox" role="alert">{error}</div>}
    </section>
  );
}
