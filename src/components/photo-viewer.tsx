"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
  One photo viewer for the whole app, the buyer and factory pages and the website.
  Tapping a photo opens it here, on the same page, instead of a new tab. Nothing on a screen has to call it:
  a plain click on a link to a picture (a link wrapping its own thumbnail, or a link to a .jpg/.png/... file) or on an
  <img data-zoom> opens the viewer, and every such photo in the same group comes along to swipe through.
    - The group is the nearest [data-photos] box; without one, the nearest few parents that hold more than one photo.
    - The caption is data-caption, else aria-label, else the image's alt.
    - data-no-zoom on a link (or a parent) keeps the old behaviour.
  Ctrl/Cmd/Shift/middle click still opens the photo in a new tab, and "Open original" in the viewer does too, for downloads.
  It is a modal <dialog>, so it sits above any open sheet, Escape closes it, and on a phone Back closes it (sheet-back.tsx).
*/

type Photo = { src: string; href: string; caption: string };
type Open = { photos: Photo[]; at: number; hi: boolean };

const SEL = "a[href], img[data-zoom]";
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;
const MAX = 5;

const WORDS = {
  en: { close: "Close", prev: "Previous photo", next: "Next photo", original: "Open original", of: (i: number, n: number) => `${i} of ${n}`, failed: "This photo didn't load.", label: "Photo" },
  hi: { close: "बंद करें", prev: "पिछली फोटो", next: "अगली फोटो", original: "असली फोटो खोलें", of: (i: number, n: number) => `${i} / ${n}`, failed: "यह फोटो नहीं खुली।", label: "फोटो" },
};

function captionOf(el: Element, img: HTMLImageElement | null) {
  return (el.getAttribute("data-caption") || el.getAttribute("aria-label") || img?.getAttribute("alt") || "").trim();
}

function photoOf(el: Element): Photo | null {
  if (el.closest("[data-no-zoom]")) return null;
  if (el instanceof HTMLAnchorElement) {
    if (!el.href || el.hasAttribute("download")) return null;
    const img = el.querySelector("img");
    let isPhoto = el.hasAttribute("data-zoom") || (!!img && (img.currentSrc === el.href || img.src === el.href));
    if (!isPhoto) {
      try { isPhoto = IMAGE_FILE.test(decodeURIComponent(new URL(el.href).pathname)); } catch { isPhoto = false; }
    }
    return isPhoto ? { src: el.getAttribute("data-zoom") || el.href, href: el.href, caption: captionOf(el, img) } : null;
  }
  if (el instanceof HTMLImageElement && el.hasAttribute("data-zoom")) {
    const src = el.getAttribute("data-zoom") || el.currentSrc || el.src;
    return src ? { src, href: src, caption: captionOf(el, el) } : null;
  }
  return null;
}

function groupOf(el: Element): Element[] {
  const all = (root: Element) => [...root.querySelectorAll(SEL)].filter((x) => photoOf(x));
  const box = el.closest("[data-photos]");
  if (box) return all(box);
  let root = el.parentElement;
  for (let i = 0; root && i < 3; i++, root = root.parentElement) {
    const list = all(root);
    if (list.length > 1) return list;
  }
  return [el];
}

type View = { s: number; x: number; y: number };
const REST: View = { s: 1, x: 0, y: 0 };

export function PhotoViewer() {
  const [open, setOpen] = useState<Open | null>(null);
  const [view, setView] = useState<View>(REST);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const [moving, setMoving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);

  // Every photo shown starts unzoomed.
  const fresh = useCallback(() => { setView(REST); viewRef.current = REST; setDrag({ x: 0, y: 0 }); setState("loading"); }, []);

  // Opening: any plain click on a photo anywhere on the page.
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target.closest(SEL) : null;
      if (!el || dialog.current?.contains(el)) return;
      const first = photoOf(el);
      if (!first) return;
      e.preventDefault();
      const photos: Photo[] = [];
      let at = 0;
      for (const x of groupOf(el)) {
        const p = x === el ? first : photoOf(x);
        if (!p) continue;
        const seen = photos.findIndex((q) => q.src === p.src);
        if (x === el) at = seen >= 0 ? seen : photos.length;
        if (seen < 0) photos.push(p);
      }
      if (!photos.length) photos.push(first);
      opener.current = el as HTMLElement;
      fresh();
      setOpen({ photos, at: Math.min(at, photos.length - 1), hi: el.closest("[lang]")?.getAttribute("lang")?.startsWith("hi") ?? false });
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, [fresh]);

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  const photo = open?.photos[open.at];
  const n = open?.photos.length ?? 0;

  // The photos either side load in the background so a swipe is instant.
  useEffect(() => {
    if (!open) return;
    for (const k of [open.at - 1, open.at + 1]) {
      const p = open.photos[(k + n) % n];
      if (p && p !== photo) new Image().src = p.src;
    }
  }, [open, photo, n]);

  const close = useCallback(() => dialog.current?.close(), []);
  const go = useCallback((by: number) => {
    if (n < 2) return;
    fresh();
    setOpen((o) => (o ? { ...o, at: (o.at + by + o.photos.length) % o.photos.length } : o));
  }, [n, fresh]);

  // Keeps a zoomed photo from being dragged off the screen.
  const clamp = useCallback((v: View): View => {
    const st = stage.current, im = img.current;
    if (!st || !im || v.s <= 1) return { s: Math.max(1, v.s), x: 0, y: 0 };
    const lx = Math.max(0, (im.offsetWidth * v.s - st.clientWidth) / 2);
    const ly = Math.max(0, (im.offsetHeight * v.s - st.clientHeight) / 2);
    return { s: v.s, x: Math.min(lx, Math.max(-lx, v.x)), y: Math.min(ly, Math.max(-ly, v.y)) };
  }, []);

  // Zoom to s with the point p (relative to the middle of the screen) staying where it is.
  const zoomAt = useCallback((s: number, p: { x: number; y: number }, from = viewRef.current) => {
    const ns = Math.min(MAX, Math.max(1, s));
    setView(clamp({ s: ns, x: p.x - (ns * (p.x - from.x)) / from.s, y: p.y - (ns * (p.y - from.y)) / from.s }));
  }, [clamp]);

  const rel = (cx: number, cy: number) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 };
  };

  // Mouse wheel / trackpad pinch zooms (needs a non-passive listener to stop the page scrolling behind).
  useEffect(() => {
    const st = stage.current;
    if (!open || !st) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      zoomAt(v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), rel(e.clientX, e.clientY), v);
    };
    st.addEventListener("wheel", wheel, { passive: false });
    return () => st.removeEventListener("wheel", wheel);
  }, [open, zoomAt]);

  // Touch and mouse: one finger swipes (or pans when zoomed), two fingers pinch, a double tap zooms.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ mode: "none" as "none" | "swipe" | "pan" | "pinch", sx: 0, sy: 0, from: REST, dist: 1, mid: { x: 0, y: 0 }, moved: false, onImg: false });
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const twoPts = () => {
    const [a, b] = [...pts.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: rel((a.x + b.x) / 2, (a.y + b.y) / 2) };
  };

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("button, a")) return;
    try { stage.current?.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMoving(true);
    if (pts.current.size === 1) {
      g.current = { mode: viewRef.current.s > 1 ? "pan" : "swipe", sx: e.clientX, sy: e.clientY, from: viewRef.current, dist: 1, mid: { x: 0, y: 0 }, moved: false, onImg: e.target === img.current };
    } else if (pts.current.size === 2) {
      const t = twoPts();
      setDrag({ x: 0, y: 0 });
      g.current = { ...g.current, mode: "pinch", from: viewRef.current, dist: t.dist, mid: t.mid, moved: true };
    }
  };

  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = g.current;
    const dx = e.clientX - c.sx, dy = e.clientY - c.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) c.moved = true;
    if (c.mode === "pinch" && pts.current.size >= 2) {
      const t = twoPts();
      const ns = Math.min(MAX, Math.max(1, (c.from.s * t.dist) / c.dist));
      // The point under the fingers when the pinch began follows the fingers.
      setView(clamp({ s: ns, x: t.mid.x - (ns * (c.mid.x - c.from.x)) / c.from.s, y: t.mid.y - (ns * (c.mid.y - c.from.y)) / c.from.s }));
    } else if (c.mode === "pan") {
      setView(clamp({ s: c.from.s, x: c.from.x + dx, y: c.from.y + dy }));
    } else if (c.mode === "swipe" && c.moved) {
      setDrag(Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
    }
  };

  const up = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    const c = g.current;
    if (c.mode === "pinch") {
      if (pts.current.size === 1) {
        const [p] = [...pts.current.values()];
        g.current = { ...c, mode: viewRef.current.s > 1 ? "pan" : "swipe", sx: p.x, sy: p.y, from: viewRef.current };
      } else {
        setMoving(false);
        if (viewRef.current.s < 1.05) setView(REST);
      }
      return;
    }
    if (pts.current.size) return;
    setMoving(false);
    const dx = e.clientX - c.sx, dy = e.clientY - c.sy;
    c.mode = "none";
    if (c.moved) {
      setDrag({ x: 0, y: 0 });
      if (viewRef.current.s > 1) return;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (dy > 90 && dy > Math.abs(dx)) close();
      return;
    }
    // A tap: twice quickly zooms in (or back out); once on the dark area closes.
    const now = e.timeStamp;
    const l = lastTap.current;
    if (now - l.t < 320 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      if (viewRef.current.s > 1) setView(REST);
      else zoomAt(2.5, rel(e.clientX, e.clientY), REST);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (!c.onImg && e.pointerType === "mouse") close();
    else if (!c.onImg) {
      // On touch, wait a moment so a double tap on the dark area doesn't close first.
      const t = now;
      setTimeout(() => { if (lastTap.current.t === t) close(); }, 320);
    }
  };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(viewRef.current.s * 1.5, { x: 0, y: 0 }); }
    else if (e.key === "-") { e.preventDefault(); zoomAt(viewRef.current.s / 1.5, { x: 0, y: 0 }); }
    else if (e.key === "0") { e.preventDefault(); setView(REST); }
  };

  const closed = () => {
    pts.current.clear();
    setMoving(false);
    setOpen(null);
    const o = opener.current;
    opener.current = null;
    if (o?.isConnected) o.focus({ preventScroll: true });
  };

  const w = WORDS[open?.hi ? "hi" : "en"];
  const zoomed = view.s > 1;

  return (
    <dialog ref={dialog} className="pv" aria-label={photo?.caption || w.label} onClose={closed} onKeyDown={key}>
      {open && photo && (
        <>
          <div className="pv-top">
            {n > 1 && <span className="pv-count num" aria-live="polite">{w.of(open.at + 1, n)}</span>}
            <a className="pv-btn pv-orig" href={photo.href} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 20 20" aria-hidden><path d="M11 3h6v6M17 3l-8 8M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" /></svg>
              <span>{w.original}</span>
            </a>
            <button type="button" className="pv-btn pv-x" onClick={close} aria-label={w.close} autoFocus>
              <svg viewBox="0 0 20 20" aria-hidden><path d="M5 5l10 10M15 5L5 15" /></svg>
            </button>
          </div>
          <div ref={stage} className={`pv-stage ${zoomed ? "zoomed" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
            <img key={photo.src} ref={img} src={photo.src} alt={photo.caption} draggable={false}
              className={state === "ok" ? "in" : ""} onLoad={() => setState("ok")} onError={() => setState("failed")}
              style={{ transform: `translate3d(${view.x + drag.x}px, ${view.y + drag.y}px, 0) scale(${view.s})`, transition: moving ? "none" : undefined }} />
            {state === "loading" && <span className="pv-spin" aria-hidden />}
            {state === "failed" && <p className="pv-fail">{w.failed} <a href={photo.href} target="_blank" rel="noreferrer">{w.original}</a></p>}
          </div>
          {n > 1 && (
            <>
              <button type="button" className="pv-nav prev" onClick={() => go(-1)} aria-label={w.prev}>
                <svg viewBox="0 0 20 20" aria-hidden><path d="M12.5 4.5L7 10l5.5 5.5" /></svg>
              </button>
              <button type="button" className="pv-nav next" onClick={() => go(1)} aria-label={w.next}>
                <svg viewBox="0 0 20 20" aria-hidden><path d="M7.5 4.5L13 10l-5.5 5.5" /></svg>
              </button>
            </>
          )}
          {photo.caption && <p className="pv-cap">{photo.caption}</p>}
        </>
      )}
    </dialog>
  );
}
