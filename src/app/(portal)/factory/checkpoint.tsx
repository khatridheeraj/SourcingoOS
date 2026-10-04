"use client";

import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { DELAY_HI, type Lang, tr } from "@/lib/i18n";
import { DELAY_REASONS, type DelayReason, type TnaStatus } from "@/lib/model";
import { updateCheckpoint } from "./actions";

const CHOICES: { s: TnaStatus; label: string }[] = [
  { s: "pending", label: "Not started" },
  { s: "in_progress", label: "In progress" },
  { s: "completed", label: "Done" },
  { s: "delayed", label: "Delayed" },
];

// Big buttons for a phone: one tap to move a step; Delayed asks why.
export function CheckpointControl({ id, name, status, note, reason, lang = "en" }: {
  id: string; name: string; status: TnaStatus; note: string | null; reason?: DelayReason | null; lang?: Lang;
}) {
  const t = tr(lang);
  const { toast } = useFeedback();
  const [cur, setCur] = useState(status);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState<string>(status === "delayed" ? reason ?? "" : "");
  const [text, setText] = useState(status === "delayed" ? note ?? "" : "");
  const [pending, start] = useTransition();

  const save = (s: TnaStatus, n = "", r = "") => {
    const before = cur;
    setCur(s);
    start(async () => {
      const res = await updateCheckpoint(id, s, n, r);
      if (res.error) { setCur(before); toast(res.error, "bad"); return; }
      setAsking(false);
      toast(`${name}: ${t(CHOICES.find((c) => c.s === s)!.label)}`);
    });
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="seg" role="group" aria-label={`${name} status`}>
        {CHOICES.map((c) => (
          <button
            key={c.s}
            type="button"
            className={`${c.s} ${(asking ? c.s === "delayed" : cur === c.s) ? "on" : ""}`}
            aria-pressed={cur === c.s}
            disabled={pending}
            onClick={() => (c.s === "delayed" ? setAsking(true) : c.s !== cur && save(c.s))}
          >
            {t(c.label)}
          </button>
        ))}
      </div>
      {asking && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => {
          e.preventDefault();
          if (!why) { toast(t("Pick why it is delayed."), "bad"); return; }
          if (why === "other" && !text.trim()) { toast(t("Say why it is delayed."), "bad"); return; }
          save("delayed", text, why);
        }}>
          <span className="text-[12px] font-semibold text-muted">{t("Why is it delayed?")}</span>
          <div className="reasons" role="radiogroup" aria-label={t("Why is it delayed?")}>
            {DELAY_REASONS.map((r) => (
              <button key={r.value} type="button" role="radio" aria-checked={why === r.value} className={why === r.value ? "on" : ""} onClick={() => setWhy(r.value)}>
                {lang === "hi" ? DELAY_HI[r.value] : r.label}
              </button>
            ))}
          </div>
          <label className="field"><span>{t("delayNote")}</span>
            <textarea className="inp" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("delayNotePh")} />
          </label>
          <div className="row">
            <button className="btn primary sm" disabled={pending}>{t("Save delay")}</button>
            <button type="button" className="btn sm" onClick={() => setAsking(false)}>{t("Cancel")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
