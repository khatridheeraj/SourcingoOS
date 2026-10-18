"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "bad" };
const EVENT = "sourcingo:toast";

// Shows a short confirmation at the bottom of the screen, with a little buzz on phones that support it.
// It lives in the app layout, so it survives the page refreshing its data.
export function toast(text: string, tone: Toast["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, tone } }));
  try { navigator.vibrate?.(tone === "ok" ? 18 : [30, 60, 30]); } catch {}
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++n;
      setItems((t) => [...t.slice(-2), { id, text, tone }]);
      setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 3200);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toast-ic" aria-hidden>{t.tone === "ok" ? "✓" : "!"}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
