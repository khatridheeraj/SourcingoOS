"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { day, dayAt } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { COURIERS, sampleLabel, STATE_TEXT, trackUrl } from "@/lib/samples";
import type { RoundView, SampleThread } from "@/lib/samples-server";
import { waLink } from "@/lib/whatsapp";
import { addSample, forwardSample, recordAnswer, returnSample } from "./actions";

type Mode = "forward" | "return" | "answer" | "add";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const lateBy = (target: string, today: string) => { const n = Math.round((Date.parse(today) - Date.parse(target)) / 86_400_000); return `${n} ${n === 1 ? "day" : "days"}`; };

function Photos({ urls, label }: { urls: string[]; label: string }) {
  if (!urls.length) return null;
  return (
    <div className="smp-photos">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`${label} photo ${i + 1}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
          <img src={u} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

// What happened to one round, as a short trail: sent, checked, sent to the buyer, answered.
function Trail({ r, factory }: { r: RoundView; factory: string }) {
  const track = trackUrl(r.courier, r.awb);
  return (
    <ol className="smp-trail">
      <li className="done">
        <b>{r.sent_by_team ? `Added by ${r.sentByName || "the team"}` : `Sent by ${factory}`}</b>
        <span>{dayAt(r.sent_at)}</span>
        {r.note && <q>{r.note}</q>}
      </li>
      {r.status === "returned" && (
        <li className="bad"><b>Sent back to {factory}{r.answeredByName && ` by ${r.answeredByName}`}</b><span>{dayAt(r.answered_at)}</span>{r.answer_note && <q>{r.answer_note}</q>}</li>
      )}
      {r.forwarded_at && (
        <li className="done">
          <b>To buyer{r.courier ? ` by ${r.courier}` : ""}{r.awb ? ` · AWB ${r.awb}` : ""}</b>
          <span>{r.dispatched_on ? day(r.dispatched_on) : dayAt(r.forwarded_at)}{r.forwardedByName && ` · ${r.forwardedByName}`}{track && <> · <a className="link" href={track} target="_blank" rel="noreferrer">Track</a></>}</span>
          {r.buyer_note && <q>{r.buyer_note}</q>}
        </li>
      )}
      {(r.status === "approved" || r.status === "changes") && (
        <li className={r.status === "approved" ? "ok" : "bad"}>
          <b>{r.status === "approved" ? "Approved" : "Changes asked"}{r.answered_for_buyer ? ` (recorded by ${r.answeredByName || "the team"})` : " by the buyer"}</b>
          <span>{r.approved_on ? day(r.approved_on) : dayAt(r.answered_at)}</span>
          {r.answer_note && <q>{r.answer_note}</q>}
        </li>
      )}
      {r.status === "with_team" && <li className="now"><b>Waiting for the team to check it</b></li>}
      {r.status === "with_buyer" && <li className="now"><b>Waiting for the buyer&apos;s answer</b></li>}
    </ol>
  );
}

// One style's sample step on the team's screens: where it stands, the latest round with its photos, the one next
// action, and every earlier round below.
export function SampleThreadCard({ t, today, showOrder = true, readOnly = false }: { t: SampleThread; today: string; showOrder?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const box = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("forward");
  const [courier, setCourier] = useState(COURIERS[0]);
  const [other, setOther] = useState("");
  const [awb, setAwb] = useState("");
  const [sentOn, setSentOn] = useState(today);
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState(true);
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const last = t.rounds[t.rounds.length - 1];
  const earlier = t.rounds.slice(0, -1);
  const label = sampleLabel(t.stage);
  const state = STATE_TEXT[t.state];
  const nextRound = (last?.round ?? 0) + 1;
  const late = t.target && !t.doneOn && t.target < today;
  const waiting = last?.status === "with_buyer" && last.forwarded_at ? Math.floor((Date.parse(today) - Date.parse(last.dispatched_on ?? last.forwarded_at.slice(0, 10))) / 86_400_000) : 0;
  const courierName = courier === "Other" ? other.trim() : courier;
  const byHand = courierName.toLowerCase() === "by hand";

  function open(m: Mode) {
    setMode(m);
    setError("");
    setNote("");
    setAwb("");
    setOther("");
    setCourier(COURIERS[0]);
    setSentOn(today);
    setApproved(true);
    setFiles([]);
    box.current?.showModal();
  }

  function submit() {
    setError("");
    start(async () => {
      try {
        let res: { error?: string };
        if (mode === "forward") {
          if (!courierName) return setError("Say how the sample goes: the courier, or By hand.");
          if (!byHand && !awb.trim()) return setError("Enter the AWB (tracking) number, so the buyer can track the parcel.");
          res = await forwardSample(t.orderId, last.id, courierName, byHand ? "" : awb.trim(), sentOn, note);
        } else if (mode === "return") {
          if (!note.trim()) return setError("Say what to fix, so the factory knows.");
          res = await returnSample(t.orderId, last.id, note);
        } else if (mode === "answer") {
          if (!approved && !note.trim()) return setError("Say what to change, so the factory can fix it.");
          const paths = files.length ? await uploadPhotos(`${t.companyId}/${t.orderId}/samples/${t.lineId}`, files.map((f) => f.file)) : [];
          res = await recordAnswer(t.orderId, last.id, approved, note, paths, sentOn);
        } else {
          if (!files.length) return setError("Add at least one photo of the sample.");
          const paths = await uploadPhotos(`${t.companyId}/${t.orderId}/samples/${t.lineId}`, files.map((f) => f.file));
          res = await addSample(t.orderId, t.lineId, t.stage, note, paths);
        }
        if (res.error) return setError(res.error);
        box.current?.close();
        toast(mode === "forward" ? `${t.style} ${label} sent to the buyer.` : mode === "return" ? `Sent back to ${t.factory}.`
          : mode === "answer" ? (approved ? `${t.style} ${label} approved. TNA step done.` : "Changes recorded. The factory sees them in its panel.")
          : `${t.style} ${label} round ${nextRound} added.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send the photos. Try again.");
      }
    });
  }

  // Ready-written WhatsApp messages: never the buyer's name to a factory, never the factory's to a buyer.
  const toFactory = last && (last.status === "changes" || last.status === "returned")
    ? `*${t.orderNo} · ${t.style}${t.colour ? ` (${t.colour})` : ""}*\n${label}, round ${last.round}: ${last.status === "changes" ? "the buyer asked for changes" : "please fix before we send it on"}.\n${last.answer_note ?? ""}\n\nPlease make round ${nextRound} and send it with photos in your Sourcingo panel (Send sample).`
    : `*${t.orderNo} · ${t.style}${t.colour ? ` (${t.colour})` : ""}*\nPlease send the ${label.toLowerCase()}${t.target ? ` by ${dm(t.target)}` : ""}, with photos in your Sourcingo panel (Send sample).`;
  const toBuyer = last?.status === "with_buyer"
    ? `*PO ${t.buyerPo} · ${t.style}${t.colour ? ` (${t.colour})` : ""}*\n${label}${last.round > 1 ? ` (round ${last.round})` : ""} sent ${last.dispatched_on ? dm(last.dispatched_on) : ""}${last.courier ? ` by ${last.courier}` : ""}${last.awb ? `, AWB ${last.awb}` : ""}.\nPlease approve it or tell us the changes.\n\nSourcingo`
    : "";

  const title = mode === "forward" ? `Send ${label.toLowerCase()} to the buyer` : mode === "return" ? `Send back to ${t.factory}`
    : mode === "answer" ? "Record the buyer's answer" : `Add ${label.toLowerCase()}, round ${nextRound}`;

  return (
    <article className={`smp ${state.cls}`} data-sample={t.key}>
      <header className="smp-h">
        <span className="smp-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
          {t.styleUrl ? <img src={t.styleUrl} alt="" /> : <span aria-hidden>{t.style.slice(0, 2)}</span>}
        </span>
        <div className="min-w-0 grow">
          <div className="smp-title"><b className="code">{t.style}</b>{t.colour && <span>{t.colour}</span>}</div>
          <div className="smp-stage">{label}{last ? <span> · Round {last.round}</span> : null}</div>
          <div className="smp-sub">{[showOrder ? `${t.orderNo} · ${t.buyer}` : "", t.factory].filter(Boolean).join(" · ")}</div>
        </div>
      </header>

      <div className="smp-meta">
        <span className={`chip ${state.cls}`}>{state.text}</span>
        {t.doneOn ? <span className="text-ok">Done {day(t.doneOn)}</span>
          : t.target ? <span className={late ? "text-bad" : "muted"}>Target {dm(t.target)}{late ? `, ${lateBy(t.target, today)} late` : ""}</span>
          : <span className="muted">No target date</span>}
        {waiting > 0 && <span className={waiting >= 5 ? "text-warn" : "muted"}>With buyer {waiting} {waiting === 1 ? "day" : "days"}</span>}
      </div>

      {last && (
        <div className="smp-round">
          <Photos urls={last.photos} label={`${t.style} ${label}`} />
          <Trail r={last} factory={t.factory} />
          <Photos urls={last.answerPhotos} label="Answer" />
        </div>
      )}

      {!readOnly && t.state !== "approved" && t.state !== "done" && (
        <div className="smp-acts">
          {t.state === "with_team" && <>
            <button type="button" className="btn primary" onClick={() => open("forward")}>Send to buyer</button>
            <button type="button" className="btn" onClick={() => open("answer")}>Buyer already answered</button>
            <button type="button" className="btn" onClick={() => open("return")}>Send back</button>
          </>}
          {t.state === "with_buyer" && <>
            <button type="button" className="btn primary" onClick={() => open("answer")}>Record buyer&apos;s answer</button>
            <a className="btn wa" href={waLink(toBuyer)} target="_blank" rel="noreferrer">Remind buyer</a>
          </>}
          {(t.state === "changes" || t.state === "returned" || t.state === "not_sent") && <>
            <a className="btn wa" href={waLink(toFactory, t.factoryPhone)} target="_blank" rel="noreferrer">{t.state === "not_sent" ? "Ask factory" : "Tell factory"}</a>
            <button type="button" className="btn" onClick={() => open("add")}>{t.state === "not_sent" ? "Add sample" : `Add round ${nextRound}`}</button>
          </>}
        </div>
      )}

      {earlier.length > 0 && (
        <details className="smp-earlier">
          <summary>{earlier.length === 1 ? "Round 1" : `Rounds 1 to ${earlier.length}`}</summary>
          {[...earlier].reverse().map((r) => (
            <div key={r.id} className="smp-old">
              <div className="smp-old-h"><b>Round {r.round}</b><span className={`chip ${STATE_TEXT[r.status].cls}`}>{STATE_TEXT[r.status].text}</span></div>
              <Photos urls={r.photos} label={`Round ${r.round}`} />
              <Trail r={r} factory={t.factory} />
              <Photos urls={r.answerPhotos} label={`Round ${r.round} answer`} />
            </div>
          ))}
        </details>
      )}

      <dialog ref={box} className="sheet" aria-labelledby={`smp-${t.key}`} onClick={(e) => { if (e.target === box.current && !pending) box.current?.close(); }}>
        <div className="sheet-body">
          <span className="grabber" aria-hidden />
          <div className="row justify-between">
            <h2 id={`smp-${t.key}`} className="text-[17px] font-semibold">{title}</h2>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => box.current?.close()}>Close</button>
          </div>
          <p className="muted mt-1 text-[13px]"><span className="code">{t.style}</span> · {t.orderNo} · {mode === "return" || mode === "add" ? t.factory : t.buyer}</p>
          <div className="mt-3 grid gap-3">
            {mode === "forward" && <>
              <div className="field">
                <span>Sent by</span>
                <div className="smp-pick" role="radiogroup" aria-label="Courier">
                  {[...COURIERS, "Other"].map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={courier === c} disabled={pending} onClick={() => setCourier(c)}>{c}</button>
                  ))}
                </div>
              </div>
              {courier === "Other" && (
                <label className="field"><span>Courier name</span><input className="inp" value={other} maxLength={60} disabled={pending} onChange={(e) => setOther(e.target.value)} /></label>
              )}
              {!byHand && (
                <label className="field"><span>AWB (tracking) number</span>
                  <input className="inp" value={awb} maxLength={60} autoComplete="off" disabled={pending} inputMode="text" placeholder="e.g. D12345678" onChange={(e) => setAwb(e.target.value)} />
                </label>
              )}
              <label className="field"><span>Sent on</span>
                <input className="inp" type="date" value={sentOn} min={addDays(today, -30)} max={today} disabled={pending} onChange={(e) => setSentOn(e.target.value)} />
              </label>
              <label className="field"><span>Note for the buyer (optional)</span>
                <textarea className="inp h-20 resize-none font-[inherit]" maxLength={500} value={note} disabled={pending} placeholder="e.g. Thread colour corrected as per your comments"
                  onChange={(e) => setNote(e.target.value)} />
                <small>The buyer sees this and the photos, never the factory&apos;s name or its note.</small>
              </label>
            </>}
            {mode === "return" && (
              <label className="field"><span>What to fix</span>
                <textarea className="inp h-24 resize-none font-[inherit]" autoFocus maxLength={1000} value={note} disabled={pending} placeholder="e.g. Wrong thread colour, match the lab dip"
                  onChange={(e) => setNote(e.target.value)} />
                <small>The factory sees this in its panel and sends the next round.</small>
              </label>
            )}
            {mode === "answer" && <>
              <div className="seg w-full" role="radiogroup" aria-label="Buyer's answer">
                <button type="button" role="radio" aria-checked={approved} disabled={pending} onClick={() => setApproved(true)}>Approved</button>
                <button type="button" role="radio" aria-checked={!approved} disabled={pending} onClick={() => setApproved(false)}>Changes needed</button>
              </div>
              <label className="field"><span>{approved ? "Buyer's comments (optional)" : "What the buyer wants changed"}</span>
                <textarea className="inp h-24 resize-none font-[inherit]" maxLength={1000} value={note} disabled={pending}
                  placeholder={approved ? "e.g. Approved, keep the hem 1 cm shorter in bulk" : "e.g. Chest too loose, take in 1 cm; sleeve 2 cm longer"}
                  onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="field"><span>Answered on</span>
                <input className="inp" type="date" value={sentOn} min={addDays(today, -30)} max={today} disabled={pending} onChange={(e) => setSentOn(e.target.value)} />
                {approved && <small>Approving marks the {label.toLowerCase()} step done on this day.</small>}
              </label>
              <PhotoPicker files={files} onChange={setFiles} disabled={pending} label="Buyer's photos or marked-up pictures" />
            </>}
            {mode === "add" && <>
              <PhotoPicker files={files} onChange={setFiles} disabled={pending} label="Photos of the sample" />
              <label className="field"><span>Note (optional)</span>
                <textarea className="inp h-20 resize-none font-[inherit]" maxLength={500} value={note} disabled={pending} placeholder="e.g. Factory sent it on WhatsApp"
                  onChange={(e) => setNote(e.target.value)} />
              </label>
            </>}
          </div>
          {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <div className="sheet-acts">
            <button type="button" className={`btn ${mode === "return" || (mode === "answer" && !approved) ? "" : "primary"}`} disabled={pending} onClick={submit}>
              {pending ? "Saving…" : mode === "forward" ? "Send to buyer" : mode === "return" ? "Send back" : mode === "answer" ? (approved ? "Approve" : "Ask for changes") : "Add sample"}
            </button>
          </div>
        </div>
      </dialog>
    </article>
  );
}

