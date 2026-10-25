"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type PageTab = { href: string; label: string; count?: number };

// Pages that are one place in the menu (Money, Buyer emails, Reports, Home) share a tab row on top,
// so each keeps its own address and nothing moves except where it is found.
export function PageTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const path = usePathname();
  if (tabs.length < 2) return null;
  return (
    <nav className="seg page-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          {t.label}{!!t.count && <span>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
