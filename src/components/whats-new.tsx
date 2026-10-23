"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/nav";

const KEY = "sourcingo:whats-new";
const VERSION = "2026-10-24";

type Item = { icon: IconName; title: string; text: string };

// What changed for this person's work, shown once on Home until they close it. Remembered on this phone or computer only.
// Kept to three lines: Home is for today's work, not reading.
const NEXT: Item = { icon: "check", title: "Every order shows its next step", text: "Open any order: a road from Factory to Ship shows where it is, with one button for what to do next." };
const FOR: Record<string, Item[]> = {
  orders: [
    NEXT,
    { icon: "orders", title: "Orders by stage", text: "The top of Orders counts orders at each stage. Tap one to see just those." },
    { icon: "plus", title: "New, in one place", text: "The + New button starts an order, an inquiry or a buyer PO." },
  ],
  quality: [
    NEXT,
    { icon: "check", title: "QC in four taps", text: "Tap Record QC on a Home row or an order: styles are already picked, tap Pass or Fail, take photos, save." },
  ],
  owner: [
    NEXT,
    { icon: "orders", title: "Orders by stage", text: "The top of Orders counts orders at each stage, including POs waiting for your approval." },
    { icon: "plus", title: "New, in one place", text: "The + New button starts an order, an inquiry, a buyer PO, a cheque or an invoice." },
  ],
  accounts: [
    NEXT,
    { icon: "plus", title: "New, in one place", text: "The + New button adds a cheque or an invoice from any screen." },
  ],
};

const read = () => { try { return localStorage.getItem(KEY); } catch { return VERSION; } };

export function WhatsNew({ role }: { role: string }) {
  const items = FOR[role === "owner" || role === "accounts" ? role : role === "quality" ? "quality" : role === "merchandiser" || role === "manager" ? "orders" : ""];
  const seen = useSyncExternalStore(() => () => {}, read, () => VERSION);
  const [closed, setClosed] = useState(false);
  if (closed || seen === VERSION || !items) return null;
  const close = () => { try { localStorage.setItem(KEY, VERSION); } catch { /* still closes for now */ } setClosed(true); };
  return (
    <section className="card whats-new" aria-labelledby="new-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="new-h">Easier to find your way</h2>
          <p>What changed today.</p>
        </div>
        <button type="button" className="btn sm" onClick={close}>Got it</button>
      </header>
      <ul>
        {items.map((it) => (
          <li key={it.title}>
            <span className="wn-ic" aria-hidden><Icon name={it.icon} size={18} /></span>
            <div><b>{it.title}</b><p>{it.text}</p></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
