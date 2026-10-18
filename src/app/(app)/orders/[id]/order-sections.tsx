"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

export type SectionTab = { id: string; label: string; count?: number; tone?: string };

const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  window.addEventListener("popstate", fn);
  return () => {
    window.removeEventListener("hashchange", fn);
    window.removeEventListener("popstate", fn);
  };
};

// The order's sections. On a computer they sit one under another and the tabs jump between them;
// on a phone only the chosen section shows, so the order reads like an app instead of one endless page.
export function OrderSections({ tabs, children }: { tabs: SectionTab[]; children: React.ReactNode }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => "");
  // Links into a section (a style's QC, a style card) open the section they sit in.
  const tab = tabs.find((t) => hash === t.id || hash.startsWith(`${t.id}-`))?.id
    ?? (hash.startsWith("style-") || hash.startsWith("steps-") ? "tna" : tabs[0].id);
  const box = useRef<HTMLDivElement>(null);
  const phone = () => window.matchMedia("(max-width: 760px)").matches;
  // Arriving on a link into a section: its section only shows after loading, so bring the target into view then.
  useEffect(() => {
    const el = window.location.hash && document.getElementById(window.location.hash.slice(1));
    if (el && phone()) el.scrollIntoView({ block: "start" });
  }, []);
  // On a phone a tab swaps the section in place and goes back to its top.
  function pick(e: React.MouseEvent, id: string) {
    if (!phone()) return;
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
      <nav className="jump" aria-label="Sections of this order">
        {tabs.map((t) => (
          <a key={t.id} href={`#${t.id}`} onClick={(e) => pick(e, t.id)} aria-current={t.id === tab ? "true" : undefined}>
            {t.label}{!!t.count && <span className={`jump-n ${t.tone ?? ""}`}>{t.count}</span>}
          </a>
        ))}
      </nav>
      <style>{`@media (max-width: 760px) { .sections > [data-sec]:not([data-sec="${tab}"]) { display: none; } }`}</style>
      <div className="sections" ref={box}>{children}</div>
    </>
  );
}
