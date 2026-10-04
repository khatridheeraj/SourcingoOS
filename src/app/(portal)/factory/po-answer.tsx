"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { type Lang, tr } from "@/lib/i18n";
import { answerPo } from "./actions";

export function PoAnswer({ id, lang = "en" }: { id: string; lang?: Lang }) {
  const t = tr(lang);
  const { toast, confirm } = useFeedback();
  const router = useRouter();
  const [decline, setDecline] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const send = (accept: boolean) => start(async () => {
    const r = await answerPo(id, accept, note);
    toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
    if (!r.error) router.refresh();
  });
  if (decline) {
    return (
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(false); }}>
        <label className="field"><span>{t("declineWhy")}</span>
          <textarea className="inp" rows={2} maxLength={500} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn danger" disabled={pending || !note.trim()}>{t("Send")}</button>
          <button type="button" className="btn" onClick={() => setDecline(false)}>{t("Back")}</button>
        </div>
      </form>
    );
  }
  return (
    <div className="row">
      <button type="button" className="btn primary" disabled={pending} onClick={async () => {
        if (await confirm(lang === "hi" ? "यह PO मंज़ूर करें? आप इन मात्राओं, रेट और तारीखों पर काम करने के लिए सहमत हैं।" : "Accept this PO? You agree to make these quantities at these rates by these dates.", t("Accept this PO"))) send(true);
      }}>{t("Accept this PO")}</button>
      <button type="button" className="btn" disabled={pending} onClick={() => setDecline(true)}>{t("I can't take it")}</button>
    </div>
  );
}
