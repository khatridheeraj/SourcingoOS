"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE_NAV } from "@/lib/site";

// The phone menu: one button opens the site's pages; it closes on a tap, on Escape and when the page changes.
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button type="button" className="site-burger" aria-expanded={open} aria-controls="site-drawer" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          {open ? <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
        </svg>
      </button>
      {open && (
        <div id="site-drawer" className="site-drawer" onClick={() => setOpen(false)}>
          <nav aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            {SITE_NAV.map((n) => <Link key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</Link>)}
            <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
            <Link href="/costing" className="site-btn" onClick={() => setOpen(false)}>Request a costing</Link>
          </nav>
        </div>
      )}
    </>
  );
}
