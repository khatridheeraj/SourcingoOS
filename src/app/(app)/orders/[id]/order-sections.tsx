"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export type SectionTab = { id: string; label: string; count?: number; tone?: string };

// The order's work areas. Only the chosen one shows, so the order reads like an app instead of one endless page;
// with no choice yet it opens where the order is now (the stage's own area, from the journey).
export function OrderSections({ tabs, start, children }: { tabs: SectionTab[]; start?: string; children: React.ReactNode }) {
  // The open section, kept apart from the address: saving anything on the order runs a server action, and Next
  // rewrites the address without its #section when the page refreshes. Without this, every save on a phone
  // jumped back to the first tab and the step just saved looked like it had vanished.
  const kept = useRef<string | null>(null);
  const subscribe = useCallback((fn: () => void) => {
    const on = () => { kept.current = window.location.hash.slice(1); fn(); };
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1) || (kept.current ?? ""), () => "");
  useEffect(() => { kept.current ??= window.location.hash.slice(1); }, []);
  // Put the section back in the address after a save, so a reload or a shared link opens the same tab.
  useEffect(() => {
    if (!window.location.hash && kept.current) window.history.replaceState(window.history.state, "", `#${kept.current}`);
  });
  // Links into a section (a style's QC, a style card) open the section they sit in.
  // Sections that now live inside another tab: the ship date sits with the details, the margin with dispatch.
  const ALIAS: Record<string, string> = { ship: "details", money: "dispatch" };
  const tab = tabs.find((t) => hash === t.id || hash.startsWith(`${t.id}-`) || ALIAS[hash] === t.id)?.id
    ?? (hash.startsWith("style-") || hash.startsWith("steps-") ? "tna" : tabs.find((t) => t.id === start)?.id ?? tabs[0].id);
  const box = useRef<HTMLDivElement>(null);
  // Arriving on a link into a section: its section only shows after loading, so bring the target into view then.
  useEffect(() => {
    const el = window.location.hash && document.getElementById(window.location.hash.slice(1));
    if (el && !tabs.some((t) => t.id === el.id)) el.scrollIntoView({ block: "start" });
  }, [tabs]);
  // A tab swaps the area in place and goes back to its top.
  function pick(e: React.MouseEvent, id: string) {
    e.preventDefault();
    window.history.pushState(null, "", `#${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    requestAnimationFrame(() => {
      const top = (box.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 112;
      if (window.scrollY > top) window.scrollTo({ top });
    });
  }

  return (
    <>
      <nav className="jump ws-tabs" aria-label="Parts of this order">
        {tabs.map((t) => (
          <a key={t.id} href={`#${t.id}`} onClick={(e) => pick(e, t.id)} aria-current={t.id === tab ? "true" : undefined}>
            {t.label}{!!t.count && <span className={`jump-n ${t.tone ?? ""}`}>{t.count}</span>}
          </a>
        ))}
      </nav>
      <style>{`.sections > [data-sec]:not([data-sec="${tab}"]) { display: none; }`}</style>
      <div className="sections" ref={box}>{children}</div>
    </>
  );
}
