"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { CLAIM_REASON, CLAIM_REASONS, type ClaimAsk, type ClaimReason } from "@/lib/guarantee";
import { uploadPhotos } from "@/lib/photos";

export type ClaimInput = { lineId: string; reason: ClaimReason; pieces: number; ask: ClaimAsk; detail: string; photos: string[] };
export type ClaimStyle = { lineId: string; orderId: string; label: string; qty: number };

const MAX_PHOTOS = 6;

// Raising a claim on a style: what went wrong, how many pieces, a remake or a refund, and photos. The buyer uses it on
// its page under a PO; the team uses it for a buyer who rang. Photos go to <company>/<order>/claims/<line>/.
export function ClaimForm({ companyId, styles, raise, forBuyer, primary = false }: {
  companyId: string; styles: ClaimStyle[]; forBuyer: boolean; primary?: boolean;
  raise: (c: ClaimInput) => Promise<{ error?: string; no?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lineId, setLineId] = useState(styles.length === 1 ? styles[0].lineId : "");
  const [reason, setReason] = useState<ClaimReason | "">("");
  const [pieces, setPieces] = useState("");
  const [ask, setAsk] = useState<ClaimAsk>("remake");
  const [detail, setDetail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const style = styles.find((s) => s.lineId === lineId);

  if (!styles.length) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = Number(pieces.replace(/[, ]/g, ""));
    if (!style) return setError("Pick the style.");
    if (!reason) return setError("Pick what went wrong.");
    if (!Number.isInteger(n) || n < 1 || n > style.qty) return setError(`Pieces affected: from 1 to the ${style.qty} ordered.`);
    if (!detail.trim()) return setError(forBuyer ? "Say what is wrong, so we can put it right." : "Say what the buyer told you.");
    start(async () => {
      try {
        const photos = files.length ? await uploadPhotos(`${companyId}/${style.orderId}/claims/${style.lineId}`, files) : [];
        const res = await raise({ lineId: style.lineId, reason, pieces: n, ask, detail, photos });
        if (res.error) return setError(res.error);
        toast(forBuyer ? `Claim ${res.no} sent. We decide within 7 days.` : `Claim ${res.no} raised for the buyer.`);
        setOpen(false);
        setReason(""); setPieces(""); setDetail(""); setFiles([]);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send the photos. Try again.");
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className={primary ? "btn primary" : "btn"} onClick={() => setOpen(true)}>
        {forBuyer ? "Something wrong? Raise a claim" : "Raise a claim for a buyer"}
      </button>
    );
  }
  return (
    <form className="stack gclaim-form" onSubmit={save} noValidate>
      {styles.length > 1 && (
        <label className="field"><span>Style <i>*</i></span>
          <select className="inp" value={lineId} onChange={(e) => setLineId(e.target.value)} autoFocus>
            <option value="">Pick the style</option>
            {styles.map((s) => <option key={s.lineId} value={s.lineId}>{s.label}</option>)}
          </select>
        </label>
      )}
      <label className="field"><span>What went wrong <i>*</i></span>
        <select className="inp" value={reason} onChange={(e) => setReason(e.target.value as ClaimReason)}>
          <option value="">Pick one</option>
          {CLAIM_REASONS.map((r) => <option key={r} value={r}>{CLAIM_REASON[r]}</option>)}
        </select>
      </label>
      <div className="fgrid">
        <label className="field"><span>Pieces affected <i>*</i></span>
          <input className="inp num" inputMode="numeric" value={pieces} maxLength={9} placeholder={style ? `Up to ${style.qty}` : ""} onChange={(e) => setPieces(e.target.value)} />
        </label>
        <div className="field">
          <span id="claim-ask">{forBuyer ? "You would like" : "The buyer asks for"}</span>
          <div className="seg w-full" role="radiogroup" aria-labelledby="claim-ask">
            {(["remake", "refund"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={ask === a} onClick={() => setAsk(a)}>{a === "remake" ? "A remake" : "A refund"}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="field"><span>What is wrong <i>*</i></span>
        <textarea className="inp" rows={3} maxLength={800} value={detail} onChange={(e) => setDetail(e.target.value)}
          placeholder={forBuyer ? "e.g. 40 pieces have holes at the side seam, carton 4" : "e.g. Buyer rang: 12 pieces short in carton 4"} />
      </label>
      <label className="field"><span>Photos (up to {MAX_PHOTOS})</span>
        <input className="inp" type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))} />
        {files.length > 0 && <small className="muted">{files.length} {files.length === 1 ? "photo" : "photos"} picked</small>}
      </label>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Sending…" : forBuyer ? "Send the claim" : "Raise the claim"}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
      </div>
    </form>
  );
}
