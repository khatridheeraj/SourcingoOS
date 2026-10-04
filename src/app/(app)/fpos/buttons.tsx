"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { issuePo, recordAnswer } from "./actions";

export function IssueButton({ soId, label = "Issue factory PO", reissue }: { soId: string; label?: string; reissue?: boolean }) {
  const { toast, confirm } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`btn sm ${reissue ? "" : "primary"}`} disabled={pending} onClick={async () => {
      if (reissue && !(await confirm("Send a new revision to the factory? The current PO is replaced and they need to accept again.", "Send new revision"))) return;
      start(async () => {
        const r = await issuePo(soId);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (r.id) router.push(`/fpos/${r.id}`);
      });
    }}>{pending ? "Sending…" : label}</button>
  );
}

export function RecordAnswer({ id }: { id: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const [decline, setDecline] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const send = (accept: boolean) => start(async () => {
    const r = await recordAnswer(id, accept, note);
    toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
    if (!r.error) router.refresh();
  });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="text-[13px] text-muted">The factory answers in its portal. If they told you on the phone, record it here.</p>
      {decline ? (
        <div className="row">
          <input className="inp" style={{ maxWidth: 360 }} value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="Why they can't take it" aria-label="Reason" />
          <button type="button" className="btn danger" disabled={pending || !note.trim()} onClick={() => send(false)}>Mark declined</button>
          <button type="button" className="btn" onClick={() => setDecline(false)}>Back</button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn primary" disabled={pending} onClick={() => send(true)}>Factory accepted</button>
          <button type="button" className="btn" disabled={pending} onClick={() => setDecline(true)}>Factory declined</button>
        </div>
      )}
    </div>
  );
}
