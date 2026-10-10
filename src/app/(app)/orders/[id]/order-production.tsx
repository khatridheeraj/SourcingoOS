"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, daysBetween, STAGES } from "@/lib/format";
import { saveProgress, type ProgressInput } from "../actions";

// Where the order is on the floor, and its new ship date if it slipped.
export function OrderProduction({ id, open, shipDate, today, stageAt, initial }: {
  id: string;
  open: boolean;
  shipDate: string;
  today: string;
  stageAt: string | null;
  initial: ProgressInput;
}) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const change = (k: keyof ProgressInput, v: string) => {
    setP({ ...p, [k]: v });
    setSaved(false);
  };
  const at = STAGES.findIndex((s) => s.key === p.stage);
  const due = p.revised_ship_date || shipDate;
  const lateBy = open && due && due < today ? daysBetween(due, today) : 0;
  const movedBy = shipDate && p.revised_ship_date ? daysBetween(shipDate, p.revised_ship_date) : 0;
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await saveProgress(id, p);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="panel">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Production</h2>
        {lateBy > 0 && <span className="chip bad">Late by {lateBy} {lateBy === 1 ? "day" : "days"}</span>}
        {!lateBy && movedBy > 0 && <span className="chip warn">Moved {movedBy} {movedBy === 1 ? "day" : "days"} later</span>}
        {open && !lateBy && !movedBy && due && <span className="chip ok">On time</span>}
      </div>
      {!open && <p className="muted text-[13px] mb-3">This order is closed. Production details are kept as they were.</p>}

      <div className="field">
        <span>Stage{stageAt && p.stage === initial.stage && <> · since {day(stageAt.slice(0, 10))}</>}</span>
        <div className="steps" role="group" aria-label="Stage">
          <button type="button" aria-pressed={!p.stage} disabled={!open} onClick={() => change("stage", "")}>Not started</button>
          {STAGES.map((s, i) => (
            <button key={s.key} type="button" className={i < at ? "done" : undefined} aria-pressed={p.stage === s.key}
              disabled={!open} onClick={() => change("stage", s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fgrid mt-3">
        <label className="field">
          <span>New ship date</span>
          <input className="inp" type="date" value={p.revised_ship_date} disabled={!open}
            onChange={(e) => change("revised_ship_date", e.target.value)} />
          <small>{shipDate ? `Buyer's date: ${day(shipDate)}. ` : ""}Leave blank if it hasn&apos;t moved.</small>
        </label>
        <label className="field">
          <span>Reason for delay{p.revised_ship_date && <i> *</i>}</span>
          <input className="inp" value={p.delay_reason} disabled={!open} placeholder="e.g. Fabric came late from mill"
            onChange={(e) => change("delay_reason", e.target.value)} />
        </label>
      </div>

      {open && (
        <div className="row mt-3">
          <button className="btn primary" disabled={pending || !dirty}>{pending ? "Saving…" : "Save production"}</button>
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {saved && !error && !dirty && <span className="text-[13px] font-semibold text-ok">Saved</span>}
        </div>
      )}
    </form>
  );
}
