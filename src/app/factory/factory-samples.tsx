"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { day, dayAt, TNA_STEPS, todayIST } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { SAMPLE_STEPS, type SampleStatus } from "@/lib/samples";
import { sendSample } from "./actions";
import type { PanelOrder } from "./factory-order";
import { errorText, stepName, words, type Lang } from "./i18n";

// A round as the factory's panel reads it: its own photos (as links) and the answer, never the buyer's name.
export type FactoryRound = {
  id: string; order_id: string; line_id: string; stage: string; round: number; status: SampleStatus; note: string | null;
  sent_at: string; sent_by_team: boolean; dispatched_on: string | null; answer_note: string | null; answered_at: string | null; approved_on: string | null;
  photos: string[]; answerPhotos: string[];
};

type Line = PanelOrder["lines"][number];

// On a released PO the factory sends each style's fit, strike off, PP and size-set sample with photos, and sees
// what Sourcingo and the buyer said. An approval marks the step done.
export function FactorySamples({ companyId, order, rounds, lang }: { companyId: string; order: PanelOrder; rounds: FactoryRound[]; lang: Lang }) {
  const router = useRouter();
  const w = words(lang);
  const box = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<{ line: Line; stage: string; round: number } | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const name = (stage: string) => stepName(lang, stage, null, TNA_STEPS.find((t) => t.key === stage)?.label ?? stage);
  // Only the sample steps each style has.
  const all = order.lines.map((l) => ({ l, steps: SAMPLE_STEPS.filter((s) => l.stages.some((x) => x.stage === s.key)) })).filter((x) => x.steps.length);
  if (!all.length) return null;
  // An approved sample needs nothing more from the factory, so only the open ones are listed.
  const approved = (l: Line, stage: string) => !!l.stages.find((x) => x.stage === stage)?.done_on
    || rounds.filter((r) => r.line_id === l.id && r.stage === stage).at(-1)?.status === "approved";
  const lines = all.map(({ l, steps }) => ({ l, steps: steps.filter((s) => !approved(l, s.key)) })).filter((x) => x.steps.length);
  const approvedCount = all.reduce((n, { l, steps }) => n + steps.filter((s) => approved(l, s.key)).length, 0);

  function openFor(line: Line, stage: string, round: number) {
    setPick({ line, stage, round });
    setNote("");
    setFiles([]);
    setError("");
    box.current?.showModal();
  }

  function send() {
    if (!pick) return;
    if (!files.length) return setError(w.addSamplePhoto);
    setError("");
    start(async () => {
      try {
        const paths = await uploadPhotos(`${companyId}/${order.order_id}/factory/${pick.line.id}`, files.map((f) => f.file));
        const res = await sendSample(pick.line.id, pick.stage, note, paths);
        if (res.error) return setError(errorText(lang, res.error));
        box.current?.close();
        toast(w.sampleSentToast(pick.line.style, name(pick.stage)));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? errorText(lang, e.message) : w.photoFail);
      }
    });
  }

  return (
    <div className="fsmp">
      <div className="row">
        <h3 className="text-[14px] font-semibold">{w.samples}</h3>
        <span className="fsmp-sum">{lines.length ? approvedCount > 0 && w.samplesApproved(approvedCount) : w.allSamplesApproved}</span>
      </div>
      {lines.length > 0 && <ul className="fsmp-styles">
        {lines.map(({ l, steps }) => (
          <li key={l.id} className="fsmp-style">
            <b className="code">{l.style}</b>
            <ul>
              {steps.map((s) => {
                const st = l.stages.find((x) => x.stage === s.key);
                const mine = rounds.filter((r) => r.line_id === l.id && r.stage === s.key);
                const last = mine[mine.length - 1];
                const done = !!st?.done_on;
                const next = (last?.round ?? 0) + 1;
                const canSend = !done && (!last || last.status === "changes" || last.status === "returned");
                const status = done || last?.status === "approved"
                  ? { text: w.sampleApproved(day(last?.approved_on ?? st?.done_on)), cls: "ok" }
                  : !last ? (st?.planned_on && st.planned_on < todayIST() ? { text: w.sampleLate(day(st.planned_on)), cls: "bad" }
                    : { text: st?.planned_on ? w.sampleDue(day(st.planned_on)) : w.sampleNotSent, cls: "" })
                  : last.status === "with_team" ? { text: w.sampleChecking(dayAt(last.sent_at)), cls: "info" }
                  : last.status === "with_buyer" ? { text: w.sampleWithBuyer(day(last.dispatched_on)), cls: "info" }
                  : last.status === "returned" ? { text: w.sampleReturned, cls: "bad" } : { text: w.sampleChanges, cls: "bad" };
                return (
                  <li key={s.key} className="fsmp-step">
                    <div className="min-w-0">
                      <b>{name(s.key)}{last ? <span className="muted font-normal"> · {w.round(last.round)}</span> : null}</b>
                      <span className={`chip ${status.cls}`}>{status.text}</span>
                      {!done && last && (last.status === "changes" || last.status === "returned") && last.answer_note && <q className="fsmp-note">{last.answer_note}</q>}
                      {!done && last && (last.status === "changes" || last.status === "returned") && last.answerPhotos.length > 0 && (
                        <div className="smp-photos">
                          {last.answerPhotos.map((u, i) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`${w.photo} ${i + 1}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links */}
                              <img src={u} alt="" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    {canSend && (
                      <button type="button" className={`btn ${last ? "primary" : ""}`} onClick={() => openFor(l, s.key, next)}>
                        {last ? w.sendRound(next) : w.sendSample}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>}

      <dialog ref={box} className="sheet" aria-labelledby={`fsmp-${order.order_id}`} onClick={(e) => { if (e.target === box.current && !pending) box.current?.close(); }}>
        {pick && (
          <div className="sheet-body">
            <span className="grabber" aria-hidden />
            <div className="row justify-between">
              <h2 id={`fsmp-${order.order_id}`} className="text-[17px] font-semibold">{pick.line.style}: {name(pick.stage)}{pick.round > 1 ? ` · ${w.round(pick.round)}` : ""}</h2>
              <button type="button" className="btn ghost sm" disabled={pending} onClick={() => box.current?.close()}>{w.close}</button>
            </div>
            <p className="muted mt-1 text-[13px]">{w.sampleSheetHelp}</p>
            <div className="mt-3 grid gap-3">
              <PhotoPicker files={files} onChange={setFiles} disabled={pending} label={w.samplePhotos}
                words={{ camera: w.camera, gallery: w.gallery, remove: w.removePhoto }} />
              <label className="field"><span>{w.note}</span>
                <textarea className="inp h-20 resize-none font-[inherit]" maxLength={500} value={note} disabled={pending} placeholder={w.sampleNotePlaceholder}
                  onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
            <div className="sheet-acts">
              <button type="button" className="btn primary" disabled={pending || !files.length} onClick={send}>{pending ? w.sendingPhotos : w.sendToSourcingo}</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
