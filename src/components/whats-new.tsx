"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/nav";

const KEY = "sourcingo:whats-new";
const VERSION = "2026-10-26-calm";

type Item = { icon: IconName; title: string; text: string };

// What changed for this person's work, shown once on Home until they close it. Remembered on this phone or computer only.
// Kept to three lines: Home is for today's work, not reading.
const HOME: Item = { icon: "home", title: "Home is one short list", text: "Everything an order needs sits together under its name, with a small button for each job. What used to take six screens fits in two." };
const RED: Item = { icon: "clock", title: "Red means really late", text: "A step past its target shows amber while the ship date still holds; red is kept for orders that will miss it." };
const STYLES: Item = { icon: "check", title: "Faster style updates", text: "On an order, each style shows its step done today and all its steps side by side, in one row." };
const MONEY: Item = { icon: "payments", title: "Money first", text: "Money to collect and bills to pay lead Home, and each line says how late it is." };
const FOR: Record<string, Item[]> = {
  orders: [HOME, RED, STYLES],
  quality: [HOME, RED, { icon: "check", title: "QC in four taps", text: "Tap Record QC on a Home row or an order: styles are already picked, tap Pass or Fail, take photos, save." }],
  owner: [HOME, RED, STYLES],
  accounts: [MONEY, HOME],
};

const read = () => { try { return localStorage.getItem(KEY); } catch { return VERSION; } };

export function WhatsNew({ role }: { role: string }) {
  const items = FOR[role === "owner" || role === "accounts" ? role : role === "quality" ? "quality" : role === "merchandiser" || role === "manager" ? "orders" : ""];
  const seen = useSyncExternalStore(() => () => {}, read, () => VERSION);
  const [closed, setClosed] = useState(false);
  if (closed || seen === VERSION || !items) return null;
  const close = () => { try { localStorage.setItem(KEY, VERSION); } catch { /* still closes for now */ } setClosed(true); };
  // One line, closed: Home is for today's work, so the news waits until someone opens it.
  return (
    <details className="wn">
      <summary>
        <span className="wn-dot" aria-hidden />
        <b>What&apos;s new in Sourcingo</b>
        <span className="link">See</span>
        <button type="button" className="btn sm" onClick={(e) => { e.preventDefault(); close(); }}>Got it</button>
      </summary>
      <ul>
        {items.map((it) => (
          <li key={it.title}>
            <span className="wn-ic" aria-hidden><Icon name={it.icon} size={16} /></span>
            <div><b>{it.title}</b><p>{it.text}</p></div>
          </li>
        ))}
      </ul>
    </details>
  );
}
