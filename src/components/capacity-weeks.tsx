"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";
import type { CapWeek } from "@/lib/capacity";
import { dayAtNear, dayNear } from "@/lib/format";

const WORDS = {
  en: {
    title: "Free capacity",
    teamSub: "Pieces it says it can still take each week, beside what is due to ship with us. Quotes show this before you award a style.",
    factorySub: "Tell Sourcingo how many pieces you can still take each week. New orders go first to factories with free capacity.",
    week: (d: string) => `Week of ${d}`, due: (n: string) => `${n} due with us`, free: "Free pcs", notSaid: "Not given",
    save: "Save capacity", saving: "Saving…", saved: "Capacity saved.", edit: "Update capacity", cancel: "Cancel",
    said: (d: string) => `Last updated ${d}`, never: "The factory hasn't given its free capacity yet.",
  },
  hi: {
    title: "खाली क्षमता",
    teamSub: "",
    factorySub: "हर हफ़्ते आप और कितने पीस ले सकते हैं, Sourcingo को बताएँ। नए ऑर्डर पहले उन फैक्ट्रियों को जाते हैं जिनके पास जगह है।",
    week: (d: string) => `${d} वाला हफ़्ता`, due: (n: string) => `हमारा ${n} भेजना है`, free: "खाली पीस", notSaid: "नहीं बताया",
    save: "क्षमता भेजें", saving: "भेज रहे हैं…", saved: "क्षमता भेज दी।", edit: "क्षमता बदलें", cancel: "रद्द करें",
    said: (d: string) => `आखिरी बार ${d} को बताया`, never: "अभी तक खाली क्षमता नहीं बताई।",
  },
} as const;

const short = (d: string) => dayNear(d);
const n = (v: number) => v.toLocaleString("en-IN");

// Eight weeks of free capacity. Each row: the week, what is already due to ship with us that week, and the free pieces
// the factory gave (a bar shows how full the week is). Whoever may edit gets one form for all weeks and one Save.
export function CapacityWeeks({ weeks, mode, lang = "en", canEdit, save }: {
  weeks: CapWeek[]; mode: "team" | "factory"; lang?: "en" | "hi"; canEdit: boolean;
  save: (rows: { week: string; free: number | null }[]) => Promise<{ error?: string }>;
}) {
  const w = WORDS[mode === "team" ? "en" : lang];
  const router = useRouter();
  const [editing, setEditing] = useState(mode === "factory" && canEdit && weeks.every((x) => x.free == null));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(weeks.map((x) => [x.week, x.free == null ? "" : String(x.free)])));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const last = weeks.map((x) => x.said_at).filter((x): x is string => !!x).sort().at(-1);
  const max = Math.max(1, ...weeks.map((x) => Math.max(x.free ?? 0, x.due_pcs)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const rows = weeks.map((x) => ({ week: x.week, raw: (vals[x.week] ?? "").replace(/[,\s]/g, "") }));
    if (rows.some((r) => r.raw && !/^\d{1,7}$/.test(r.raw))) return setError(lang === "hi" && mode === "factory" ? "पीस सिर्फ़ अंकों में लिखें।" : "Give the free pieces as whole numbers.");
    start(async () => {
      const r = await save(rows.map((x) => ({ week: x.week, free: x.raw ? Number(x.raw) : null })));
      if (r.error) return setError(r.error);
      toast(w.saved);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <section id="capacity" className="panel stack scroll-mt-20" aria-labelledby="cap-h">
      <div>
        <h2 id="cap-h" className="font-bold">{w.title}</h2>
        <p className="muted text-[13px]">{mode === "team" ? w.teamSub : w.factorySub}</p>
      </div>
      <form onSubmit={submit} noValidate className="stack">
        <ul className="cap-weeks">
          {weeks.map((x) => {
            const full = x.free != null && x.free === 0;
            return (
              <li key={x.week}>
                <span className="cap-wk">{w.week(short(x.week))}</span>
                <span className="cap-due num muted">{x.due_pcs ? w.due(`${n(x.due_pcs)} pcs`) : x.due_m ? w.due(`${n(x.due_m)} m`) : ""}</span>
                {editing ? (
                  <input className="inp num cap-inp" inputMode="numeric" aria-label={`${w.free}, ${w.week(short(x.week))}`} placeholder="0"
                    value={vals[x.week] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [x.week]: e.target.value }))} />
                ) : (
                  <span className={`cap-free num ${x.free == null ? "muted" : full ? "text-warn" : ""}`}>{x.free == null ? w.notSaid : `${n(x.free)} pcs`}</span>
                )}
                <span className="cap-bar" aria-hidden><i style={{ width: `${Math.round(((x.free ?? 0) / max) * 100)}%` }} /></span>
              </li>
            );
          })}
        </ul>
        {!editing && <small className="muted">{last ? w.said(dayAtNear(last)) : w.never}</small>}
        {error && <div className="errbox" role="alert">{error}</div>}
        {canEdit && (editing ? (
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? w.saving : w.save}</button>
            {weeks.some((x) => x.free != null) && <button type="button" className="btn" disabled={pending} onClick={() => setEditing(false)}>{w.cancel}</button>}
          </div>
        ) : <div><button type="button" className="btn" onClick={() => setEditing(true)}>{w.edit}</button></div>)}
      </form>
    </section>
  );
}
