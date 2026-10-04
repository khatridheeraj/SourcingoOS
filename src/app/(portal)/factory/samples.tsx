"use client";

import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { type Lang, tr } from "@/lib/i18n";
import { markSampleReady } from "./actions";

// One tap when the sample is done and on its way back to Sourcingo.
export function SampleReady({ id, lang = "en" }: { id: string; lang?: Lang }) {
  const t = tr(lang);
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await markSampleReady(id, note);
      toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
      if (!r.error) setOpen(false);
    });
  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t("Sample is ready")}</button>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("sampleNotePh")} aria-label="Note" className="inp" />
      <div className="row">
        <button type="button" className="btn primary" disabled={pending} onClick={send}>{pending ? t("Sending…") : t("Confirm: sending it to Sourcingo")}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => setOpen(false)}>{t("Back")}</button>
      </div>
    </div>
  );
}
