"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavGroup } from "@/lib/nav";

export function Shell({ nav, badges, who, children }: {
  nav: NavGroup[]; badges: Record<string, { n: number; hot: boolean }>; who: string; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : href === "/tna" ? path === "/tna" : path === href || path.startsWith(href + "/"));

  return (
    <div className="grid min-h-full lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-2.5 pb-6 pt-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Modules"
      >
        <Link href="/" className="flex items-baseline gap-2 px-2" onClick={() => setOpen(false)}>
          <b className="font-display text-xl tracking-tight">Sourcingo</b>
          <span className="text-[10.5px] uppercase tracking-widest text-muted">OS</span>
        </Link>
        <nav className="flex flex-col gap-2.5">
          {nav.map((g) => (
            <div key={g.title} className="flex flex-col gap-px">
              {g.title && <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-widest text-muted">{g.title}</div>}
              {g.items.map((i) => {
                const b = i.badge ? badges[i.badge] : undefined;
                const on = active(i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold ${on ? "bg-foreground text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
                  >
                    {i.label}
                    {b && b.n > 0 && (
                      <span className={`ml-auto rounded-full px-1.5 font-mono text-[11px] ${b.hot ? "bg-bad text-white" : on ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{b.n}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-2.5 text-xs text-muted">
          <span>{who}</span>
          <form action="/auth/signout" method="post">
            <button className="font-semibold text-accent">Sign out</button>
          </form>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-background px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg border border-line px-2.5 py-1 text-sm">☰</button>
          <b className="font-display">Sourcingo</b>
        </header>
        <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pb-20 pt-6">{children}</main>
      </div>
    </div>
  );
}
