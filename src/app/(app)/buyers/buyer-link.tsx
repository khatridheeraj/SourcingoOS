"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/nav";
import { toast } from "@/components/toast";
import { buyerLink } from "./actions";

function message(name: string, url: string): string {
  return `Hello ${name},\nHere is your live order status from Sourcingo. Open it any time to see where each of your orders is, the latest photos and the expected ship date. No password needed.\n\n${url}\n\nThis link is only for your team. Please don't forward it outside.`;
}

// Gives a buyer the private link to its live order status, ready to send on WhatsApp or by email.
// The buyer sees only its own orders: never factories, rates or other buyers.
export function BuyerLink({ buyerId, name, size = "sm" }: { buyerId: string; name: string; size?: "sm" | "md" }) {
  const box = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [pending, start] = useTransition();
  const text = url ? message(name, url) : "";

  function load(renew: boolean) {
    setError("");
    start(async () => {
      const res = await buyerLink(buyerId, renew);
      if (res.error) setError(res.error);
      else {
        setUrl(res.url!);
        setConfirmNew(false);
        if (renew) toast(`New link made. The old link for ${name} has stopped working.`);
      }
    });
  }
  function open() {
    box.current?.showModal();
    if (!url) load(false);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in your chat or email to the buyer.");
    } catch {
      toast("Couldn't copy. Select the text and copy it.", "bad");
    }
  }

  return (
    <>
      <button type="button" className={`btn ${size === "sm" ? "sm" : ""}`} onClick={open}>
        <Icon name="link" size={size === "sm" ? 14 : 16} />Status link
      </button>
      <dialog ref={box} className="sheet" aria-labelledby={`bl-${buyerId}`} onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
        <div className="sheet-body">
          <span className="grabber" aria-hidden />
          <div className="row justify-between">
            <h2 id={`bl-${buyerId}`} className="text-[17px] font-semibold">Send {name} its status link</h2>
            <button type="button" className="btn ghost sm" onClick={() => box.current?.close()}>Close</button>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            The link opens {name}&apos;s orders on any phone, with no email or password: where each style is, final QC photos and the ship date. Never factories or rates.
          </p>
          {error && <div className="errbox mt-3" role="alert">{error}</div>}
          {!url && !error && <div className="mt-3 h-48 w-full animate-pulse rounded-[10px] bg-[var(--surface-2)]" aria-label="Making the link" />}
          {url && <textarea className="inp mt-3 h-48 w-full resize-none font-[inherit] leading-relaxed" value={text} readOnly aria-label="Message" />}
          <div className="sheet-acts">
            <a className={`btn primary ${!url ? "pointer-events-none opacity-50" : ""}`} aria-disabled={!url}
              href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <button type="button" className="btn" disabled={!url} onClick={copy}>Copy</button>
          </div>
          <div className="mt-4 border-t border-[var(--line)] pt-3 text-[12.5px] text-muted">
            {!confirmNew ? (
              <button type="button" className="link" disabled={pending} onClick={() => setConfirmNew(true)}>Link sent to the wrong person? Make a new link</button>
            ) : (
              <div className="stack gap-2">
                <span>The old link stops working at once and any phone using it is signed out. Send {name} the new one after this.</span>
                <div className="row">
                  <button type="button" className="btn sm danger" disabled={pending} onClick={() => load(true)}>{pending ? "Making…" : "Make a new link"}</button>
                  <button type="button" className="btn sm" onClick={() => setConfirmNew(false)}>Keep the current link</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
