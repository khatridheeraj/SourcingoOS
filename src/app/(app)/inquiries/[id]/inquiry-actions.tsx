"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LOST_REASONS } from "@/lib/inquiries";
import { uploadPhotos } from "@/lib/photos";
import { toast } from "@/components/toast";
import { addInquiryNote, setInquiryPhotos, setInquiryStatus } from "../actions";

type Photo = { path: string; url: string };

// What the team does on an inquiry: note a follow-up, send a quote, mark it lost, make it an order, and keep its photos.
export function InquiryActions({ id, companyId, status, hasBuyer, prospect, isOwner, quotedPrice, nextFollowUp, today, photos, allPhotos }: {
  id: string;
  companyId: string;
  status: string;
  hasBuyer: boolean;
  prospect: string;
  isOwner: boolean;
  quotedPrice: string;
  nextFollowUp: string;
  today: string;
  photos: Photo[];
  allPhotos: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "quote" | "lost">("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState(nextFollowUp && nextFollowUp >= today ? nextFollowUp : "");
  const [price, setPrice] = useState(quotedPrice);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  const open = status === "new" || status === "quoted";

  function run(label: string, job: () => Promise<{ error?: string }>, done: string, after?: () => void) {
    setError("");
    setBusy(label);
    start(async () => {
      const res = await job();
      setBusy("");
      if (res.error) return setError(res.error);
      toast(done);
      after?.();
      router.refresh();
    });
  }

  function addPhotos(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (allPhotos.length + files.length > 12) return setError("An inquiry can keep up to 12 photos. Remove some first.");
    run("photos", async () => {
      try {
        const paths = await uploadPhotos(`${companyId}/inquiries/${id}`, files);
        return await setInquiryPhotos(id, [...allPhotos, ...paths]);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "The photos didn't upload." };
      }
    }, files.length === 1 ? "Photo added" : `${files.length} photos added`);
  }

  return (
    <>
      {open && (
        <div className="panel">
          <div className="inq-acts">
            {hasBuyer ? (
              <Link href={`/orders/new?inquiry=${id}`} className="btn primary">Buyer confirmed: make the sales order</Link>
            ) : (
              <span className="btn primary pointer-events-none opacity-60" aria-disabled>Make the sales order</span>
            )}
            <button type="button" className="btn" aria-expanded={mode === "quote"} onClick={() => setMode(mode === "quote" ? "" : "quote")}>
              {status === "quoted" ? "Change the quote" : "We sent a quote"}
            </button>
            <button type="button" className="btn danger" aria-expanded={mode === "lost"} onClick={() => setMode(mode === "lost" ? "" : "lost")}>Mark lost</button>
          </div>
          {!hasBuyer && (
            <p className="mt-2 text-[13px] text-warn">
              {prospect} isn&apos;t a buyer in the app yet. {isOwner ? <>Add them in <Link href="/buyers" className="link">Buyers</Link></> : "Ask the owner to add them in Buyers"}, then pick them with Edit details to make the order.
            </p>
          )}
          {mode === "quote" && (
            <div className="inq-choice">
              <label className="field">
                <span>Price quoted, ₹ per piece <i>*</i></span>
                <input className="inp" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
              </label>
              <div className="row">
                <button type="button" className="btn primary" disabled={pending}
                  onClick={() => run("quote", () => setInquiryStatus(id, "quoted", { quoted_price: price }), "Quote saved", () => setMode(""))}>
                  {busy === "quote" ? "Saving…" : "Save quote"}
                </button>
                <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
              </div>
            </div>
          )}
          {mode === "lost" && (
            <div className="inq-choice">
              <span className="text-[12.5px] font-medium">Why was it lost? <i className="not-italic text-bad">*</i></span>
              <div className="row">
                {LOST_REASONS.map((r) => (
                  <button key={r} type="button" className={`chip ${reason === r ? "info" : ""}`} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
                ))}
              </div>
              <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Or write the reason" aria-label="Reason it was lost" />
              <div className="row">
                <button type="button" className="btn danger" disabled={pending || !reason.trim()}
                  onClick={() => run("lost", () => setInquiryStatus(id, "lost", { lost_reason: reason }), "Marked lost", () => setMode(""))}>
                  {busy === "lost" ? "Saving…" : "Mark lost"}
                </button>
                <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
        </div>
      )}

      {status === "lost" && (
        <div className="panel row">
          <span className="grow text-[13.5px]">The buyer came back? Open it again to follow up.</span>
          <button type="button" className="btn" disabled={pending} onClick={() => run("reopen", () => setInquiryStatus(id, "new", {}), "Inquiry opened again")}>
            {busy === "reopen" ? "Saving…" : "Open again"}
          </button>
          {error && <p className="w-full text-[13px] font-semibold text-bad" role="alert">{error}</p>}
        </div>
      )}

      {open && (
        <div className="panel">
          <h2>Log a follow-up</h2>
          <textarea className="inp" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)}
            placeholder="Called Sana, sent the price for 1200 pcs, she replies Friday" aria-label="What happened" />
          <div className="row mt-3">
            <label className="row !gap-2 text-[13px] font-medium">Next follow-up
              <input className="inp !w-auto" type="date" value={next} min={today} onChange={(e) => setNext(e.target.value)} />
            </label>
            <button type="button" className="btn primary ml-auto" disabled={pending || (!note.trim() && !next)}
              onClick={() => run("note", () => addInquiryNote(id, note, next), "Follow-up saved", () => setNote(""))}>
              {busy === "note" ? "Saving…" : "Save follow-up"}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Photos</h2>
        <div className="fphotos">
          {photos.map((p) => (
            <div key={p.path} className="fphoto">
              <a href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                <img src={p.url} alt="Inquiry reference" />
              </a>
              {open && (
                <button type="button" aria-label="Remove photo" disabled={pending}
                  onClick={() => run("rm", () => setInquiryPhotos(id, allPhotos.filter((x) => x !== p.path)), "Photo removed")}>×</button>
              )}
            </div>
          ))}
          {open && allPhotos.length < 12 && (
            <label className={`fphoto-add ${pending ? "pointer-events-none opacity-50" : ""}`}>
              <span aria-hidden>+</span>{busy === "photos" ? "Uploading…" : "Add photos"}
              <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {!photos.length && !open && <p className="muted text-[13px]">No photos.</p>}
        {!open && error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      </div>
    </>
  );
}
