"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { giveBuyerPage } from "./give-buyer-page-action";

const waTo = (s: string) => (s.match(/\+?[0-9][0-9 ()-]{6,}[0-9]/)?.[0] ?? "").replace(/\D/g, "");
const emailIn = (s: string) => s.match(/[^@\s·,;]+@[^@\s·,;]+\.[A-Za-z]{2,}/)?.[0] ?? "";

// A lead who isn't a buyer yet gets a private page in one tap: they see this ask, then our price, and answer it there.
export function GiveBuyerPage({ id, no, product, company, contactName, contact }: { id: string; no: string; product: string; company: string; contactName: string; contact: string }) {
  const router = useRouter();
  const [made, setMade] = useState<{ url: string; name: string; existing: boolean; buyerId: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const first = (made?.name ?? contactName ?? "").split(" ")[0] || "there";
  const text = made ? `Hello ${first},\nThank you for asking Sourcingo to price your ${product} (${no}). This is your own private page for it: you'll see our price there as soon as it's ready, and can accept it or ask for changes in one tap. No password needed.\n\n${made.url}\n\nPlease keep the link to yourself.` : "";
  const phone = waTo(contact), email = emailIn(contact);

  function make() {
    setError("");
    start(async () => {
      let r: Awaited<ReturnType<typeof giveBuyerPage>>;
      try { r = await giveBuyerPage(id); } catch (e) { r = { error: caught(e, "It didn't work. Try again.") }; }
      if (r.error || !r.url) { setError(r.error ?? "It didn't work. Try again."); if (r.buyerId) router.refresh(); return; }
      setMade({ url: r.url, name: r.name ?? contactName, existing: !!r.existing, buyerId: r.buyerId! });
      toast(r.existing ? `Linked to ${company}, already a buyer. Send the link below.` : `${company} is a buyer now. Send the link below.`);
    });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in your chat or email."); }
    catch { toast("Couldn't copy. Select the text and copy it.", "bad"); }
  }

  return (
    <section className="panel gbp" aria-labelledby="gbp-h">
      <h2 id="gbp-h">{made ? `Send ${first} their page` : `Give ${company || "them"} their own page`}</h2>
      {!made ? (
        <>
          <p className="muted text-[13px]">They see this ask on a private page, then our price as soon as you send it, and accept it or ask for changes there. Adds {company || "them"} to Buyers. Never factories or rates.</p>
          {error && <div className="errbox mt-3" role="alert">{error}</div>}
          <button type="button" className="btn mt-3 gbp-go" disabled={pending} onClick={make}>{pending ? "Making their page…" : "Make their page"}</button>
        </>
      ) : (
        <div className="gbp-send">
          <textarea className="inp h-44 w-full resize-none font-[inherit] leading-relaxed" value={text} readOnly aria-label={`Message to ${made.name}`} />
          <div className="gbp-acts">
            {phone && <a className="btn primary" href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp {first}</a>}
            {email && <a className={`btn${phone ? "" : " primary"}`} href={`mailto:${email}?subject=${encodeURIComponent(`Your Sourcingo page for ${product}`)}&body=${encodeURIComponent(text)}`}>Email</a>}
            <button type="button" className="btn" onClick={copy}>Copy</button>
            <button type="button" className="link" onClick={() => router.refresh()}>Done</button>
          </div>
          <p className="muted text-[12.5px]">Their people and links are in <Link className="link" href={`/buyers/${made.buyerId}/people`}>Buyers</Link>. You can <Link className="link" href={`/preview/buyer/${made.buyerId}`}>see their page</Link>.</p>
        </div>
      )}
    </section>
  );
}
