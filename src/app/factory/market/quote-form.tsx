"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { dayNear as day, todayIST } from "@/lib/format";
import { addDays } from "@/lib/quick";
import { errorText, type Lang } from "../i18n";
import { marketWords } from "../market-words";
import { sendQuote, withdrawQuote } from "../market-actions";

// The factory's quote: a price per piece (or metre) and the day its goods will be ready, with a note if it wants.
export function QuoteForm({ id, unit, readyBy, mine, lang }: {
  id: string; unit: "m" | "pcs"; readyBy: string; mine: { rate: number; ready_on: string; note: string | null } | null; lang: Lang;
}) {
  const router = useRouter();
  const w = marketWords(lang);
  const today = todayIST();
  const [rate, setRate] = useState(mine ? String(mine.rate) : "");
  const [readyOn, setReadyOn] = useState(mine?.ready_on ?? readyBy);
  const [note, setNote] = useState(mine?.note ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function send() {
    setError("");
    const n = Number(rate.replace(/,/g, ""));
    if (!(n > 0)) return setError(w.needRate);
    if (!readyOn) return setError(w.needDate);
    start(async () => {
      const res = await sendQuote(id, n, readyOn, note.trim());
      if (res.error) return setError(errorText(lang, res.error));
      toast(w.sent);
      router.refresh();
    });
  }
  function takeBack() {
    setError("");
    start(async () => {
      const res = await withdrawQuote(id);
      if (res.error) return setError(errorText(lang, res.error));
      setRate("");
      toast(w.withdrawn);
      router.refresh();
    });
  }

  return (
    <form className="mkt-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="fask-fields">
        <label className="field">
          <span>{w.rate(unit)}</span>
          <input className="inp num" inputMode="decimal" value={rate} disabled={pending} placeholder="0"
            onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10))} />
        </label>
        <label className="field">
          <span>{w.readyOn}</span>
          <input className="inp" type="date" min={today} max={addDays(readyBy, 60)} value={readyOn} disabled={pending} onChange={(e) => setReadyOn(e.target.value)} />
        </label>
      </div>
      {readyOn > readyBy && <p className="text-[12.5px] font-semibold text-warn">{w.readyLate(day(readyBy))}</p>}
      <label className="field">
        <span>{w.qNote}</span>
        <textarea className="inp" rows={2} maxLength={500} value={note} placeholder={w.qNotePh} disabled={pending} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={pending}>{pending ? w.sending : mine ? w.update : w.send}</button>
      {mine && <button type="button" className="btn ghost" disabled={pending} onClick={takeBack}>{w.withdraw}</button>}
    </form>
  );
}
