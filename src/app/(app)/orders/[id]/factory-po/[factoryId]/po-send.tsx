"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { uploadPhotos } from "@/lib/photos";
import { setStylePhoto } from "../../../actions";
import { emailPo, markAccepted } from "./actions";

export type PoMailState = {
  to: string | null; cc: string | null; requestedAt: string | null; mailedAt: string | null; lastMailedAt: string | null; followUps: number;
  replyAt: string | null; replyText: string | null; acceptedAt: string | null; acceptedVia: string | null; acceptNote: string | null;
};

const at = (ts: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(ts));
const VIA: Record<string, string> = { email: "by email", link: "on the PO link", team: "marked by the team" };

// Where the factory PO stands with the factory, and the one next step: email it, wait, answer its reply, or done.
export function PoSend({ orderId, factoryId, released, blocker, factoryEmail, defaultCc, link, m, testTo }: {
  orderId: string; factoryId: string; released: boolean; blocker: string | null; factoryEmail: string; defaultCc: string; link: string | null; m: PoMailState; testTo: string | null;
}) {
  const router = useRouter();
  const [to, setTo] = useState(m.to ?? factoryEmail);
  const [cc, setCc] = useState(m.cc ?? defaultCc);
  const [form, setForm] = useState(false);
  const [note, setNote] = useState("");
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const send = () => start(async () => {
    setError("");
    const r = await emailPo(orderId, factoryId, to, cc);
    if (r.error) return setError(r.error);
    setForm(false);
    toast(testTo ? `Queued: goes to the test inbox ${testTo} within the hour` : "Queued: the PO goes to the factory within the hour");
    router.refresh();
  });
  const accept = () => start(async () => {
    setError("");
    const r = await markAccepted(orderId, factoryId, note);
    if (r.error) return setError(r.error);
    setMarking(false);
    toast("Marked accepted");
    router.refresh();
  });
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${link}`); toast("PO link copied"); } catch { setError("Couldn't copy. Your browser blocked the clipboard."); }
  };

  const waitingReply = !!m.replyAt && (!m.lastMailedAt || m.replyAt > m.lastMailedAt);
  const sending = !!m.requestedAt && (!m.lastMailedAt || m.requestedAt > m.lastMailedAt);
  let tone = "", title = "", body = "";
  if (m.acceptedAt) {
    tone = "ok"; title = `Accepted ${at(m.acceptedAt)}`;
    body = [m.acceptedVia && VIA[m.acceptedVia], m.acceptNote && `“${m.acceptNote}”`].filter(Boolean).join(": ");
  } else if (!released) {
    title = "Not sent yet"; body = "Lock and release this PO first; then email it to the factory to accept.";
  } else if (waitingReply) {
    tone = "warn"; title = `The factory replied ${at(m.replyAt!)}`; body = `“${m.replyText ?? ""}” Follow-ups are paused. Answer them, then send the PO again or mark it accepted.`;
  } else if (sending) {
    title = m.mailedAt ? "Sending again within the hour" : "Queued: goes out within the hour";
    body = `To ${m.to}${m.cc ? `, CC ${m.cc}` : ""}.${testTo ? ` Test mode: it goes to ${testTo} instead.` : ""}`;
  } else if (m.mailedAt) {
    tone = "warn"; title = `Waiting for the factory to accept · sent ${at(m.mailedAt)}`;
    body = `${m.followUps ? `${m.followUps} follow-up${m.followUps > 1 ? "s" : ""} sent, last ${at(m.lastMailedAt!)}. ` : ""}Next follow-up about 2 hours after the last email (9 am to 9 pm, Mon to Sat).`;
  } else {
    title = "Not sent yet"; body = blocker ? "Add the missing style photos below, then email it." : "Email it to the factory. They accept by replying \"Accepted\"; we follow up every 2 hours until they do.";
  }

  return (
    <section className={`panel po-send no-print ${tone}`} aria-label="Factory acceptance">
      <div className="row">
        <div className="grow min-w-0">
          <b>{title}</b>
          {body && <p>{body}</p>}
        </div>
        <div className="row">
          {link && <button type="button" className="btn sm" onClick={copy}>Copy PO link</button>}
          {link && <a className="btn sm" href={link} target="_blank" rel="noreferrer">Open as factory</a>}
        </div>
      </div>
      {released && !m.acceptedAt && (
        <div className="row mt-3">
          {!form && <button type="button" className="btn primary" disabled={!!blocker || pending} title={blocker ?? undefined}
            onClick={() => setForm(true)}>{m.mailedAt ? "Send the PO again" : "Email PO to factory"}</button>}
          {!marking && <button type="button" className="btn" disabled={pending} onClick={() => setMarking(true)}>Mark accepted</button>}
        </div>
      )}
      {form && (
        <div className="fgrid mt-3">
          <label className="field"><span>Factory email</span><input className="inp" type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></label>
          <label className="field"><span>CC</span><input className="inp" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Comma between addresses" /></label>
          <div className="row sm:col-span-2">
            <button type="button" className="btn primary" disabled={pending || !to.trim()} onClick={send}>{pending ? "Queuing…" : "Send"}</button>
            <button type="button" className="btn" onClick={() => setForm(false)}>Cancel</button>
            <small className="muted">From dheerajkhatri@sourcingo.in. No signature needed: the factory replies &quot;Accepted&quot;.</small>
          </div>
        </div>
      )}
      {marking && (
        <div className="row mt-3">
          <input className="inp grow" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="How they accepted, like: Ramesh said yes on WhatsApp" autoFocus />
          <button type="button" className="btn primary" disabled={pending} onClick={accept}>{pending ? "Saving…" : "Mark accepted"}</button>
          <button type="button" className="btn" onClick={() => setMarking(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}

// A missing style photo, added right on the PO: the factory works from the picture.
export function PoPhotoSlot({ orderId, companyId, lineId, style }: { orderId: string; companyId: string; lineId: string; style: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <label className={`fpo-addphoto no-print ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <b>{busy ? "Uploading…" : "+ Add photo"}</b>
      <small>{error || "Needed to send"}</small>
      <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for ${style}`} onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        setError("");
        try {
          const [path] = await uploadPhotos(`${companyId}/${orderId}/styles/${lineId}`, [file]);
          const r = await setStylePhoto(orderId, lineId, path);
          if (r.error) setError(r.error);
          else router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "The photo didn't upload.");
        } finally {
          setBusy(false);
        }
      }} />
    </label>
  );
}
