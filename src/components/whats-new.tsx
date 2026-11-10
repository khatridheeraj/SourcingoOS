"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/nav";

const KEY = "sourcingo:whats-new";
const VERSION = "2026-11-10-notes";

type Item = { icon: IconName; title: string; text: string };

// What changed for this person's work, shown once on Home until they close it. Remembered on this phone or computer only.
// Kept to three lines: Home is for today's work, not reading.
// Quality owns the updates from the factory floor (26 Oct 2026).
const FLOOR: Item = { icon: "factories", title: "Live from the factory floor", text: "Quality visits the factories and posts every style's step with photos. See it on each order under Styles, and on Home." };
// Team notes and the calendar (10 Nov 2026).
const NOTES: Item = { icon: "notes", title: "Talk on the order, not WhatsApp", text: "Every order has Notes. Write what happened, tag a colleague with @ and their name, add photos. It shows on their Home until they reply." };
const CAL: Item = { icon: "clock", title: "Calendar", text: "Home > Calendar shows what falls on each coming day: ship dates, inspections, samples, factory plans, and bills and cheques for money people." };
const MONEY: Item = { icon: "payments", title: "Money first", text: "Money to collect and bills to pay lead Home, and each line says how late it is." };
const FOR: Record<string, Item[]> = {
  orders: [NOTES, CAL, FLOOR],
  quality: [
    NOTES,
    { icon: "factories", title: "Factory visits", text: "Home lists the factories to visit, late steps first. Tap Start visit, then post each style's step: done, on track, late or a problem, with photos." },
    CAL,
  ],
  owner: [NOTES, CAL, FLOOR],
  accounts: [NOTES, CAL, MONEY],
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
