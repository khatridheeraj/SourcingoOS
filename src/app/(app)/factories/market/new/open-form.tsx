"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { openStyle } from "../actions";

// The few things factories need besides the style itself: when goods must be ready, when quotes close, and an
// optional target price and note.
export function OpenStyleForm({ lineId, style, unit, readyBy: ready0, closesOn: closes0, today, hasPhoto }: {
  lineId: string; style: string; unit: "m" | "pc"; readyBy: string; closesOn: string; today: string; hasPhoto: boolean;
}) {
  const router = useRouter();
  const [readyBy, setReadyBy] = useState(ready0);
  const [closesOn, setClosesOn] = useState(closes0);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <details className="mkt-open">
      <summary>Open {style} to factories</summary>
      <form className="mkt-open-form" onSubmit={(e) => {
        e.preventDefault();
        setError("");
        start(async () => {
          const res = await openStyle(lineId, target, readyBy, closesOn, note);
          if (res.error) return setError(res.error);
          toast(`${style} is open to factories.`);
          router.push(`/factories/market/${res.id}`);
        });
      }}>
        {!hasPhoto && <p className="text-[12.5px] font-semibold text-warn">This style has no photo. Factories quote better on a photo: add one in the order first.</p>}
        <div className="fask-fields">
          <label className="field"><span>Goods ready by</span>
            <input className="inp" type="date" min={today} value={readyBy} disabled={pending} onChange={(e) => setReadyBy(e.target.value)} />
          </label>
          <label className="field"><span>Quotes close</span>
            <input className="inp" type="date" min={today} max={readyBy} value={closesOn} disabled={pending} onChange={(e) => setClosesOn(e.target.value)} />
          </label>
          <label className="field"><span>Target price per {unit} (₹, optional)</span>
            <input className="inp num" inputMode="decimal" value={target} disabled={pending} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, "").slice(0, 10))} />
            <small>Shown to factories. Leave empty to see what they ask.</small>
          </label>
        </div>
        <label className="field"><span>Note to factories (optional)</span>
          <textarea className="inp" rows={2} maxLength={500} value={note} disabled={pending} placeholder="Stitch as the approved sample; trims supplied by us" onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Opening…" : "Open to factories"}</button>
      </form>
    </details>
  );
}
