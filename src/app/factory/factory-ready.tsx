"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear as day, qty, todayIST } from "@/lib/format";
import { addDays } from "@/lib/quick";
import { uploadPhotos } from "@/lib/photos";
import { sendGoodsReady } from "./actions";
import type { FactoryCount } from "./factory-counts";
import type { PanelOrder } from "./factory-order";
import { errorText, words, type Lang } from "./i18n";

export type ReadyNotice = {
  id: string; order_id: string; ready_on: string; lines: { line_id: string; pieces: number }[]; cartons: number; note: string | null;
  photos: number; at: string; seen_at: string | null; seen_note: string | null;
};

const MAX_PHOTOS = 10;

// When goods are packed the factory says so: from which day, pieces of each style, cartons, and photos as proof.
// Sourcingo plans Final QC and pickup and marks it seen with a word back. Folded away until there is something to read.
export function FactoryReady({ companyId, order, notices, counts, lang, canWrite }: {
  companyId: string; order: PanelOrder; notices: ReadyNotice[]; counts: FactoryCount[]; lang: Lang; canWrite: boolean;
}) {
  const router = useRouter();
  const w = words(lang);
  const today = todayIST();
  const lines = order.lines;
  // The pieces start from the last packed count, else empty.
  const startPieces = () => Object.fromEntries(lines.map((l) => {
    const packed = counts.find((c) => c.line_id === l.id)?.packed;
    return [l.id, packed ? String(packed) : ""];
  }));
  const [pieces, setPieces] = useState<Record<string, string>>(startPieces);
  const [readyOn, setReadyOn] = useState(today);
  const [cartons, setCartons] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!notices.length && !canWrite) return null;

  const waiting = notices.find((n) => !n.seen_at);
  const styleOf = (id: string) => lines.find((l) => l.id === id);
  const total = (n: ReadyNotice) => n.lines.reduce((s, x) => s + x.pieces, 0);

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    setFiles((f) => [...f, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
    if (files.length + picked.length > MAX_PHOTOS) setError(w.upTo(MAX_PHOTOS));
  }
  function drop(i: number) {
    URL.revokeObjectURL(files[i].url);
    setFiles((f) => f.filter((_, j) => j !== i));
  }

  function send() {
    setError("");
    const out = lines.filter((l) => Number(pieces[l.id] || 0) > 0).map((l) => ({ line_id: l.id, pieces: Number(pieces[l.id]) }));
    if (!out.length) return setError(w.rdyNeedPieces);
    if (!(Number(cartons) >= 1)) return setError(w.rdyNeedCartons);
    if (!files.length) return setError(w.rdyNeedPhoto);
    start(async () => {
      try {
        const paths = await uploadPhotos(`${companyId}/${order.order_id}/factory/${out[0].line_id}`, files.map((f) => f.file));
        const res = await sendGoodsReady(order.order_id, readyOn, out, Number(cartons), note.trim(), paths);
        if (res.error) return setError(errorText(lang, res.error));
        files.forEach((f) => URL.revokeObjectURL(f.url));
        setFiles([]); setNote(""); setCartons("");
        toast(w.rdySent);
        router.refresh();
      } catch (e) {
        setError(errorText(lang, caught(e, w.photoFail)));
      }
    });
  }

  const form = (
    <form className="fask-new" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="frdy-lines">
        <span className="text-[12.5px] font-medium">{w.rdyPieces}</span>
        {lines.map((l) => (
          <label key={l.id} className="frdy-line">
            <span><b className="code">{l.style}</b> <small className="muted num">{w.cntOf(qty(l.qty))}</small></span>
            <input className="inp num" inputMode="numeric" pattern="[0-9]*" value={pieces[l.id] ?? ""} disabled={pending} placeholder="0"
              aria-label={`${l.style} ${w.rdyPieces}`} onChange={(e) => setPieces((p) => ({ ...p, [l.id]: e.target.value.replace(/[^\d]/g, "").slice(0, 6) }))} />
          </label>
        ))}
      </div>
      <div className="fask-fields">
        <label className="field">
          <span>{w.rdyFrom}</span>
          <input className="inp" type="date" min={addDays(today, -7)} max={addDays(today, 30)} value={readyOn} disabled={pending} onChange={(e) => setReadyOn(e.target.value)} />
        </label>
        <label className="field">
          <span>{w.rdyCartons}</span>
          <input className="inp num" inputMode="numeric" pattern="[0-9]*" value={cartons} disabled={pending}
            onChange={(e) => setCartons(e.target.value.replace(/[^\d]/g, "").slice(0, 5))} />
        </label>
      </div>
      <div className="field">
        <span>{w.rdyPhotos(files.length, MAX_PHOTOS)}</span>
        <div className="fphotos">
          {files.map((f, i) => (
            <div key={f.url} className="fphoto">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a photo not yet sent */}
              <img src={f.url} alt="" />
              <button type="button" aria-label={w.removePhoto(i + 1)} disabled={pending} onClick={() => drop(i)}>×</button>
            </div>
          ))}
          {files.length < MAX_PHOTOS && (
            <>
              <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
                <span aria-hidden>+</span>{w.camera}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              </label>
              <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
                <span aria-hidden>+</span>{w.gallery}
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              </label>
            </>
          )}
        </div>
      </div>
      <label className="field">
        <span>{w.rdyNote}</span>
        <textarea className="inp" rows={2} maxLength={500} value={note} placeholder={w.rdyNotePh} disabled={pending} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <button type="submit" className="btn" disabled={pending}>{pending ? w.rdySending : waiting ? w.rdyResend : w.rdySend}</button>
    </form>
  );

  return (
    <details className="fsmp fask frdy" open={notices.length > 0 || undefined}>
      <summary>
        {notices.length ? w.rdyList : w.rdyTitle}
        {waiting && <span className="muted"> · {w.rdyWaiting}</span>}
      </summary>
      {notices.length > 0 && (
        <ul className="fask-list">
          {notices.map((n) => (
            <li key={n.id} className="fask-row">
              <div className="fask-head">
                <b className="num">{w.rdySummary(qty(total(n)), n.cartons, day(n.ready_on))}</b>
                <span className={`chip ${n.seen_at ? "ok" : "warn"}`}>{n.seen_at ? w.rdySeen : w.rdyWaiting}</span>
              </div>
              <p className="muted num">{n.lines.map((x) => `${styleOf(x.line_id)?.style ?? ""} ${qty(x.pieces)}`).join(" · ")} · {w.rdyPhotoCount(n.photos)}</p>
              {n.note && <p className="muted">{n.note}</p>}
              {n.seen_note && <p className="fask-answer"><b>Sourcingo</b> {n.seen_note}</p>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (notices.length > 0
        ? <details className="frdy-more"><summary>{waiting ? w.rdyResend : w.rdyTitle}</summary>{form}</details>
        : form)}
    </details>
  );
}
