"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ring } from "@/components/order-ui";
import { toast } from "@/components/toast";
import { askMessage, type Item } from "@/lib/buyer-profile";
import { dayAtNear } from "@/lib/format";
import { askBuyerDetails } from "../profile-actions";

// The top of a buyer's record: how complete it is, what is missing, and a one-tap ask to the buyer.
export function BuyerStatus({ buyerId, buyer, done, total, ready, missing, optional, asked, filled, canAsk, phone, email }: {
  buyerId: string; buyer: string; done: number; total: number; ready: boolean; missing: Item[]; optional: Item[];
  asked: string | null; filled: string | null; canAsk: boolean; phone: string | null; email: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, go] = useTransition();
  const fromBuyer = missing.filter((i) => i.from === "buyer");
  const fromUs = missing.filter((i) => i.from === "us");

  function ask() {
    setError("");
    go(async () => {
      const r = await askBuyerDetails(buyerId);
      if (r.error || !r.url) { setError(r.error ?? "Couldn't make the link. Try again."); return; }
      setMsg(askMessage(buyer, missing, r.url));
      router.refresh();
    });
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in your chat or email."); }
    catch { toast("Couldn't copy. Select the text and copy it.", "bad"); }
  }

  return (
    <section className="panel stack" aria-labelledby="ready-h">
      <div className="flex items-center gap-4">
        <Ring done={done} total={total} size={60}><b className="num text-[14px]">{Math.round((done / total) * 100)}%</b></Ring>
        <div className="min-w-0">
          <h2 id="ready-h" className={`text-[16px] font-semibold ${ready ? "text-ok" : "text-warn"}`}>
            {ready ? "Ready for orders" : `${missing.length} ${missing.length === 1 ? "thing" : "things"} missing before orders`}
          </h2>
          <p className="muted text-[13px]">
            {ready ? (optional.length ? `Nice to have: ${optional.map((i) => i.label.toLowerCase()).join(", ")}.` : "Every detail and paper is in.")
              : "Invoices, export papers and shipments show these until they are in."}
            {filled && <> {buyer} last filled in details {dayAtNear(filled)}.</>}
          </p>
        </div>
      </div>

      {!ready && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fromBuyer.length > 0 && (
            <div>
              <div className="text-[12.5px] font-medium mb-1">From {buyer}</div>
              <ul className="text-[13.5px] list-disc pl-5 space-y-0.5">{fromBuyer.map((i) => <li key={i.key}>{i.label}</li>)}</ul>
            </div>
          )}
          {fromUs.length > 0 && (
            <div>
              <div className="text-[12.5px] font-medium mb-1">From us</div>
              <ul className="text-[13.5px] list-disc pl-5 space-y-0.5">{fromUs.map((i) => <li key={i.key}>{i.label}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {canAsk && fromBuyer.length > 0 && !msg && (
        <div className="stack gap-1">
          <button type="button" className="btn primary w-full sm:w-auto sm:self-start" disabled={pending} onClick={ask}>
            {pending ? "Making the link…" : `Ask ${buyer} to fill these in`}
          </button>
          {asked && <small className="muted">Asked {dayAtNear(asked)}. They fill it in and upload papers on their own page.</small>}
        </div>
      )}
      {msg && (
        <div className="stack">
          <textarea className="inp h-48 w-full resize-none leading-relaxed" value={msg} readOnly aria-label={`Message to ${buyer}`} />
          <div className="row">
            <a className="btn primary" href={`https://wa.me/${(phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <a className="btn" href={`mailto:${email ?? ""}?subject=${encodeURIComponent("Your company details for Sourcingo")}&body=${encodeURIComponent(msg)}`}>Email</a>
            <button type="button" className="btn" onClick={() => copy(msg)}>Copy</button>
            <button type="button" className="btn ghost" onClick={() => setMsg(null)}>Close</button>
          </div>
        </div>
      )}
      {error && <div className="errbox" role="alert">{error}</div>}
    </section>
  );
}
