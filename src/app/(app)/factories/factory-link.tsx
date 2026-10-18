"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/nav";
import { toast } from "@/components/toast";
import { factoryLink } from "./actions";

type Lang = "hi" | "en";

// WhatsApp wants the number with its country code and no signs; Indian numbers are usually saved without +91.
function waNumber(phone: string | null | undefined): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? d : "";
}

function message(lang: Lang, name: string, url: string): string {
  const link = `${url}?lang=${lang}`;
  return lang === "hi"
    ? `नमस्ते ${name},\nयह आपके Sourcingo फैक्ट्री पैनल का लिंक है। इसे फोन पर खोलें: अपने ऑर्डर देखें, TNA तारीखें भरें और हर स्टेप पूरा होने पर फोटो के साथ भेजें। पासवर्ड की ज़रूरत नहीं।\n\n${link}\n\nयह लिंक सिर्फ आपकी फैक्ट्री के लिए है, किसी और को न भेजें।`
    : `Hello ${name},\nThis is your Sourcingo factory panel link. Open it on your phone to see your orders, fill your TNA dates and send each finished step with photos. No password needed.\n\n${link}\n\nThis link is only for your factory. Please don't forward it.`;
}

// Sends a factory the link to its own panel on WhatsApp, in Hindi or English. The factory needs no email or password.
export function FactoryLink({ factoryId, name, phone, size = "sm" }: { factoryId: string; name: string; phone: string | null; size?: "sm" | "md" }) {
  const box = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState<Lang>("hi");
  const [error, setError] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [pending, start] = useTransition();
  const text = url ? message(lang, name, url) : "";
  const to = waNumber(phone);

  function load(renew: boolean) {
    setError("");
    start(async () => {
      const res = await factoryLink(factoryId, renew);
      if (res.error) setError(res.error);
      else {
        setUrl(res.url!);
        setConfirmNew(false);
        if (renew) toast(`New link made. ${name}'s old link has stopped working.`);
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
      toast("Copied. Paste it in your chat with the factory.");
    } catch {
      toast("Couldn't copy. Select the text and copy it.", "bad");
    }
  }

  return (
    <>
      <button type="button" className={`btn ${size === "sm" ? "sm" : ""}`} onClick={open}>
        <Icon name="link" size={size === "sm" ? 14 : 16} />Factory link
      </button>
      <dialog ref={box} className="sheet" aria-labelledby={`fl-${factoryId}`} onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
        <div className="sheet-body">
          <span className="grabber" aria-hidden />
          <div className="row justify-between">
            <h2 id={`fl-${factoryId}`} className="text-[17px] font-semibold">Send {name} its link</h2>
            <button type="button" className="btn ghost sm" onClick={() => box.current?.close()}>Close</button>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            The link opens {name}&apos;s own panel on their phone, with no email or password. They see only their own orders, fill their TNA and mark steps done with photos.
          </p>
          <div className="seg mt-3" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === "hi"} onClick={() => setLang("hi")}>हिंदी</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          </div>
          {error && <div className="errbox mt-3" role="alert">{error}</div>}
          {!url && !error && <div className="mt-2 h-56 w-full animate-pulse rounded-[10px] bg-[var(--surface-2)]" aria-label="Making the link" />}
          {url && (
            <textarea className="inp mt-2 h-56 w-full resize-none font-[inherit] leading-relaxed" value={text} readOnly aria-label="Message" />
          )}
          <div className="sheet-acts">
            <a className={`btn wa ${!url ? "pointer-events-none opacity-50" : ""}`} aria-disabled={!url}
              href={`https://wa.me/${to}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              {to ? "WhatsApp" : "WhatsApp (choose chat)"}
            </a>
            <button type="button" className="btn" disabled={!url} onClick={copy}>Copy</button>
          </div>
          {!to && url && <p className="mt-2 text-[12.5px] text-muted">No phone number saved for {name}, so WhatsApp asks which chat to send it to.</p>}
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
