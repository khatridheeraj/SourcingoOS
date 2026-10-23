"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchAll, type Hit } from "@/app/(app)/search-actions";
import { Icon, type IconName, type NavGroup } from "@/components/nav";

const EVENT = "sourcingo:search";
export const openSearch = () => window.dispatchEvent(new Event(EVENT));

const KIND: Record<Hit["kind"], { label: string; icon: IconName }> = {
  order: { label: "Orders", icon: "orders" },
  style: { label: "Styles", icon: "styles" },
  buyer: { label: "Buyers", icon: "buyers" },
  factory: { label: "Factories", icon: "factories" },
  inquiry: { label: "Inquiries", icon: "inquiry" },
  po: { label: "Buyer POs", icon: "inbox" },
};

// Search from anywhere: ⌘K or Ctrl+K, "/", or the search button. With nothing typed it lists the screens to jump to.
export function SearchPalette({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const box = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const open = () => {
      seq.current++; setQ(""); setHits([]); setSel(0); setError(""); setBusy(false);
      if (!box.current?.open) box.current?.showModal();
      requestAnimationFrame(() => input.current?.focus());
    };
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing && !document.querySelector("dialog[open]"))) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener(EVENT, open);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener(EVENT, open); window.removeEventListener("keydown", key); };
  }, []);

  // Searches as you type, a moment after the last key; an older answer never replaces a newer one.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const type = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    const term = v.trim();
    const n = ++seq.current;
    if (!term) { setHits([]); setBusy(false); setSel(0); return; }
    setBusy(true);
    timer.current = setTimeout(() => {
      searchAll(term)
        .then((r) => { if (n === seq.current) { setHits(r.hits); setError(r.error ?? ""); setSel(0); } })
        .catch(() => { if (n === seq.current) setError("Search couldn't load. Check the connection."); })
        .finally(() => { if (n === seq.current) setBusy(false); });
    }, 160);
  };

  const jump = groups.flatMap((g) => g.items).map((it): Hit & { icon: IconName } => ({ kind: "order", href: it.href, title: it.label, sub: "", icon: it.icon }));
  const term = q.trim();
  const list: (Hit & { icon?: IconName })[] = term ? hits : jump;
  const close = () => box.current?.close();
  const go = (h: Hit) => { close(); router.push(h.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && list[sel]) { e.preventDefault(); go(list[sel]); }
  };
  useEffect(() => { box.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  return (
    <dialog ref={box} className="sheet sp" aria-label="Search" onClick={(e) => { if (e.target === box.current) close(); }}>
      <div className="sp-bar">
        <Icon name="search" size={20} />
        <input ref={input} className="sp-input" type="search" value={q} onChange={(e) => type(e.target.value)} onKeyDown={onKey}
          placeholder="Order, PO, style, buyer, factory…" aria-label="Search everything" enterKeyHint="go" autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded aria-controls="sp-list" aria-activedescendant={list[sel] ? `sp-${sel}` : undefined} />
        {busy && <span className="sp-spin" aria-hidden />}
        <button type="button" className="sp-cancel" onClick={close}>Cancel</button>
      </div>
      <div className="sp-list" id="sp-list" role="listbox" aria-label={term ? "Results" : "Jump to"}>
        {!term && <div className="sp-group">Jump to</div>}
        {list.map((h, i) => {
          const head = term && h.kind !== list[i - 1]?.kind ? KIND[h.kind].label : "";
          return (
            <div key={`${h.kind}:${h.href}:${i}`}>
              {head && <div className="sp-group">{head}</div>}
              <button type="button" id={`sp-${i}`} data-i={i} role="option" aria-selected={i === sel} className="sp-row" onMouseMove={() => setSel(i)} onClick={() => go(h)}>
                <span className="sp-ic"><Icon name={h.icon ?? KIND[h.kind].icon} /></span>
                <span className="sp-txt">
                  <span className="sp-title">{h.code && <span className="code">{h.code}</span>}{h.title}</span>
                  {(h.sub || h.state) && <span className="sp-sub">{h.state && <span className={h.tone ?? ""}>{h.state}</span>}{h.state && h.sub && " · "}{h.sub}</span>}
                </span>
                <span className="sp-enter" aria-hidden>↵</span>
              </button>
            </div>
          );
        })}
        {term && !busy && !hits.length && (
          <div className="sp-empty">
            <b>{error || `Nothing matches “${term}”`}</b>
            {!error && <span>Try an order number, a buyer PO, a style or a factory name.</span>}
          </div>
        )}
      </div>
      <div className="sp-foot hide-phone"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></div>
    </dialog>
  );
}

// A shortcut tile or button that opens the search.
export function SearchTile({ className, children }: { className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={openSearch}>{children}</button>;
}
