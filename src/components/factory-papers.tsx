"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";
import { DOC_KINDS, type DocKind } from "@/lib/factory-kyc";
import { day } from "@/lib/format";
import { uploadPhotos, uploadReports } from "@/lib/photos";

export type PaperRow = {
  id: string; kind: DocKind; cert_no: string | null; valid_until: string | null; url: string | null; file_name: string | null;
  status: "pending" | "checked" | "turned_down"; status_note: string | null;
};
export type PaperInput = { kind: DocKind; no: string; until: string; path: string; fileName: string | null };
type Result = Promise<{ error?: string }>;
type Lang = "en" | "hi";

const W = {
  en: {
    need: "Needed before the first PO", optional: "If it has one", add: "Upload", replace: "Replace", open: "Open",
    toCheck: "Sent by the factory: check it", waiting: "Waiting for Sourcingo's check", turnedDown: "Turned down", real: "It's right", turnDown: "Turn down",
    why: "Why? The factory reads this", send: "Send", no: "Number (optional)", until: "Valid until", save: "Save", saving: "Uploading…", cancel: "Cancel",
    file: "Photo or PDF", needFile: "Pick a photo or PDF of the paper.", saved: "Saved.", sent: "Sent to Sourcingo to check.", to: (d: string) => `valid to ${d}`,
    ranOut: (d: string) => `Ran out ${d}`, skipGst: "Not needed: no GST",
  },
  hi: {
    need: "पहले PO से पहले ज़रूरी", optional: "अगर हो तो", add: "लगाएँ", replace: "बदलें", open: "खोलें",
    toCheck: "", waiting: "Sourcingo जाँच रहा है", turnedDown: "नहीं माना गया", real: "", turnDown: "",
    why: "", send: "", no: "नंबर (ज़रूरी नहीं)", until: "कब तक मान्य", save: "भेजें", saving: "भेज रहे हैं…", cancel: "रद्द करें",
    file: "फोटो या PDF", needFile: "कागज़ की फोटो या PDF चुनें।", saved: "सेव हुआ।", sent: "Sourcingo को जाँच के लिए भेजा।", to: (d: string) => `${d} तक मान्य`,
    ranOut: (d: string) => `${d} को ख़त्म`, skipGst: "ज़रूरी नहीं: GST नहीं है",
  },
} as const;

// The papers a factory gives us, one line each: what is there, its check, and an upload right on the line.
// The team's uploads count as checked; the factory's wait for the team's check (as its certificates do).
export function FactoryPapers({ rows, folder, mode, lang = "en", canEdit, noGst, today, actions }: {
  rows: PaperRow[]; folder: string; mode: "team" | "factory"; lang?: Lang; canEdit: boolean; noGst: boolean; today: string;
  actions: { save: (p: PaperInput) => Result; check?: (id: string, ok: boolean, note: string) => Result };
}) {
  const w = W[mode === "team" ? "en" : lang];
  const router = useRouter();
  const [open, setOpen] = useState<DocKind | null>(null);
  const [no, setNo] = useState("");
  const [until, setUntil] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [downId, setDownId] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const begin = (k: DocKind) => { setOpen(k); setNo(""); setUntil(""); setFile(null); setError(""); };
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    if (!file) return setError(w.needFile);
    start(async () => {
      setError("");
      let path: string; let fileName: string | null = null;
      try {
        if (/\.pdf$/i.test(file.name)) [{ path, file_name: fileName }] = await uploadReports(folder, [file]);
        else { [path] = await uploadPhotos(folder, [file]); fileName = file.name; }
      } catch (err) {
        return setError((err as Error).message);
      }
      const r = await actions.save({ kind: open, no: no.trim(), until, path, fileName });
      if (r.error) return setError(r.error);
      toast(mode === "team" ? w.saved : w.sent);
      setOpen(null);
      router.refresh();
    });
  }
  const check = (id: string, ok: boolean, note: string) => start(async () => {
    const r = await actions.check!(id, ok, note);
    if (r.error) return setError(r.error);
    setDownId(null); setWhy("");
    router.refresh();
  });

  return (
    <ul className="paper-list">
      {DOC_KINDS.map((d) => {
        const r = rows.find((x) => x.kind === d.kind);
        const skip = d.kind === "gst" && noGst;
        const ranOut = r?.valid_until && r.valid_until < today;
        const label = mode === "factory" && lang === "hi" ? d.hi : d.label;
        const missing = !r || r.status === "turned_down";
        return (
          <li key={d.kind} className="paper-row">
            <span className={`paper-dot ${skip ? "" : missing ? (d.need ? "warn" : "") : r?.status === "pending" ? "warn" : "ok"}`} aria-hidden />
            <div className="grow min-w-0">
              <div className="row gap-2">
                <b>{label}</b>
                {r?.status === "pending" && <span className="chip warn">{mode === "team" ? w.toCheck : w.waiting}</span>}
                {r?.status === "turned_down" && <span className="chip bad">{w.turnedDown}</span>}
                {ranOut && <span className="chip bad">{w.ranOut(day(r.valid_until!))}</span>}
              </div>
              <small className="muted num">
                {skip ? w.skipGst : r ? [r.cert_no, r.valid_until && !ranOut ? w.to(day(r.valid_until)) : ""].filter(Boolean).join(" · ") : d.need ? w.need : w.optional}
                {r?.url && <>{(r.cert_no || (r.valid_until && !ranOut)) ? " · " : ""}<a className="link" href={r.url} target="_blank" rel="noreferrer">{w.open}</a></>}
              </small>
              {r?.status === "turned_down" && r.status_note && <small className="block text-bad">{r.status_note}</small>}
              {canEdit && mode === "team" && r?.status === "pending" && actions.check && downId !== r.id && (
                <div className="row mt-2 gap-2">
                  <button type="button" className="btn sm" disabled={pending} onClick={() => check(r.id, true, "")}>{w.real}</button>
                  <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setDownId(r.id)}>{w.turnDown}</button>
                </div>
              )}
              {r && downId === r.id && (
                <div className="row mt-2 flex-nowrap">
                  <input className="inp" autoFocus maxLength={200} placeholder={w.why} aria-label={w.why} value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button type="button" className="btn sm" disabled={pending} onClick={() => check(r.id, false, why)}>{w.send}</button>
                  <button type="button" className="btn ghost sm" onClick={() => setDownId(null)}>{w.cancel}</button>
                </div>
              )}
              {open === d.kind && (
                <form onSubmit={save} className="stack mt-3" noValidate>
                  <div className="fgrid">
                    <label className="field"><span>{w.file}</span>
                      <input ref={fileRef} className="inp" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} autoFocus />
                    </label>
                    <label className="field"><span>{w.no}</span><input className="inp code" maxLength={60} value={no} onChange={(e) => setNo(e.target.value)} /></label>
                    {d.expires && <label className="field"><span>{w.until}</span><input className="inp" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>}
                  </div>
                  {error && <div className="errbox" role="alert">{error}</div>}
                  <div className="row">
                    <button className="btn primary" disabled={pending}>{pending ? w.saving : w.save}</button>
                    <button type="button" className="btn" onClick={() => setOpen(null)}>{w.cancel}</button>
                  </div>
                </form>
              )}
            </div>
            {canEdit && !skip && open !== d.kind && (mode === "team" || r?.status !== "checked") && (
              <button type="button" className="btn sm paper-act" onClick={() => begin(d.kind)}>{r && !missing ? w.replace : w.add}</button>
            )}
          </li>
        );
      })}
      {error && !open && <li><div className="errbox" role="alert">{error}</div></li>}
    </ul>
  );
}
