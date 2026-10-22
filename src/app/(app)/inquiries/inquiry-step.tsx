"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { WaIcon } from "@/components/order-sheet";
import { toast } from "@/components/toast";
import { day, money, qty } from "@/lib/format";
import { LOST_REASONS, STAGES } from "@/lib/inquiries";
import { addDays } from "@/lib/payments";
import { waLink } from "@/lib/whatsapp";
import { addInquiryNote, setInquirySample, setInquiryStatus } from "./actions";

// What an inquiry needs to show its next step, on its own page or in the sheet from the list.
export type StepInquiry = {
  id: string;
  no: string;
  title: string;
  product: string;
  status: string;
  stage: number;
  hasBuyer: boolean;
  price: string;
  quoted: number | null;
  unit: string;
  estQty: number | null;
  sampleSentOn: string | null;
  contactName: string;
  contact: string;
  nextFollowUp: string;
};

type Mode = "" | "quote" | "sample" | "lost";
const dayShort = (d: string) => day(d).replace(/ \d{4}$/, "");
const FOLLOW = [{ d: 1, label: "Tomorrow" }, { d: 3, label: "In 3 days" }, { d: 7, label: "Next week" }];

// The message to send the buyer at each stage, ready in WhatsApp.
export function chaseText(i: StepInquiry): string {
  const hi = `Hi${i.contactName ? ` ${i.contactName.split(/\s+/)[0]}` : ""},`;
  const what = `${i.product}${i.estQty ? ` (${qty(i.estQty)} ${i.unit})` : ""}`;
  if (i.stage === 2) return `${hi} did you get the ${i.product} sample we sent? Please share your comments, so we can go ahead with the order.`;
  if (i.stage === 1) return `${hi} following up on our price${i.quoted != null ? ` of ${money(i.quoted)} a ${i.unit === "m" ? "metre" : "piece"}` : ""} for ${what}. Shall we go ahead with a sample or the order?`;
  return `${hi} thank you for the inquiry for ${what}. We are working on the price and will share it shortly. Could you confirm the quantity and the delivery date you need?`;
}

export function ChaseButton({ i, className = "btn" }: { i: StepInquiry; className?: string }) {
  return (
    <a href={waLink(chaseText(i), i.contact)} target="_blank" rel="noreferrer" className={`${className} wa-link`}>
      <WaIcon />Chase on WhatsApp
    </a>
  );
}

// The next step for an open inquiry: one main button for where it stands, the other moves a tap away,
// and what happened today with the next follow-up.
export function InquiryNext({ i, today, onDone }: { i: StepInquiry; today: string; onDone?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("");
  const [price, setPrice] = useState(i.price);
  const [sampleNote, setSampleNote] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const per = i.unit === "m" ? "metre" : "piece";

  function run(job: () => Promise<{ error?: string }>, done: string) {
    setError("");
    start(async () => {
      const res = await job();
      if (res.error) return setError(res.error);
      toast(done);
      setMode("");
      setNote("");
      onDone?.();
      router.refresh();
    });
  }

  const order = i.hasBuyer
    ? <Link href={`/orders/new?inquiry=${i.id}`} className={`btn ${i.stage >= 1 ? "primary" : ""}`}>{i.stage >= 1 ? "Buyer confirmed: make the order" : "Make the order"}</Link>
    : null;
  const quoteBtn = <button type="button" className={`btn ${i.stage === 0 ? "primary" : ""}`} aria-expanded={mode === "quote"} onClick={() => setMode(mode === "quote" ? "" : "quote")}>{i.stage === 0 ? "We sent the price" : "Change the price"}</button>;
  const sampleBtn = i.stage < 2
    ? <button type="button" className="btn" aria-expanded={mode === "sample"} onClick={() => setMode(mode === "sample" ? "" : "sample")}>Sample sent</button>
    : null;

  return (
    <div className="inq-next">
      <div className="inq-acts">
        {i.stage === 0 ? <>{quoteBtn}{sampleBtn}{order}</> : <>{order}{sampleBtn}{quoteBtn}</>}
        <button type="button" className="btn ghost text-bad" aria-expanded={mode === "lost"} onClick={() => setMode(mode === "lost" ? "" : "lost")}>Lost</button>
      </div>
      {!i.hasBuyer && i.stage >= 1 && <p className="mt-2 text-[13px] text-muted">To make the order, the owner first adds {i.title} as a buyer on this inquiry&apos;s page.</p>}

      {mode === "quote" && (
        <div className="inq-choice">
          <label className="field">
            <span>Price you sent, ₹ a {per}</span>
            <input className="inp" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus placeholder="450" />
          </label>
          <button type="button" className="btn primary" disabled={pending || !price.trim()} onClick={() => run(() => setInquiryStatus(i.id, "quoted", { quoted_price: price }), "Price saved")}>
            {pending ? "Saving…" : "Save price"}
          </button>
        </div>
      )}
      {mode === "sample" && (
        <div className="inq-choice">
          <label className="field">
            <span>What went (optional)</span>
            <input className="inp" value={sampleNote} onChange={(e) => setSampleNote(e.target.value)} maxLength={300} autoFocus placeholder="2 colours, size M, by courier DTDC 1234" />
          </label>
          <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => setInquirySample(i.id, today, sampleNote), "Sample noted. Follow up in a few days.")}>
            {pending ? "Saving…" : "Sent today"}
          </button>
        </div>
      )}
      {mode === "lost" && (
        <div className="inq-choice">
          <div className="row !gap-1.5">
            {LOST_REASONS.map((r) => (
              <button key={r} type="button" className={`chip ${reason === r ? "info" : ""}`} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Or write the reason" aria-label="Reason it was lost" />
          <button type="button" className="btn danger" disabled={pending || !reason.trim()} onClick={() => run(() => setInquiryStatus(i.id, "lost", { lost_reason: reason }), "Marked lost")}>
            {pending ? "Saving…" : "Mark lost"}
          </button>
        </div>
      )}

      <div className="inq-follow">
        <textarea className="inp" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? Called Sana, she wants it in 2 colours…" aria-label="What happened" />
        <div className="inq-when" role="group" aria-label="Next follow-up">
          <span>Follow up</span>
          {FOLLOW.map((f) => {
            const d = addDays(today, f.d);
            return <button key={f.d} type="button" className={`chip ${next === d ? "info" : ""}`} aria-pressed={next === d} onClick={() => setNext(next === d ? "" : d)}>{f.label}</button>;
          })}
          <label className={`chip inq-other ${next && !FOLLOW.some((f) => addDays(today, f.d) === next) ? "info" : ""}`}>
            {next && !FOLLOW.some((f) => addDays(today, f.d) === next) ? dayShort(next) : "Other day"}
            <input type="date" min={today} value={next} onChange={(e) => setNext(e.target.value)} aria-label="Pick another day" />
          </label>
        </div>
        <button type="button" className="btn primary inq-save" disabled={pending || (!note.trim() && !next)} onClick={() => run(() => addInquiryNote(i.id, note, next), next ? "Saved. It comes back on the day you picked." : "Note saved")}>
          {pending && !mode ? "Saving…" : "Save follow-up"}
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}

// The stages across the top of an inquiry: Asked, Quoted, Sample sent, Order.
export function StageBar({ stage, lost }: { stage: number; lost?: boolean }) {
  return (
    <ol className={`inq-stages ${lost ? "is-lost" : ""}`} aria-label="Where it stands">
      {STAGES.map((s, n) => (
        <li key={s} className={n < stage ? "done" : n === stage ? "now" : ""} aria-current={n === stage ? "step" : undefined}>{s}</li>
      ))}
    </ol>
  );
}

const EVENT = "sourcingo:inquiry-sheet";

export function InquiryButton({ i, label, className = "btn sm" }: { i: StepInquiry; label: string; className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent<StepInquiry>(EVENT, { detail: i }))}>{label}</button>;
}

// The sheet the list opens to move an inquiry on without leaving the list.
export function InquirySheet({ today }: { today: string }) {
  const box = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState<StepInquiry | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setI((e as CustomEvent<StepInquiry>).detail);
      box.current?.showModal();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = () => box.current?.close();
  return (
    <dialog ref={box} className="sheet" aria-labelledby="inq-sheet-h" onClick={(e) => { if (e.target === box.current) close(); }} onClose={() => setI(null)}>
      {i && (
        <div className="sheet-body">
          <div className="grabber" aria-hidden />
          <div className="row !flex-nowrap items-start">
            <div className="min-w-0 grow">
              <h2 id="inq-sheet-h" className="text-[16px] font-semibold">{i.title} · {i.product}</h2>
              <p className="text-[13px] text-muted"><span className="code">{i.no}</span> · {STAGES[i.stage]}</p>
            </div>
            <button type="button" className="btn ghost sm" onClick={close} aria-label="Close">✕</button>
          </div>
          <div className="mt-3 row !gap-2">
            <ChaseButton i={i} className="btn sm" />
            <Link href={`/inquiries/${i.id}`} className="btn sm">Open the inquiry</Link>
          </div>
          <div className="mt-3">
            <InquiryNext key={i.id} i={i} today={today} onDone={close} />
          </div>
        </div>
      )}
    </dialog>
  );
}
