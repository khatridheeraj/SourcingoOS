"use client";

import { useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import type { TnaStatus } from "@/lib/model";
import { updateCheckpoint } from "./actions";

const CHOICES: { s: TnaStatus; label: string }[] = [
  { s: "pending", label: "Not started" },
  { s: "in_progress", label: "In progress" },
  { s: "completed", label: "Done" },
  { s: "delayed", label: "Delayed" },
];

// Big buttons for a phone: one tap to move a step; Delayed asks why.
export function CheckpointControl({ id, name, status, note }: { id: string; name: string; status: TnaStatus; note: string | null }) {
  const { toast } = useFeedback();
  const [cur, setCur] = useState(status);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState(status === "delayed" ? note ?? "" : "");
  const [pending, start] = useTransition();

  const save = (s: TnaStatus, n = "") => {
    const before = cur;
    setCur(s);
    start(async () => {
      const r = await updateCheckpoint(id, s, n);
      if (r.error) { setCur(before); toast(r.error, "bad"); return; }
      setAsking(false);
      toast(`${name}: ${CHOICES.find((c) => c.s === s)!.label}`);
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
            {c.label}
          </button>
        ))}
      </div>
      {asking && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (!why.trim()) { toast("Say why it is delayed.", "bad"); return; } save("delayed", why); }}>
          <label className="field"><span>Why is it delayed? New expected date?</span>
            <textarea className="inp" rows={2} maxLength={500} autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Fabric late from mill, cutting starts 14 Oct" />
          </label>
          <div className="row">
            <button className="btn primary sm" disabled={pending}>Save delay</button>
            <button type="button" className="btn sm" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
