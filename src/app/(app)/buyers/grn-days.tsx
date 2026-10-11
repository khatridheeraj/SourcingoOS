"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setGrnDays } from "./actions";

export function GrnDays({ buyerId, code, value, owner }: { buyerId: string; code: string; value: number | null; owner: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(value == null ? "" : String(value));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!owner) return <span className="num">{value ?? 7} days</span>;
  const dirty = v !== (value == null ? "" : String(value));
  return (
    <form className="row gap-1.5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await setGrnDays(buyerId, v);
        if (r.error) setError(r.error);
        else { setError(""); router.refresh(); }
      });
    }}>
      <input className="inp num w-[70px]" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="7" aria-label={`${code} GRN days`} />
      <span className="text-xs muted">days</span>
      {dirty && <button className="btn sm primary" disabled={pending}>Save</button>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </form>
  );
}
