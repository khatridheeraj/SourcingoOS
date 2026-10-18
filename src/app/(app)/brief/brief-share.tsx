"use client";

import { toast } from "@/components/toast";

// Sends the brief to a WhatsApp group or chat, or copies it. Nothing is sent by Sourcingo itself.
export function BriefShare({ text }: { text: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in your chat.");
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", "bad");
    }
  }
  return (
    <>
      <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
      <button type="button" className="btn" onClick={copy}>Copy</button>
    </>
  );
}
