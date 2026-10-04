"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchIndex, type SearchItem } from "@/app/(app)/search";
import { Feedback } from "@/components/feedback";
import { Bell, FeedbackButton } from "@/components/shell-extras";
import type { NavGroup, QuickAction } from "@/lib/nav";

export function Shell({ nav, badges, who, actions, unread, children }: {
  nav: NavGroup[]; badges: Record<string, { n: number; hot: boolean }>; who: string; actions: QuickAction[]; unread: number; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // The most specific menu item wins (Scorecards, not Reports, on /reports/scorecards).
  const current = nav.flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === current;

  return (
    <Feedback>
      <div className="grid min-h-full lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col gap-3.5 overflow-y-auto border-r border-line bg-surface px-2.5 pb-6 pt-3.5 transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-[105%]"}`}
          aria-label="Modules"
        >
          <Link href="/" className="flex items-baseline gap-2 px-2" onClick={() => setOpen(false)}>
            <b className="font-display text-xl tracking-tight">Sourcingo</b>
            <span className="text-[10.5px] uppercase tracking-widest text-muted">OS</span>
          </Link>
          <nav className="flex flex-col gap-2.5">
            {nav.map((g) => (
              <div key={g.title || "top"} className="flex flex-col gap-px">
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
                      className={`flex items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-[13.5px] font-semibold ${on ? "bg-foreground text-background" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
                    >
                      {i.label}
                      {b && b.n > 0 && (
                        <span className={`ml-auto rounded-full px-[7px] font-mono text-[11px] ${b.hot ? "bg-bad text-white" : on ? "bg-white/20" : "bg-surface-2 text-muted"}`}>{b.n}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-1.5 px-2.5 text-xs text-muted">
            <span>{who}</span>
            <Link href="/settings" className="font-semibold text-accent" onClick={() => setOpen(false)}>My settings</Link>
            <form action="/auth/signout" method="post">
              <button className="font-semibold text-accent">Sign out</button>
            </form>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-[39] bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-background px-4 py-3">
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="btn icon lg:hidden">☰</button>
            <CommandSearch nav={nav} actions={actions} />
            <span className="hidden whitespace-nowrap text-[12.5px] text-muted lg:inline">{who}</span>
            <Bell unread={unread} />
            {actions.length > 0 && <PlusMenu actions={actions} />}
          </header>
          <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-[18px] px-4 pb-[72px] pt-5">{children}</main>
        </div>
        <FeedbackButton />
      </div>
    </Feedback>
  );
}

function PlusMenu({ actions }: { actions: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Create new"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-[38px] w-[38px] rounded-[10px] bg-foreground text-[22px] leading-none text-background"
      >
        +
      </button>
      {open && (
        <div className="results" style={{ left: "auto", width: 230 }}>
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className="res" onClick={() => setOpen(false)}>
              <span className="k" style={{ width: 22 }}>{a.icon}</span>
              <span>{a.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandSearch({ nav, actions }: { nav: NavGroup[]; actions: QuickAction[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [index, setIndex] = useState<SearchItem[] | null>(null);
  const loading = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const load = () => {
    if (index || loading.current) return;
    loading.current = true;
    searchIndex().then(setIndex).catch(() => setIndex([])).finally(() => (loading.current = false));
  };

  const items = useMemo(() => {
    const base: SearchItem[] = [
      ...actions.map((a) => ({ k: "Action", l: a.label, s: a.sub, href: a.href, hay: a.label })),
      ...nav.flatMap((g) => g.items.map((i) => ({ k: "Page", l: i.label, s: g.title, href: i.href, hay: i.label + " " + g.title }))),
    ];
    const t = q.trim().toLowerCase();
    if (!t) return base;
    const words = t.split(/\s+/);
    return [...base, ...(index ?? [])].filter((x) => words.every((w) => (x.l + " " + x.s + " " + x.hay).toLowerCase().includes(w))).slice(0, 40);
  }, [q, index, nav, actions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))) {
        e.preventDefault();
        box.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (x: SearchItem) => {
    setOpen(false);
    setQ("");
    router.push(x.href);
  };

  return (
    <div className="relative max-w-[560px] flex-1" ref={box} onBlur={(e) => !box.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={q}
        placeholder="Search page, order, style or action"
        aria-label="Search"
        autoComplete="off"
        className="w-full rounded-full border border-line bg-surface py-[9px] pl-9 pr-3.5"
        onFocus={() => { load(); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          else if (e.key === "Enter" && items[sel]) { e.preventDefault(); go(items[sel]); }
          else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {open && (
        <div className="results" role="listbox">
          {items.length ? (
            items.map((x, i) => (
              <button key={x.k + x.href + x.l} type="button" role="option" aria-selected={i === sel} className={`res ${i === sel ? "sel" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => go(x)}>
                <span className="k">{x.k}</span>
                <span>{x.l}</span>
                {x.s && <small>{x.s}</small>}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-2 text-muted">{index ? "Nothing matches." : "Searching…"}</p>
          )}
        </div>
      )}
    </div>
  );
}
