"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dm, weekText, type BuyerWeek } from "@/lib/buyer-week";
import { buyerLink, markUpdateSent } from "../../actions";

// Sends this week's update the way the team already talks to buyers: WhatsApp, email or a copy to paste anywhere.
// The buyer's status link goes at the end so the photos and every detail are one tap away.
export function SendWeek({ buyerId, name, week, nextId, sent }: { buyerId: string; name: string; week: BuyerWeek; nextId: string | null; sent: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(sent);
  const [, start] = useTransition();
  const text = weekText(week, name, url || undefined);

  useEffect(() => {
    let live = true;
    buyerLink(buyerId).then((r) => { if (!live) return; if (r.url) setUrl(r.url); else setError(r.error ?? "Couldn't make the status link."); });
    return () => { live = false; };
  }, [buyerId]);

  function mark(via: "whatsapp" | "email" | "copy") {
    start(async () => {
      const r = await markUpdateSent(buyerId, via);
      if (r.error) toast(r.error, "bad");
      else { setDone(true); router.refresh(); }
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in your chat or email to the buyer.");
      mark("copy");
    } catch {
      toast("Couldn't copy. Open the message below, select it and copy.", "bad");
    }
  }
  const subject = `Your Sourcingo update, week of ${dm(week.weekOf)}`;

  return (
    <section className="card" aria-label="Send the update">
      <div className="bu-send">
        {error && <div className="errbox" role="alert">{error} The update can still be sent without the link.</div>}
        <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => mark("whatsapp")}>
          {done ? "Send again on WhatsApp" : "Send on WhatsApp"}
        </a>
        <div className="bu-acts">
          <a className="btn" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`} onClick={() => mark("email")}>Email</a>
          <button type="button" className="btn" onClick={copy}>Copy text</button>
        </div>
        {done && (
          <p className="text-[13px] text-muted" role="status">
            Marked as sent this week.{" "}
            {nextId ? <Link className="link" href={`/buyers/updates/${nextId}`}>Next buyer</Link> : <Link className="link" href="/buyers/updates">All sent. Back to the list</Link>}
          </p>
        )}
      </div>
      <details className="howto border-t border-line px-4 py-3">
        <summary>See the message</summary>
        <pre className="mt-2 whitespace-pre-wrap font-[inherit] text-[13px] leading-relaxed">{text}</pre>
      </details>
    </section>
  );
}
