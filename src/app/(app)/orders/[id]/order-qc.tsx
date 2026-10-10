"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, QC_KINDS, qcKindLabel, SHIP_QC } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { addQc, addQcPhotos, cancelQc, removeQcPhoto, type QcInput } from "../actions";

export type QcCheck = {
  id: string; kind: string; checked_on: string; result: string; pieces_checked: number | null; defects: number;
  notes: string | null; by: string; cancelled_at: string | null; cancel_reason: string | null;
  photos: { id: string; url: string }[];
};

const pct = (d: number, p: number | null) => (p ? `${((d / p) * 100).toFixed(1)}%` : "");

// Inline and final inspections on this order. Saved checks are cancelled, never edited.
export function OrderQc({ orderId, companyId, open, canRecord, today, checks, finalPassed }: {
  orderId: string;
  companyId: string;
  open: boolean;
  canRecord: boolean;
  today: string;
  checks: QcCheck[];
  finalPassed: boolean;
}) {
  const router = useRouter();
  const blank: QcInput = { kind: "final", checked_on: today, result: "", pieces_checked: "", defects: "", notes: "" };
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof QcInput, v: string) => setQ({ ...q, [k]: v });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    start(async () => {
      const res = await addQc(orderId, q);
      if (res.error || !res.id) return setError(res.error ?? "Couldn't save the check.");
      if (files.length) {
        const err = await attach(res.id, files);
        if (err) setNotice(`The check is saved, but the photos weren't: ${err} Add them again on the check below.`);
      }
      setFiles([]);
      setQ(blank);
      setAdding(false);
      router.refresh();
    });
  }

  // Uploads photos for a check, then lists them on it. Returns an error message, or "" when all went well.
  async function attach(qcId: string, list: File[]) {
    try {
      setBusy(qcId);
      const paths = await uploadPhotos(`${companyId}/${orderId}/qc/${qcId}`, list);
      const res = await addQcPhotos(orderId, qcId, paths);
      return res.error ?? "";
    } catch (e) {
      return e instanceof Error ? e.message : "Upload failed.";
    } finally {
      setBusy("");
    }
  }

  function addLater(qcId: string, list: FileList | null) {
    if (!list?.length) return;
    start(async () => {
      setNotice("");
      const err = await attach(qcId, [...list]);
      if (err) setNotice(`The photos weren't added: ${err}`);
      router.refresh();
    });
  }

  function removePhoto(id: string) {
    if (!window.confirm("Take this photo off the check? It stays in the records.")) return;
    start(async () => {
      const res = await removeQcPhoto(orderId, id);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  function cancel(id: string) {
    const reason = window.prompt("Why cancel this QC check? For example: entered on the wrong order.");
    if (reason == null) return;
    start(async () => {
      const res = await cancelQc(orderId, id, reason);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  const can = open && canRecord;
  const live = checks.filter((c) => !c.cancelled_at);
  const lastFinal = live.find((c) => SHIP_QC.includes(c.kind));

  return (
    <section className="panel">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Quality checks</h2>
        {finalPassed ? <span className="chip ok">Final QC passed</span>
          : lastFinal ? <span className="chip bad">Final QC failed</span>
          : open ? <span className="chip warn">Final QC not done</span> : null}
        {can && !adding && <button type="button" className="btn sm ml-auto" onClick={() => setAdding(true)}>Record QC</button>}
      </div>
      {notice && <p className="mb-3 text-[13px] font-semibold text-bad" role="status">{notice}</p>}
      {open && !finalPassed && <p className="muted mb-3 text-[13px]">The order can be marked Shipped once its latest final QC has passed.{!canRecord && " The Quality team records QC."}</p>}

      {adding && (
        <form onSubmit={submit} className="mb-4 rounded-[10px] border border-line p-3">
          <div className="fgrid">
            <div className="field">
              <span>Type of check</span>
              <div className="steps" role="group" aria-label="Type of check">
                {QC_KINDS.map((k) => (
                  <button key={k.key} type="button" aria-pressed={q.kind === k.key} onClick={() => set("kind", k.key)}>{k.label}</button>
                ))}
              </div>
              <small>Inline and mid-line: during production. Final: before shipping. Re-check: after a failed final.</small>
            </div>
            <div className="field">
              <span>Result <i>*</i></span>
              <div className="steps" role="group" aria-label="Result">
                <button type="button" aria-pressed={q.result === "pass"} onClick={() => set("result", "pass")}>Pass</button>
                <button type="button" aria-pressed={q.result === "fail"} onClick={() => set("result", "fail")}>Fail</button>
              </div>
            </div>
            <label className="field">
              <span>Date checked</span>
              <input className="inp" type="date" max={today} value={q.checked_on} onChange={(e) => set("checked_on", e.target.value)} />
            </label>
            <label className="field">
              <span>Pieces checked</span>
              <input className="inp" inputMode="numeric" value={q.pieces_checked} onChange={(e) => set("pieces_checked", e.target.value)} />
            </label>
            <label className="field">
              <span>Defects found</span>
              <input className="inp" inputMode="numeric" value={q.defects} placeholder="0" onChange={(e) => set("defects", e.target.value)} />
            </label>
          </div>
          <label className="field mt-3">
            <span>Notes{q.result === "fail" && <i> *</i>}</span>
            <textarea className="inp" rows={2} value={q.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder={q.result === "fail" ? "What failed, and what the factory must fix" : "Anything worth remembering"} />
          </label>
          <label className="field mt-3">
            <span>Photos</span>
            <input className="inp" type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <small>{files.length ? `${files.length} ${files.length === 1 ? "photo" : "photos"} ready to upload` : "Defects, labels, packing. You can add more later."}</small>
          </label>
          <div className="row mt-3">
            <button className="btn primary" disabled={pending}>{pending ? (busy ? "Uploading photos…" : "Saving…") : "Save QC"}</button>
            <button type="button" className="btn" onClick={() => { setAdding(false); setError(""); setQ(blank); setFiles([]); }}>Close</button>
            {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          </div>
        </form>
      )}

      {checks.length === 0 ? (
        !adding && <p className="muted text-[13px]">No QC recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checks.map((c) => (
            <li key={c.id} className={`rounded-[10px] border border-line p-3 text-[13px] ${c.cancelled_at ? "opacity-60" : ""}`}>
              <div className="row">
                <b>{qcKindLabel(c.kind)}</b>
                <span className={c.cancelled_at ? "chip" : c.result === "pass" ? "chip ok" : "chip bad"}>
                  {c.cancelled_at ? "Cancelled" : c.result === "pass" ? "Pass" : "Fail"}
                </span>
                <span className="muted">{day(c.checked_on)} · {c.by}</span>
                {can && !c.cancelled_at && (
                  <button type="button" className="btn sm danger ml-auto" disabled={pending} onClick={() => cancel(c.id)}>Cancel</button>
                )}
              </div>
              {(c.pieces_checked != null || c.defects > 0) && (
                <div className="mt-1">
                  {c.pieces_checked != null && <>{c.pieces_checked} pcs checked · </>}
                  {c.defects} {c.defects === 1 ? "defect" : "defects"}
                  {c.pieces_checked ? ` (${pct(c.defects, c.pieces_checked)})` : ""}
                </div>
              )}
              {c.notes && <div className="mt-1 whitespace-pre-line">{c.notes}</div>}
              {(c.photos.length > 0 || (can && !c.cancelled_at)) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {c.photos.map((ph, i) => (
                    <span key={ph.id} className="relative">
                      <a href={ph.url} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1} of this check`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                        <img src={ph.url} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" />
                      </a>
                      {can && !c.cancelled_at && (
                        <button type="button" className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-line bg-surface text-[11px] leading-none text-bad"
                          aria-label={`Remove photo ${i + 1}`} disabled={pending} onClick={() => removePhoto(ph.id)}>✕</button>
                      )}
                    </span>
                  ))}
                  {can && !c.cancelled_at && (
                    <label className={`btn sm ${pending ? "pointer-events-none opacity-50" : ""}`}>
                      {busy === c.id ? "Uploading…" : "Add photos"}
                      <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos to this check"
                        onChange={(e) => { addLater(c.id, e.target.files); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              )}
              {c.cancelled_at && <div className="muted mt-1">Cancelled: {c.cancel_reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
