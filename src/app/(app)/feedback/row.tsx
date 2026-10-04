"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { answerFeedback } from "./actions";

const LABEL = { new: "New", planned: "Planned", done: "Done", wontfix: "Won't do" } as const;

export function FeedbackAnswer({ id, status, reply }: { id: number; status: string; reply: string }) {
  const { toast } = useFeedback();
  const router = useRouter();
  const [s, setS] = useState(status);
  const [r, setR] = useState(reply);
  const [pending, start] = useTransition();
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); start(async () => { const x = await answerFeedback(id, s, r); toast(x.error ?? x.ok ?? "", x.error ? "bad" : undefined); router.refresh(); }); }}>
      <select className="inp" style={{ maxWidth: 140 }} value={s} onChange={(e) => setS(e.target.value)} aria-label="Status">
        {Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="inp" style={{ flex: 1, minWidth: 200 }} value={r} maxLength={2000} onChange={(e) => setR(e.target.value)} placeholder="Reply (they get a notification)" aria-label="Reply" />
      <button className="btn sm primary" disabled={pending || (s === status && r === reply)}>Save</button>
    </form>
  );
}
