"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/nav";

const KEY = "sourcingo:whats-new";
const VERSION = "2026-10-22";

type Item = { icon: IconName; title: string; text: string };

// What changed for this person's work, shown once on Home until they close it. Remembered on this phone or computer only.
const FOR: Record<string, Item[]> = {
  orders: [
    { icon: "check", title: "Update in one tap", text: "Tap Update on any Home row: tick the styles and the step is done. Catch up marks every earlier step in one go." },
    { icon: "plus", title: "Start production in one go", text: "The plan fills itself from the ship date. Say the factory agreed, and it goes for the lock." },
    { icon: "share", title: "Chase and buyer updates, written for you", text: "Chase sends the factory every late step on WhatsApp. Updates has a ready message for each buyer." },
    { icon: "search", title: "Find anything", text: "The search at the top finds any order, PO, style, buyer or factory." },
  ],
  quality: [
    { icon: "check", title: "QC in four taps", text: "Tap Record QC on a Home row: styles are already picked, tap Pass or Fail, take photos, save. A whole shipment saves at once." },
    { icon: "search", title: "Find anything", text: "The search at the top finds any order, PO or style." },
  ],
  owner: [
    { icon: "check", title: "Lock plans from Home", text: "Plans sent for your lock are at the top of Home. Check and lock in one sheet." },
    { icon: "share", title: "Factories chased, buyers updated", text: "Updates shows every factory behind plan and a ready message for each buyer." },
    { icon: "search", title: "Find anything", text: "Press Ctrl K (or tap the search icon) to jump to any order, PO, style, buyer or factory." },
  ],
};

const read = () => { try { return localStorage.getItem(KEY); } catch { return VERSION; } };

export function WhatsNew({ role }: { role: string }) {
  const items = FOR[role === "owner" ? "owner" : role === "quality" ? "quality" : role === "merchandiser" || role === "manager" ? "orders" : ""];
  const seen = useSyncExternalStore(() => () => {}, read, () => VERSION);
  const [closed, setClosed] = useState(false);
  if (closed || seen === VERSION || !items) return null;
  const close = () => { try { localStorage.setItem(KEY, VERSION); } catch { /* still closes for now */ } setClosed(true); };
  return (
    <section className="card whats-new" aria-labelledby="new-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="new-h">New: less typing, more done</h2>
          <p>Your daily work now takes a few taps.</p>
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
