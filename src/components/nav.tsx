"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { openHelp } from "@/components/help/help-chat";

export type IconName = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: IconName; count?: number };
export type NavGroup = { label?: string; items: NavItem[] };

// Line icons drawn on a 20px grid, so every menu row has the same weight.
const ICONS = {
  home: "M3.5 8.5 10 3.5l6.5 5V16a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1V8.5Z",
  orders: "M5 3.5h10a1 1 0 0 1 1 1v12l-2.5-1.5-2 1.5-1.5-1.2L8.5 16.5l-2-1.5L4 16.5v-12a1 1 0 0 1 1-1ZM7 7.5h6M7 10.5h6",
  inbox: "M3.5 11.5 5.6 4.6a1.5 1.5 0 0 1 1.4-1.1h6a1.5 1.5 0 0 1 1.4 1.1l2.1 6.9V15a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3.5 15v-3.5Zm0 0h4l1 2h3l1-2h4",
  buyers: "M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-4.5 7.5a4.5 4.5 0 0 1 9 0M13 3.2a3 3 0 0 1 0 5.6m1.5 2.4a4.5 4.5 0 0 1 2.5 4.3",
  factories: "M3 16.5V8l4 2.5V8l4 2.5V8l4 2.5V4h2v12.5H3Zm3-3h1.5m2.5 0h1.5m2.5 0h1.5",
  payments: "M3 5.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm-1 3.5h16M5 12.5h3",
  tally: "M4 16.5V10m4 6.5V6m4 10.5V8.5m4 8V3.5",
  team: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.5 7a5.5 5.5 0 0 1 11 0",
  activity: "M2.5 10h3l2-5 3 10 2-5h5",
  markers: "M3.5 4.5h13v11h-13zM3.5 8.5h13M8 8.5v7M12 4.5v4",
  plus: "M10 4v12M4 10h12",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm4.5-1.5L17 17",
  clock: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 6v4l2.5 2.5",
  check: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm-3.2-7.4 2.3 2.3 4.2-4.6",
  share: "M10 3v10m0-10L6.5 6.5M10 3l3.5 3.5M5 10H4.5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H15",
  more: "M4 4.5h4.5V9H4zM11.5 4.5H16V9h-4.5zM4 11.5h4.5V16H4zM11.5 11.5H16V16h-4.5z",
  sun: "M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10 2v1.5m0 13V18m8-8h-1.5M3.5 10H2m13.66-5.66-1.06 1.06M5.4 14.6l-1.06 1.06m11.32 0L14.6 14.6M5.4 5.4 4.34 4.34",
  help: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM7.9 7.6a2.2 2.2 0 0 1 4.25.8c0 1.5-2.15 1.9-2.15 3.1M10 14.2v.05",
  notes: "M4.5 4.5h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 3v-3h-1a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1ZM7 8h6M7 11h4",
  styles: "M7 3.5 3.5 6l1.8 3 1.7-1v8.5h6V8l1.7 1 1.8-3L13 3.5c-.4 1.2-1.6 2-3 2s-2.6-.8-3-2Z",
  chart: "M3.5 16.5h13M6 13.5v-4M10 13.5V5M14 13.5V8",
  box: "M10 2.8 16.5 6v8L10 17.2 3.5 14V6L10 2.8Zm0 0v0M3.5 6 10 9.3 16.5 6M10 9.3v7.9",
  inquiry: "M4.5 4h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H10l-3.5 3v-3h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3.4 3.2a2.1 2.1 0 0 1 4.1.6c0 1.4-2 1.6-2 2.8M10 11.6v.05",
  bills: "M5.5 2.5h9a1 1 0 0 1 1 1v14l-2-1.3-2 1.3-1.5-1.3-1.5 1.3-2-1.3-2 1.3v-14a1 1 0 0 1 1-1ZM7.5 6.5h5M7.5 9.5h5M7.5 12.5h3",
  link: "M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24L10 5.76m1.5 2.74a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24L10 14.24",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

// The app's side menu. On a phone it becomes a tab bar along the bottom, like a native app,
// with everything else in a sheet under More.
// Help sits in the top bar on a phone and above the account on a computer; its dot counts replies not yet read.
export function Sidebar({ groups, user, role, company, helpUnseen = 0 }: { groups: NavGroup[]; user: string; role: string; company: string; helpUnseen?: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const on = (href: string) => (href === "/" ? path === "/" || path.startsWith("/orders") : path.startsWith(href));
  const initials = user.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  // The bottom bar holds the main screens; the rest sit in More.
  const tabs = groups[0]?.items.slice(0, 4) ?? [];
  const inMore = groups.flatMap((g) => g.items).some((it) => !tabs.includes(it) && on(it.href));

  return (
    <>
      <header className="topbar">
        <Link href="/today" className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo</Link>
        <div className="top-acts">
          <button type="button" className="help-btn" aria-label={helpUnseen ? `Help, ${helpUnseen} new ${helpUnseen === 1 ? "reply" : "replies"}` : "Help"} onClick={() => openHelp(helpUnseen ? "notes" : "ask")}>
            <Icon name="help" size={22} />{helpUnseen > 0 && <span className="tab-badge">{helpUnseen}</span>}
          </button>
          <button type="button" className="avatar-btn" aria-label="Account and menu" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
            <span className="avatar" aria-hidden>{initials}</span>
          </button>
        </div>
      </header>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((it) => (
          <Link key={it.href} href={it.href} onClick={() => setOpen(false)} aria-current={on(it.href) && !open ? "page" : undefined}>
            <span className="tab-ic"><Icon name={it.icon} size={22} />{!!it.count && <span className="tab-badge">{it.count}</span>}</span>
            {it.label === "Incoming POs" ? "POs" : it.label}
          </Link>
        ))}
        <button type="button" aria-expanded={open} aria-controls="sidebar" aria-current={open || inMore ? "page" : undefined} onClick={() => setOpen(!open)}>
          <span className="tab-ic"><Icon name="more" size={22} /></span>
          More
        </button>
      </nav>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="sidebar" className="sidebar" data-open={open || undefined}>
        <span className="grabber" aria-hidden />
        <Link href="/today" className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>OS</small></Link>
        <nav aria-label="All screens" className="side-nav">
          {groups.map((g, i) => (
            <div key={g.label ?? i} className="side-group">
              {g.label && <div className="side-label">{g.label}</div>}
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} onClick={() => setOpen(false)} aria-current={on(it.href) ? "page" : undefined}>
                  <Icon name={it.icon} />
                  <span className="grow">{it.label}</span>
                  {!!it.count && <span className="side-count">{it.count}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="side-help hide-phone" onClick={() => openHelp(helpUnseen ? "notes" : "ask")}>
          <Icon name="help" /><span className="grow text-left">Help and ideas</span>
          {helpUnseen > 0 && <span className="side-count">{helpUnseen}</span>}
        </button>
        <div className="side-user">
          <span className="avatar" aria-hidden>{initials}</span>
          <div className="min-w-0 grow">
            <div className="truncate font-medium text-foreground">{user}</div>
            <div className="truncate">{role}{company && ` · ${company}`}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="side-out" title="Sign out" aria-label="Sign out">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3m4.5-9.5L16 10l-3.5 3.5M16 10H8" />
              </svg>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
