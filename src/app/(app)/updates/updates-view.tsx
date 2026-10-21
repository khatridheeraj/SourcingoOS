"use client";

import Link from "next/link";
import { useState } from "react";
import { ChaseLink, WaIcon } from "@/components/order-sheet";
import { Icon } from "@/components/nav";
import { toast } from "@/components/toast";
import { waLink } from "@/lib/quick";
import type { BuyerUpdate, FactoryChase } from "@/lib/updates";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function UpdatesView({ tab, who, factories, buyers }: { tab: "factories" | "buyers"; who: string; factories: FactoryChase[]; buyers: BuyerUpdate[] }) {
  const chased = factories.filter((f) => f.chased).length;
  return (
    <section className="card" aria-labelledby="upd-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="upd-h">{tab === "factories" ? "Factories behind plan" : "Buyer updates"}</h2>
          <p>
            {tab === "factories"
              ? factories.length ? `${`${factories.length} ${factories.length === 1 ? "factory" : "factories"}`} with late steps${chased ? ` · ${chased} chased today` : ""}. Each message lists every late order.` : "Every factory is on plan."
              : `${plural(buyers.length, "buyer")} with open orders. Check the message, then send it on WhatsApp or copy it into an email.`}
          </p>
        </div>
        <nav className="seg" aria-label="Who to message">
          <Link href={`/updates?who=${who}&tab=factories`} aria-current={tab === "factories" ? "page" : undefined} scroll={false}>Factories <span>{factories.length}</span></Link>
          <Link href={`/updates?who=${who}&tab=buyers`} aria-current={tab === "buyers" ? "page" : undefined} scroll={false}>Buyers <span>{buyers.length}</span></Link>
        </nav>
      </header>
      {tab === "factories" ? (
        factories.length === 0 ? (
          <div className="all-clear">
            <span className="all-clear-ic" aria-hidden><Icon name="check" size={28} /></span>
            <b>No factory is behind</b>
            <p>Every step that was due is done. Nothing to chase today.</p>
          </div>
        ) : (
          <ul className="upd-list">{factories.map((f) => <FactoryRow key={f.factoryId} f={f} />)}</ul>
        )
      ) : buyers.length === 0 ? (
        <p className="card-empty">No open orders.</p>
      ) : (
        <ul className="upd-list">{buyers.map((b) => <BuyerRow key={b.buyerId} b={b} />)}</ul>
      )}
    </section>
  );
}

function FactoryRow({ f }: { f: FactoryChase }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`upd-row ${f.chased ? "is-done" : ""}`}>
      <div className="upd-main">
        <span className={`sev ${f.chased ? "ok" : "bad"}`} aria-hidden />
        <div className="min-w-0 grow">
          <div className="todo-title">{f.name}</div>
          <div className="todo-detail">
            {plural(f.late, "late step")} on {f.orders.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link href={`/orders/${o.id}#tna`} className="link">{o.orderNo}</Link></span>)}
            {!f.hasPhone && " · no phone saved, WhatsApp will ask who to send to"}
          </div>
        </div>
        <div className="upd-acts">
          <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Message"}</button>
          <ChaseLink href={f.href} factoryId={f.factoryId} orderId={null} chased={f.chased} className="btn sm" />
        </div>
      </div>
      {open && <pre className="upd-msg">{f.text}</pre>}
    </li>
  );
}

function BuyerRow({ b }: { b: BuyerUpdate }) {
  const [text, setText] = useState(b.text);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it into WhatsApp or an email.");
      setSent(true);
    } catch {
      toast("Couldn't copy. Select the message and copy it.", "bad");
      setOpen(true);
    }
  };
  return (
    <li className={`upd-row ${sent ? "is-done" : ""}`}>
      <div className="upd-main">
        <span className={`sev ${sent ? "ok" : b.behind ? "warn" : ""}`} aria-hidden />
        <div className="min-w-0 grow">
          <div className="todo-title">{b.name}</div>
          <div className="todo-detail">{plural(b.orders, "open order")} · {plural(b.styles, "style")}{b.behind ? ` · ${b.behind} behind` : " · all on track"}</div>
        </div>
        <div className="upd-acts">
          <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Check"}</button>
          <button type="button" className="btn sm" onClick={copy}>Copy</button>
          <a className={`btn sm wa-link ${sent ? "is-done" : ""}`} href={waLink("", text)} target="_blank" rel="noreferrer" onClick={() => setSent(true)}>
            <WaIcon />{sent ? "Sent" : "Send"}
          </a>
        </div>
      </div>
      {open && (
        <label className="upd-edit">
          <span className="sr-only">Message to {b.name}</span>
          <textarea className="inp" rows={Math.min(18, text.split("\n").length + 1)} value={text} onChange={(e) => setText(e.target.value)} />
          <small>Change anything before sending. Factory names and rates are never in it.</small>
        </label>
      )}
    </li>
  );
}
