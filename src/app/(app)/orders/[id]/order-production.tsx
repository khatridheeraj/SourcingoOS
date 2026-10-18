"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, dayAt, daysBetween, stageLabel } from "@/lib/format";
import { saveProgress, type ProgressInput } from "../actions";

// Where the order stands against its ship date, and its new ship date if it slipped.
export function OrderProduction({ id, open, canEdit, shipDate, today, stage, stageAt, riskDays = 0, initial }: {
  id: string;
  open: boolean;
  canEdit: boolean;
  shipDate: string;
  today: string;
  stage: string | null;
  stageAt: string | null;
  // Days the TNA says the slowest style will miss the ship date by (0 when it should make it).
  riskDays?: number;
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
  const due = p.revised_ship_date || shipDate;
  const lateBy = open && due && due < today ? daysBetween(due, today) : 0;
  const movedBy = shipDate && p.revised_ship_date ? daysBetween(shipDate, p.revised_ship_date) : 0;
  const locked = !open || !canEdit;
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
    <form onSubmit={submit} className="panel scroll-mt-20" id="ship">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Ship date</h2>
        {lateBy > 0 && <span className="chip bad">Late by {lateBy} {lateBy === 1 ? "day" : "days"}</span>}
        {!lateBy && movedBy > 0 && <span className="chip warn">Moved {movedBy} {movedBy === 1 ? "day" : "days"} later</span>}
        {open && !lateBy && riskDays > 0 && <span className="chip bad" title="A late step pushes back every step after it">At risk · about {riskDays} {riskDays === 1 ? "day" : "days"} late</span>}
        {open && !lateBy && !movedBy && !riskDays && due && <span className="chip ok">On time</span>}
      </div>
      {!open && <p className="muted text-[13px] mb-3">This order is closed. Production details are kept as they were.</p>}

      <p className="text-[13px]">
        Order stage: <b>{stageLabel(stage)}</b>{stageAt && <span className="muted"> · since {dayAt(stageAt)}</span>}
        <span className="muted"> · set by the slowest style</span>
      </p>

      <div className="fgrid mt-3">
        <label className="field">
          <span>New ship date</span>
          <input className="inp" type="date" value={p.revised_ship_date} disabled={locked}
            onChange={(e) => change("revised_ship_date", e.target.value)} />
          <small>{shipDate ? `Buyer's date: ${day(shipDate)}. ` : ""}Leave blank if it hasn&apos;t moved.</small>
        </label>
        <label className="field">
          <span>Reason for delay{p.revised_ship_date && <i> *</i>}</span>
          <input className="inp" value={p.delay_reason} disabled={locked} placeholder="e.g. Fabric came late from mill"
            onChange={(e) => change("delay_reason", e.target.value)} />
        </label>
      </div>

      {!locked && (
        <div className="row mt-3">
          <button className="btn primary" disabled={pending || !dirty}>{pending ? "Saving…" : "Save ship date"}</button>
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {saved && !error && !dirty && <span className="text-[13px] font-semibold text-ok">Saved</span>}
        </div>
      )}
    </form>
  );
}
