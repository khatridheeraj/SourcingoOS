"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type PageTab = { href: string; label: string; count?: number };

// Pages that are one place in the menu (Money, Buyer emails, Reports, Home) share a tab row on top,
// so each keeps its own address and nothing moves except where it is found.
export function PageTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const path = usePathname();
  if (tabs.length < 2) return null;
  // A page inside a tab (Bills to pay > Calendar, a buyer statement) keeps its tab marked: the longest tab address it starts with.
  const inside = (h: string) => path === h || (h !== "/" && path.startsWith(h + "/"));
  const current = tabs.filter((t) => inside(t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="seg page-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          {t.label}{!!t.count && <span>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
