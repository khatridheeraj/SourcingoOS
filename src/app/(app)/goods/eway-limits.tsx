"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day } from "@/lib/format";
import { ewayLimitsLine, type EwayRules } from "@/lib/eway";
import { saveEwayRules } from "./actions";

// The e-way bill limits every lot is checked against. Everyone sees them; only the owner changes them.
export function EwayLimits({ rules, owner }: { rules: EwayRules; owner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ ...rules, inter_state: String(rules.inter_state), in_state: String(rules.in_state), same_city: String(rules.same_city) });
  const [err, setErr] = useState("");
  const put = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    start(async () => {
      const r = await saveEwayRules(v);
      if (r.error) return setErr(r.error);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <section className="card mt-4" aria-labelledby="eway-h">
      <header className="card-h">
        <h2 id="eway-h" className="min-w-0">E-way bill limits</h2>
        {owner && !editing && <button type="button" className="btn sm ml-auto" onClick={() => setEditing(true)}>Change</button>}
      </header>
      <div className="px-4 py-3 text-[14px]">
        {!editing ? (
          <>
            <p>A lot needs an e-way bill only when its invoice with GST is above the limit for where it goes. {ewayLimitsLine(rules)}</p>
            <p className="muted mt-1 text-[13px]">Checked {day(rules.checked_on)}.{rules.source && <> <a className="link" href={rules.source} target="_blank" rel="noreferrer">Source</a></>}</p>
          </>
        ) : (
          <form noValidate onSubmit={save}>
            <div className="fgrid">
              <label className="field"><span>Another state, above (Rs)</span><input className="inp num" inputMode="numeric" value={v.inter_state} onChange={(e) => put("inter_state", e.target.value)} /></label>
              <label className="field"><span>Elsewhere in our state, above (Rs)</span><input className="inp num" inputMode="numeric" value={v.in_state} onChange={(e) => put("in_state", e.target.value)} /></label>
              <label className="field"><span>Same city, above (Rs)</span><input className="inp num" inputMode="numeric" value={v.same_city} onChange={(e) => put("same_city", e.target.value)} /></label>
              <label className="field"><span>Our state</span><input className="inp" value={v.home_state} onChange={(e) => put("home_state", e.target.value)} /></label>
              <label className="field"><span>Checked on</span><input className="inp" type="date" value={v.checked_on} onChange={(e) => put("checked_on", e.target.value)} /></label>
              <label className="field"><span>Source link</span><input className="inp" type="url" value={v.source} onChange={(e) => put("source", e.target.value)} /></label>
            </div>
            {err && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{err}</p>}
            <div className="row mt-3">
              <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save limits"}</button>
              <button type="button" className="btn ghost" onClick={() => { setEditing(false); setErr(""); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
      <details className="howto border-t border-line px-4 py-3">
        <summary>Where these come from</summary>
        <p>Rule 138 of the CGST Rules asks for an e-way bill when the consignment value, the invoice value including GST, is more than Rs 50,000. Each state sets its own limit for goods that stay inside it; Rajasthan&apos;s is Rs 1 lakh from one city to another and Rs 2 lakh inside the same city (from 1 April 2022). Goods sent to a job worker in another state always need one. Lots waiting for their e-way bill are checked again when these change.</p>
      </details>
    </section>
  );
}
