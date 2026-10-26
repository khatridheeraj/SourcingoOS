"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { dayNear as day } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { sampleLabel, trackUrl, type SampleStatus } from "@/lib/samples";
import { answerSample } from "./actions";

// A sample as the buyer reads it: no factory, Sourcingo's note, the courier and its AWB, and the answers so far.
export type BuyerSample = {
  id: string; order_id: string; order_no: string; buyer_po: string | null; order_open: boolean; line_id: string; style: string; colour: string | null;
  stage: string; round: number; status: SampleStatus; photos: string[]; styleUrl: string | null; note: string | null;
  courier: string | null; awb: string | null; dispatched_on: string | null; sent_at: string | null;
  answer_note: string | null; answerPhotos: string[]; answered_at: string | null; answered_for_buyer: boolean; approved_on: string | null;
};

function Photos({ urls, label }: { urls: string[]; label: string }) {
  if (!urls.length) return null;
  return (
    <div className="smp-photos lg">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`${label} photo ${i + 1}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
          <img src={u} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

// Samples waiting for the buyer's answer, each with one tap to approve or ask for changes, and the answers given.
export function BuyerSamples({ companyId, samples }: { companyId: string; samples: BuyerSample[] }) {
  const router = useRouter();
  const box = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<{ s: BuyerSample; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const waiting = samples.filter((s) => s.status === "with_buyer" && s.order_open);
  const answered = samples.filter((s) => s.status !== "with_buyer").sort((a, b) => (b.answered_at ?? "").localeCompare(a.answered_at ?? ""));
  const earlier = (s: BuyerSample) => samples.filter((x) => x.line_id === s.line_id && x.stage === s.stage && x.round < s.round);

  function open(s: BuyerSample, approve: boolean) {
    setPick({ s, approve });
    setNote("");
    setFiles([]);
    setError("");
    box.current?.showModal();
  }

  function send() {
    if (!pick) return;
    if (!pick.approve && !note.trim()) return setError("Say what to change, so the factory can fix it.");
    setError("");
    start(async () => {
      try {
        const paths = files.length ? await uploadPhotos(`${companyId}/${pick.s.order_id}/samples/${pick.s.line_id}`, files.map((f) => f.file)) : [];
        const res = await answerSample(pick.s.id, pick.approve, note, paths);
        if (res.error) return setError(res.error);
        box.current?.close();
        toast(pick.approve ? `${pick.s.style} ${sampleLabel(pick.s.stage)} approved. Thank you.` : "Changes sent. Sourcingo will send the next sample.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send the photos. Try again.");
      }
    });
  }

  if (!samples.length) return null;
  return (
    <>
      {waiting.length > 0 && (
        <section className="card bsmp" aria-labelledby="bsmp-h">
          <header className="card-h">
            <div className="min-w-0">
              <h2 id="bsmp-h">Samples for your approval</h2>
              <p>Check the sample and its photos, then approve it or tell us what to change.</p>
            </div>
            <span className="chip warn">{waiting.length} waiting</span>
          </header>
          <ul className="bsmp-list">
            {waiting.map((s) => {
              const track = trackUrl(s.courier, s.awb);
              const before = earlier(s).filter((x) => x.answer_note);
              return (
                <li key={s.id} className="bsmp-item">
                  <div className="bsmp-h">
                    <span className="smp-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links */}
                      {s.styleUrl ? <img src={s.styleUrl} alt="" /> : <span aria-hidden>{s.style.slice(0, 2)}</span>}
                    </span>
                    <div className="min-w-0 grow">
                      <div className="smp-title"><b className="code">{s.style}</b><span className="smp-stage">{sampleLabel(s.stage)}{s.round > 1 ? ` · round ${s.round}` : ""}</span></div>
                      <div className="smp-sub">{[`PO ${s.buyer_po ?? s.order_no}`, s.colour].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                  <p className="bsmp-ship">
                    {s.courier && s.courier.toLowerCase() !== "by hand" ? <>Sent {s.dispatched_on ? day(s.dispatched_on) : ""} by {s.courier}{s.awb && <>, AWB <b className="code">{s.awb}</b></>}
                      {track && <> · <a className="link" href={track} target="_blank" rel="noreferrer">Track parcel</a></>}</>
                      : <>Handed over {s.dispatched_on ? day(s.dispatched_on) : ""}</>}
                  </p>
                  {s.note && <q className="bsmp-note">{s.note}</q>}
                  <Photos urls={s.photos} label={`${s.style} ${sampleLabel(s.stage)}`} />
                  {before.length > 0 && (
                    <p className="muted text-[12.5px]">Your earlier comments: {before.map((x) => `round ${x.round}: “${x.answer_note}”`).join(" · ")}</p>
                  )}
                  <div className="bsmp-acts">
                    <button type="button" className="btn done-btn" onClick={() => open(s, true)}><span aria-hidden className="done-tick">✓</span>Approve</button>
                    <button type="button" className="btn" onClick={() => open(s, false)}>Ask for changes</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {answered.length > 0 && (
        <details className="card bsmp-done">
          <summary className="card-h">
            <div className="min-w-0"><h2>Samples answered</h2><p>Every sample you approved or asked to change, newest first.</p></div>
            <span className="chip">{answered.length}</span>
          </summary>
          <ul className="bsmp-hist">
            {answered.map((s) => (
              <li key={s.id}>
                <span className={`chip ${s.status === "approved" ? "ok" : "bad"}`}>{s.status === "approved" ? "Approved" : "Changes asked"}</span>
                <div className="min-w-0">
                  <b><span className="code">{s.style}</span> {sampleLabel(s.stage)}{s.round > 1 ? ` · round ${s.round}` : ""}</b>
                  <small>{[`PO ${s.buyer_po ?? s.order_no}`, s.approved_on ? day(s.approved_on) : s.answered_at ? day(s.answered_at.slice(0, 10)) : "", s.answered_for_buyer ? "recorded by Sourcingo" : ""].filter(Boolean).join(" · ")}</small>
                  {s.answer_note && <q>{s.answer_note}</q>}
                  <Photos urls={s.answerPhotos} label="Your" />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <dialog ref={box} className="sheet" aria-labelledby="bsmp-sheet" onClick={(e) => { if (e.target === box.current && !pending) box.current?.close(); }}>
        {pick && (
          <div className="sheet-body">
            <span className="grabber" aria-hidden />
            <div className="row justify-between">
              <h2 id="bsmp-sheet" className="text-[17px] font-semibold">{pick.approve ? "Approve" : "Ask for changes"}: {pick.s.style} {sampleLabel(pick.s.stage).toLowerCase()}</h2>
              <button type="button" className="btn ghost sm" disabled={pending} onClick={() => box.current?.close()}>Close</button>
            </div>
            <div className="seg mt-3 w-full" role="radiogroup" aria-label="Your answer">
              <button type="button" role="radio" aria-checked={pick.approve} disabled={pending} onClick={() => setPick({ ...pick, approve: true })}>Approve</button>
              <button type="button" role="radio" aria-checked={!pick.approve} disabled={pending} onClick={() => setPick({ ...pick, approve: false })}>Ask for changes</button>
            </div>
            <div className="mt-3 grid gap-3">
              <label className="field"><span>{pick.approve ? "Comments for production (optional)" : "What should change?"}</span>
                <textarea className="inp h-28 resize-none font-[inherit]" maxLength={1000} value={note} disabled={pending}
                  placeholder={pick.approve ? "e.g. Approved. Keep the hem 1 cm shorter in bulk." : "e.g. Chest too loose, take in 1 cm. Sleeve 2 cm longer."}
                  onChange={(e) => setNote(e.target.value)} />
              </label>
              <PhotoPicker files={files} onChange={setFiles} disabled={pending} label={pick.approve ? "Photos (optional)" : "Photos or marked-up pictures (optional)"} />
            </div>
            {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
            <div className="sheet-acts">
              <button type="button" className={`btn ${pick.approve ? "primary" : ""}`} disabled={pending} onClick={send}>
                {pending ? "Sending…" : pick.approve ? "Approve sample" : "Send changes"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
