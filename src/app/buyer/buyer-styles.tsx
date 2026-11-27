"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear, qty } from "@/lib/format";
import { orderAgain } from "./actions";

// One style the buyer has ordered with us, as the page shows it. Prices and factories never reach this.
export type BuyerStyle = {
  lineId: string; style: string; colour: string | null; description: string | null; fabric: boolean;
  photo: string | null; lastPo: string; lastOn: string; lastQty: number; open: boolean; times: number; total: number;
  samples: string[]; qc: { pass: boolean; on: string } | null;
  asked: { no: string; on: string; status: string; qty: number; price: number | null } | null;
};

const SHOWN = 6;

// Every style the buyer has made with Sourcingo, newest first, each with one button to make it again.
export function BuyerStyles({ styles, canWrite, today }: { styles: BuyerStyle[]; canWrite: boolean; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!styles.length) return null;
  const item = (s: BuyerStyle) => (
    <StyleRow key={s.lineId} s={s} canWrite={canWrite} today={today} open={openId === s.lineId}
      onOpen={() => setOpenId(openId === s.lineId ? null : s.lineId)} onDone={() => setOpenId(null)} />
  );
  return (
    <section className="card bsty" aria-labelledby="bsty-h">
      <header className="card-h">
        <div>
          <h2 id="bsty-h">Your styles</h2>
          <p>Everything you have made with us, with its approved samples and final check. Order any of them again.</p>
        </div>
      </header>
      <ul className="bsty-list">{styles.slice(0, SHOWN).map(item)}</ul>
      {styles.length > SHOWN && (
        <details className="bmore">
          <summary>Show {styles.length - SHOWN} more styles</summary>
          <ul className="bsty-list">{styles.slice(SHOWN).map(item)}</ul>
        </details>
      )}
      <details className="howto bsty-help">
        <summary>How ordering again works</summary>
        <p>Tell us how many and by when. Your merchandiser checks the fabric and the factory&apos;s time, then comes back with the price and ship date, usually the same day. Nothing is ordered until you confirm.</p>
      </details>
    </section>
  );
}

function StyleRow({ s, canWrite, today, open, onOpen, onDone }: { s: BuyerStyle; canWrite: boolean; today: string; open: boolean; onOpen: () => void; onDone: () => void }) {
  const unit = s.fabric ? "m" : "pcs";
  const name = [s.style, s.colour].filter(Boolean).join(" · ");
  const facts = [
    ...(s.open ? ["In work now"] : []),
    s.times === 1 ? `Ordered once` : `Ordered ${s.times} times`,
    `${qty(s.total)} ${unit}`,
    `last PO ${s.lastPo}, ${dayNear(s.lastOn, today)}`,
  ];
  return (
    <li className="bsty-row">
      <div className="bsty-main">
        {s.photo ? (
          <a className="bsty-ph" href={s.photo} target="_blank" rel="noreferrer" aria-label={`Photo of ${name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
            <img src={s.photo} alt="" loading="lazy" />
          </a>
        ) : (
          <span className="bsty-ph bsty-none" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M8.5 3.5 4 6l1.6 4 2-.8V20.5h8.8V9.2l2 .8L20 6l-4.5-2.5c-.6 1.6-1.9 2.5-3.5 2.5s-2.9-.9-3.5-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </span>
        )}
        <div className="bsty-id">
          <b>{name}</b>
          {s.description && <span className="bsty-desc">{s.description}</span>}
          <span className="num bsty-facts">{facts.map((f, i) => <span key={f}>{i > 0 && " · "}<span className="nowrap">{f}</span></span>)}</span>
          {(s.samples.length > 0 || s.qc) && (
            <span className="bsty-proof">
              {s.samples.length > 0 && <span>✓ {s.samples.join(", ")} approved</span>}
              {s.qc && <span className={s.qc.pass ? "text-ok" : ""}>{s.qc.pass ? "✓ Final QC passed" : "Final QC: reworked"} {dayNear(s.qc.on, today)}</span>}
            </span>
          )}
        </div>
        <div className="bsty-act">
          {s.asked ? (
            <span className="bsty-asked">
              <b>{s.asked.status === "quoted" && s.asked.price != null ? "Price sent" : "Being priced"}</b>
              <small className="num">{qty(s.asked.qty)} {unit} · asked {dayNear(s.asked.on, today)}</small>
            </span>
          ) : canWrite ? (
            <button type="button" className="btn sm" aria-expanded={open} onClick={onOpen}>{open ? "Close" : "Order again"}</button>
          ) : null}
        </div>
      </div>
      {open && <AgainForm s={s} unit={unit} today={today} onDone={onDone} />}
    </li>
  );
}

const plusDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

function AgainForm({ s, unit, today, onDone }: { s: BuyerStyle; unit: string; today: string; onDone: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({ qty: String(s.lastQty), by: "", note: "" });
  const [bad, setBad] = useState<{ field?: "qty" | "by"; msg: string } | null>(null);
  const [pending, start] = useTransition();
  const id = `again-${s.lineId}`;

  function send(e: React.FormEvent) {
    e.preventDefault();
    setBad(null);
    start(async () => {
      let r: { error?: string; no?: string };
      try { r = await orderAgain(s.lineId, v); } catch (err) { r = { error: caught(err, "It didn't send. Try again.") }; }
      if (r.error) {
        const field = /how many/i.test(r.error) ? "qty" : /date/i.test(r.error) ? "by" : undefined;
        setBad({ field, msg: r.error });
        if (field) document.getElementById(`${id}-${field}`)?.focus();
        return;
      }
      toast(`Sent. Your merchandiser will come back with the price and date for ${s.style}.`);
      onDone();
      router.refresh();
    });
  }

  return (
    <form className="bsty-form" onSubmit={send} noValidate aria-label={`Order ${s.style} again`}>
      <div className="bsty-grid">
        <label className="field">
          <span>How many {unit === "m" ? "metres" : "pieces"}</span>
          <input id={`${id}-qty`} className="inp num" inputMode="numeric" value={v.qty} maxLength={12} autoComplete="off"
            onChange={(e) => setV({ ...v, qty: e.target.value })} aria-invalid={bad?.field === "qty" || undefined} />
          {bad?.field === "qty" && <small className="text-bad" role="alert">{bad.msg}</small>}
        </label>
        <label className="field">
          <span>Needed by <small className="muted">optional</small></span>
          <input id={`${id}-by`} className="inp" type="date" value={v.by} min={plusDays(today, 7)} max={plusDays(today, 730)}
            onChange={(e) => setV({ ...v, by: e.target.value })} aria-invalid={bad?.field === "by" || undefined} />
          {bad?.field === "by" && <small className="text-bad" role="alert">{bad.msg}</small>}
        </label>
      </div>
      <label className="field">
        <span>Anything to change <small className="muted">optional</small></span>
        <textarea className="inp" rows={2} maxLength={1000} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })}
          placeholder="A new colour, extra sizes, a different label…" />
      </label>
      {bad && !bad.field && <p className="text-[13px] font-semibold text-bad" role="alert">{bad.msg}</p>}
      <button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending…" : "Ask for price and date"}</button>
    </form>
  );
}
