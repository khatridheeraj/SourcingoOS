"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  const on = (href: string) => (href === "/" ? path === "/" || path.startsWith("/orders") : path.startsWith(href));
  return (
    <nav className="tabs" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={on(i.href) ? "page" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
