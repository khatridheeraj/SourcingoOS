"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PageTab } from "@/components/page-tabs";

// My orders and Shop orders. A style page inside the shop keeps Shop orders lit.
export function FactoryTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const path = usePathname();
  const at = [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(`${t.href}/`))?.href;
  return (
    <nav className="seg page-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={at === t.href ? "page" : undefined}>
          {t.label}{!!t.count && <span>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
