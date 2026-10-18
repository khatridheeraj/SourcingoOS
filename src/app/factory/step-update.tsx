"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { day, todayIST, TNA_STEPS } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { postStepUpdate } from "./actions";
import type { PanelOrder } from "./factory-order";

export type FactoryUpdate = { id: string; order_id: string; line_id: string; stage: string; done_on: string; status: "pending" | "confirmed" | "declined"; review_note: string | null; photos: number; created_at: string };

type Line = PanelOrder["lines"][number];
const MAX_PHOTOS = 10;
const name = (s: { stage: string; label: string | null }) => s.label ?? TNA_STEPS.find((t) => t.key === s.stage)?.label ?? s.stage;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

// The step after the furthest one done: what the factory most likely finished next.
function nextStep(l: Line) {
  let last = -1;
  l.stages.forEach((s, i) => { if (s.done_on) last = i; });
  return l.stages.slice(last + 1).find((s) => !s.done_on) ?? l.stages.find((s) => !s.done_on);
}

// On a released PO the factory reports progress itself: pick the style, the step and the day, add photos, send.
// Sourcingo's team confirms each update before it counts.
export function FactoryProgress({ companyId, order, updates }: { companyId: string; order: PanelOrder; updates: FactoryUpdate[] }) {
  const router = useRouter();
  const box = useRef<HTMLDialogElement>(null);
  const [lineId, setLineId] = useState("");
  const [stage, setStage] = useState("");
  const [doneOn, setDoneOn] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const today = todayIST();
  const line = order.lines.find((l) => l.id === lineId);
  const open = line?.stages.filter((s) => !s.done_on) ?? [];

  function openFor(l: Line) {
    setLineId(l.id);
    setStage(nextStep(l)?.stage ?? "");
    setDoneOn(today);
    setNote("");
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setFiles([]);
    setError("");
    box.current?.showModal();
  }

  function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    setFiles((f) => [...f, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_PHOTOS));
    if (files.length + picked.length > MAX_PHOTOS) setError(`Up to ${MAX_PHOTOS} photos. The first ${MAX_PHOTOS} are kept.`);
  }

  function drop(i: number) {
    URL.revokeObjectURL(files[i].url);
    setFiles((f) => f.filter((_, j) => j !== i));
  }

  function send() {
    if (!line || !stage) return;
    if (!files.length) return setError("Add at least one photo of the work.");
    setError("");
    start(async () => {
      try {
        const paths = await uploadPhotos(`${companyId}/${order.order_id}/factory/${line.id}`, files.map((f) => f.file));
        const res = await postStepUpdate(line.id, stage, doneOn, note, paths);
        if (res.error) return setError(res.error);
        box.current?.close();
        toast(`Sent: ${line.style} ${name(line.stages.find((s) => s.stage === stage)!)} done. Sourcingo will confirm it.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send the photos. Try again.");
      }
    });
  }

  return (
    <div className="fprog">
      <div className="row">
        <h3 className="text-[14px] font-semibold">Send progress</h3>
        <span className="muted text-[13px]">Finished a step? Mark it done with photos. Sourcingo confirms it.</span>
      </div>
      <ul>
        {order.lines.map((l) => {
          const next = nextStep(l);
          const mine = updates.filter((u) => u.line_id === l.id);
          const waiting = mine.filter((u) => u.status === "pending");
          // A step sent back counts until the factory sends that step again.
          const back = mine.filter((u) => u.status === "declined" && !mine.some((v) => v.stage === u.stage && v.created_at > u.created_at)
            && !l.stages.find((s) => s.stage === u.stage)?.done_on);
          const done = l.stages.filter((s) => s.done_on).length;
          return (
            <li key={l.id} className="fprog-row">
              <div className="fprog-id">
                <b className="code">{l.style}</b>
                <small>{done} of {l.stages.length} steps done{next ? ` · next ${name(next)}` : ""}</small>
              </div>
              <div className="fprog-st">
                {waiting.map((u) => (
                  <span key={u.id} className="chip info">{name(l.stages.find((s) => s.stage === u.stage) ?? { stage: u.stage, label: null })} sent, waiting for Sourcingo</span>
                ))}
                {back.map((u) => (
                  <span key={u.id} className="chip bad" title={u.review_note ?? undefined}>
                    {name(l.stages.find((s) => s.stage === u.stage) ?? { stage: u.stage, label: null })} sent back: {u.review_note}
                  </span>
                ))}
                {!next && <span className="chip ok">Every step done</span>}
              </div>
              {next && (
                <button type="button" className="btn done-btn" onClick={() => openFor(l)}>
                  <span aria-hidden className="done-tick">✓</span>Mark step done
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <dialog ref={box} className="sheet" aria-labelledby={`upd-${order.order_id}`} onClick={(e) => { if (e.target === box.current && !pending) box.current?.close(); }}>
        {line && (
          <div className="sheet-body">
            <span className="grabber" aria-hidden />
            <div className="row justify-between">
              <h2 id={`upd-${order.order_id}`} className="text-[17px] font-semibold">{line.style}: step done</h2>
              <button type="button" className="btn ghost sm" disabled={pending} onClick={() => box.current?.close()}>Close</button>
            </div>
            <div className="mt-3 grid gap-3">
              <label className="field"><span>Step</span>
                <select className="inp" value={stage} disabled={pending} onChange={(e) => setStage(e.target.value)}>
                  {open.map((s) => <option key={s.stage} value={s.stage}>{name(s)}{s.planned_on ? ` (target ${day(s.planned_on)})` : ""}</option>)}
                </select>
              </label>
              <label className="field"><span>Done on</span>
                <input className="inp" type="date" value={doneOn} min={addDays(today, -30)} max={today} disabled={pending} onChange={(e) => setDoneOn(e.target.value)} />
              </label>
              <div className="field">
                <span>Photos of the work ({files.length}/{MAX_PHOTOS})</span>
                <div className="fphotos">
                  {files.map((f, i) => (
                    <div key={f.url} className="fphoto">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a photo not yet sent */}
                      <img src={f.url} alt="" />
                      <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={pending} onClick={() => drop(i)}>×</button>
                    </div>
                  ))}
                  {files.length < MAX_PHOTOS && (
                    <>
                      <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
                        <span aria-hidden>+</span>Camera
                        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
                      </label>
                      <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
                        <span aria-hidden>+</span>Gallery
                        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
                      </label>
                    </>
                  )}
                </div>
              </div>
              <label className="field"><span>Note (optional)</span>
                <textarea className="inp h-20 resize-none font-[inherit]" maxLength={500} value={note} disabled={pending} placeholder="e.g. 480 of 500 pcs cut, rest tomorrow"
                  onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
            <div className="sheet-acts">
              <button type="button" className="btn primary" disabled={pending || !stage || !files.length} onClick={send}>
                {pending ? "Sending photos…" : "Send to Sourcingo"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
