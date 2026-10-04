"use client";

import { useState, useTransition } from "react";
import { savePreferences } from "@/app/me-actions";
import { useFeedback } from "@/components/feedback";

export function SettingsForm({ language, digest, phone, showDigest, hi = false }: { language: "en" | "hi"; digest: boolean; phone: string; showDigest: boolean; hi?: boolean }) {
  const { toast } = useFeedback();
  const [lang, setLang] = useState(language);
  const [dig, setDig] = useState(digest);
  const [ph, setPh] = useState(phone);
  const [pending, start] = useTransition();
  const dirty = lang !== language || dig !== digest || ph !== phone;
  return (
    <form className="panel stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await savePreferences({ language: lang, digest: dig, phone: ph });
        toast(r.error ?? (lang === "hi" ? "सेव हो गया।" : "Saved."), r.error ? "bad" : undefined);
      });
    }}>
      <div className="field"><span>{hi ? "भाषा" : "Language"}</span>
        <div className="seg" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", maxWidth: 320 }}>
          <button type="button" className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          <button type="button" className={lang === "hi" ? "on" : ""} aria-pressed={lang === "hi"} onClick={() => setLang("hi")}>हिंदी</button>
        </div>
        <small>{hi ? "फ़ैक्टरी पोर्टल इस भाषा में दिखेगा।" : "The factory portal shows in this language. Office screens stay in English."}</small>
      </div>
      {showDigest && (
        <label className="row text-[13.5px]"><input type="checkbox" checked={dig} onChange={(e) => setDig(e.target.checked)} /> Email me a summary every morning at 8:30 (what&apos;s overdue, due today and waiting for me)</label>
      )}
      <label className="field" style={{ maxWidth: 320 }}><span>{hi ? "फ़ोन (WhatsApp)" : "Phone (WhatsApp)"}</span>
        <input className="inp" type="tel" value={ph} maxLength={30} onChange={(e) => setPh(e.target.value)} placeholder="+91 98xxxxxxx" />
      </label>
      <div><button className="btn primary" disabled={pending || !dirty}>{pending ? "…" : hi ? "सेव करें" : "Save"}</button></div>
    </form>
  );
}
