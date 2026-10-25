"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/nav";

const KEY = "sourcingo:whats-new";
const VERSION = "2026-10-25-menu";

type Item = { icon: IconName; title: string; text: string };

// What changed for this person's work, shown once on Home until they close it. Remembered on this phone or computer only.
// Kept to three lines: Home is for today's work, not reading.
const NEXT: Item = { icon: "check", title: "Every order at a glance", text: "Each order opens with its days to ship, its value and the one next step. Tap a stage on its road to open that work." };
const DAY: Item = { icon: "home", title: "Your day", text: "Home starts with what needs you now, and its ring fills as you get things done today." };
// The menu went from 17 places to 10: pages that belong together now share one item and a tab row.
const MENU: Item = { icon: "more", title: "A shorter menu", text: "Buyer POs and Inquiries are now Buyer emails; Payments, Bills to pay and Tally are now Money. The brief is in Reports, chasing is a tab on Home." };
const MONEY: Item = { icon: "payments", title: "One Money page", text: "Payments, Bills to pay and Tally are now tabs on one Money page in the menu." };
const FOR: Record<string, Item[]> = {
  orders: [
    MENU,
    NEXT,
    { icon: "orders", title: "Orders as a board", text: "On a computer, Orders shows one column per stage. On a phone, each order shows its stage bar and next step." },
  ],
  quality: [
    NEXT,
    DAY,
    { icon: "check", title: "QC in four taps", text: "Tap Record QC on a Home row or an order: styles are already picked, tap Pass or Fail, take photos, save." },
  ],
  owner: [
    MENU,
    NEXT,
    { icon: "orders", title: "Orders as a board", text: "On a computer, Orders shows one column per stage, so POs waiting for your approval stand out." },
  ],
  accounts: [
    MONEY,
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
          <h2 id="new-h">A fresh, calmer Sourcingo</h2>
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
