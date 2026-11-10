"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { sendBuyerMessage } from "./actions";

export type BuyerMessage = { id: string; order_id: string; body: string; from_buyer: boolean; when: string };

const MAX = 2000;

// The buyer and Sourcingo talking about one PO: the messages oldest first, and a box to write one. Folded away until
// there is something to read, so a PO card stays short.
export function BuyerTalk({ orderId, po, messages, canWrite }: { orderId: string; po: string; messages: BuyerMessage[]; canWrite: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  if (!messages.length && !canWrite) return null;
  const last = messages[messages.length - 1];
  const waiting = !!last?.from_buyer;

  function send() {
    const text = body.trim();
    setError("");
    if (!text) { setError("Write your message first."); box.current?.focus(); return; }
    if (text.length > MAX) { setError(`Keep the message under ${MAX.toLocaleString("en-IN")} characters (it has ${text.length.toLocaleString("en-IN")}).`); box.current?.focus(); return; }
    start(async () => {
      try {
        const res = await sendBuyerMessage(orderId, text);
        if (res.error) { setError(res.error); box.current?.focus(); return; }
        setBody("");
        toast("Sent. Sourcingo will answer here.");
        router.refresh();
      } catch (e) {
        setError(caught(e, "The message didn't send. Try again."));
      }
    });
  }

  return (
    <details className="btalk" open={messages.length > 0 || undefined}>
      <summary>
        {messages.length ? `Messages · ${messages.length}` : "Message Sourcingo about this PO"}
        {waiting && <span className="muted"> · waiting for Sourcingo</span>}
      </summary>
      {messages.length > 0 && (
        <ul className="talk-list">
          {messages.map((m) => (
            <li key={m.id} className="btalk-row">
              <div className="talk-meta"><b>{m.from_buyer ? "You" : "Sourcingo"}</b><span>{m.when}</span></div>
              <p className="talk-body">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className="talk-new" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="field">
            <span>{messages.length ? "Write back" : "Your message"}</span>
            <textarea ref={box} className="inp" rows={3} value={body} maxLength={MAX + 200}
              placeholder={`A question or a change on PO ${po}. Your merchandiser answers here.`}
              aria-invalid={!!error || undefined} aria-describedby={error ? `btalk-err-${orderId}` : undefined}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          </label>
          {error && <p id={`btalk-err-${orderId}`} className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <button type="submit" className="btn" disabled={pending}>{pending ? "Sending…" : "Send message"}</button>
        </form>
      )}
    </details>
  );
}
