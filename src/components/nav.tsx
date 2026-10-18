"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number };
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
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

// The app's side menu. On a phone it folds into a top bar with a menu button.
export function Sidebar({ groups, user, role, company }: { groups: NavGroup[]; user: string; role: string; company: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const on = (href: string) => (href === "/" ? path === "/" || path.startsWith("/orders") : path.startsWith(href));
  const initials = user.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  return (
    <>
      <header className="topbar">
        <Link href="/today" className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo</Link>
        <button type="button" className="menu-btn" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d={open ? "M5 5l10 10M15 5 5 15" : "M3.5 6h13M3.5 10h13M3.5 14h13"} />
          </svg>
          <span className="sr-only">Menu</span>
        </button>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="sidebar" className="sidebar" data-open={open || undefined}>
        <Link href="/today" className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>OS</small></Link>
        <nav aria-label="Main" className="side-nav">
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
