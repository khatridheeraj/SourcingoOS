"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";

type Toast = (msg: string, kind?: "bad") => void;
type Confirm = (text: string, okLabel?: string, danger?: boolean) => Promise<boolean>;
type Ask = (text: string, placeholder?: string, okLabel?: string) => Promise<string | null>;
const Ctx = createContext<{ toast: Toast; confirm: Confirm; prompt: Ask }>({ toast: () => {}, confirm: async () => false, prompt: async () => null });

// Toasts and confirm dialogs, styled like the original tool.
export function Feedback({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind?: "bad"; n: number } | null>(null);
  const [ask, setAsk] = useState<{ text: string; ok: string; danger?: boolean; done: (v: boolean) => void } | null>(null);
  const [q, setQ] = useState<{ text: string; ok: string; placeholder: string; done: (v: string | null) => void } | null>(null);
  const [answer, setAnswer] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);

  const toast = useCallback<Toast>((text, kind) => setMsg({ text, kind, n: Date.now() }), []);
  const confirm = useCallback<Confirm>(
    (text, ok = "OK", danger) => new Promise((resolve) => setAsk({ text, ok, danger, done: resolve })),
    [],
  );
  const prompt = useCallback<Ask>(
    (text, placeholder = "", ok = "OK") => new Promise((resolve) => { setAnswer(""); setQ({ text, ok, placeholder, done: resolve }); }),
    [],
  );

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.kind === "bad" ? 5200 : 3000);
    return () => clearTimeout(t);
  }, [msg]);
  useEffect(() => {
    if (!ask) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { ask.done(false); setAsk(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  const close = (v: boolean) => {
    ask?.done(v);
    setAsk(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm, prompt }}>
      {children}
      {msg && <div key={msg.n} className={`toast ${msg.kind ?? ""}`} role="status">{msg.text}</div>}
      {ask && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal" role="dialog" aria-modal="true">
            <div>{ask.text}</div>
            <div className="row">
              <button type="button" className="btn" onClick={() => close(false)}>Cancel</button>
              <button type="button" ref={okRef} className={`btn ${ask.danger ? "danger" : "primary"}`} onClick={() => close(true)}>{ask.ok}</button>
            </div>
          </div>
        </div>
      )}
      {q && (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) { q.done(null); setQ(null); } }}>
          <form className="modal" role="dialog" aria-modal="true" onSubmit={(e) => { e.preventDefault(); q.done(answer.trim()); setQ(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") { q.done(null); setQ(null); } }}>
            <label className="flex flex-col gap-2">
              {q.text}
              <input autoFocus className="inp" value={answer} placeholder={q.placeholder} onChange={(e) => setAnswer(e.target.value)} maxLength={300} />
            </label>
            <div className="row">
              <button type="button" className="btn" onClick={() => { q.done(null); setQ(null); }}>Cancel</button>
              <button className="btn primary">{q.ok}</button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useFeedback = () => useContext(Ctx);

// A search box that keeps ?q= in the address bar as you type.
export function SearchParamInput({ placeholder, name = "q", className = "inp" }: { placeholder: string; name?: string; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get(name) ?? "");
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const update = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (v.trim()) next.set(name, v);
      else next.delete(name);
      start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
    }, 250);
  };
  return <input type="search" value={value} onChange={(e) => update(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={className} style={{ maxWidth: 320 }} />;
}

// Filters that apply the moment a select or date changes.
export function AutoForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  return (
    <form
      className={className}
      onChange={(e) => {
        const form = e.currentTarget;
        const q = new URLSearchParams();
        new FormData(form).forEach((v, k) => {
          if (String(v)) q.set(k, String(v));
        });
        // e.g. picking a custom date switches the range preset off.
        const clears = (e.target as HTMLElement).dataset.clears;
        if (clears) q.delete(clears);
        start(() => router.replace(`${path}?${q.toString()}`, { scroll: false }));
      }}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  );
}

// A table row that opens a page when clicked (the first cell keeps a real link for keyboards).
export function ClickRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr className="click" onClick={(e) => !(e.target as HTMLElement).closest("a,button,select,input") && router.push(href)}>
      {children}
    </tr>
  );
}
