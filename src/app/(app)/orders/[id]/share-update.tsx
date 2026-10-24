"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/nav";
import { toast } from "@/components/toast";

export type ShareOption = { key: string; label: string; text: string };

// A ready-written order update for the buyer or a factory, sent from the phone through WhatsApp or any app.
// The text can be changed before sending; nothing is sent by Sourcingo itself.
export function ShareUpdate({ options }: { options: ShareOption[] }) {
  const box = useRef<HTMLDialogElement>(null);
  const [who, setWho] = useState(options[0]?.key ?? "");
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(options.map((o) => [o.key, o.text])));
  const text = texts[who] ?? "";
  // Phones can hand the text to any app; checked after loading so the page matches what the server drew.
  const canShare = useSyncExternalStore(() => () => {}, () => "share" in navigator, () => false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in your chat.");
    } catch {
      toast("Couldn't copy. Select the text and copy it.", "bad");
    }
  }
  async function share() {
    try {
      await navigator.share({ text });
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  if (!options.length) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => box.current?.showModal()}>
        <Icon name="share" size={16} />Share update
      </button>
      <dialog ref={box} className="sheet" aria-labelledby="share-h" onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
        <div className="sheet-body">
          <span className="grabber" aria-hidden />
          <div className="row justify-between">
            <h2 id="share-h" className="text-[17px] font-semibold">Share an update</h2>
            <button type="button" className="btn ghost sm" onClick={() => box.current?.close()}>Close</button>
          </div>
          {options.length > 1 && (
            <div className="seg mt-3 w-full" role="tablist" aria-label="Send to">
              {options.map((o) => (
                <button key={o.key} type="button" role="tab" aria-selected={who === o.key} onClick={() => setWho(o.key)}>
                  {o.key === "buyer" ? "To buyer" : o.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-[12.5px] text-muted">
            {who === "buyer" ? "No factory names or prices. Change anything before sending." : "Asks the factory for today's status and photos. Change anything before sending."}
          </p>
          <textarea className="inp mt-2 h-56 w-full resize-none font-[inherit] leading-relaxed" value={text} aria-label="Message"
            onChange={(e) => setTexts((t) => ({ ...t, [who]: e.target.value }))} />
          <div className="sheet-acts">
            <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            {canShare && <button type="button" className="btn" onClick={share}>More apps</button>}
            <button type="button" className="btn" onClick={copy}>Copy</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
