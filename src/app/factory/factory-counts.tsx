"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear as day, qty } from "@/lib/format";
import { saveFactoryCounts } from "./actions";
import type { PanelOrder } from "./factory-order";
import { errorText, words, type Lang } from "./i18n";

export type FactoryCount = { line_id: string; counted_on: string; cut: number; stitched: number; packed: number };
type Row = { cut: string; stitched: string; packed: string };
const FIELDS = ["cut", "stitched", "packed"] as const;

// On a released PO the factory keeps Sourcingo up to date with its pieces so far: cut, stitched and packed for each
// garment style, filled in once a day. Each style shows its last count; one Save sends every style that changed.
export function FactoryCounts({ order, counts, lang, canWrite }: { order: PanelOrder; counts: FactoryCount[]; lang: Lang; canWrite: boolean }) {
  const router = useRouter();
  const w = words(lang);
  const lines = order.lines.filter((l) => l.product !== "fabric");
  const last = (id: string) => counts.find((c) => c.line_id === id);
  const start = (id: string): Row => {
    const c = last(id);
    return { cut: c ? String(c.cut) : "", stitched: c ? String(c.stitched) : "", packed: c ? String(c.packed) : "" };
  };
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(lines.map((l) => [l.id, start(l.id)])));
  const [error, setError] = useState<{ text: string; line?: string } | null>(null);
  const [pending, begin] = useTransition();
  if (!lines.length) return null;

  const label = { cut: w.cntCut, stitched: w.cntStitched, packed: w.cntPacked };
  const changed = lines.filter((l) => FIELDS.some((f) => rows[l.id][f] !== start(l.id)[f]));

  function set(id: string, f: (typeof FIELDS)[number], v: string) {
    setRows((r) => ({ ...r, [id]: { ...r[id], [f]: v.replace(/[^\d]/g, "").slice(0, 6) } }));
  }

  function save() {
    setError(null);
    if (!changed.length) { setError({ text: w.cntNothing }); return; }
    const out = changed.map((l) => ({ lineId: l.id, cut: Number(rows[l.id].cut || 0), stitched: Number(rows[l.id].stitched || 0), packed: Number(rows[l.id].packed || 0) }));
    begin(async () => {
      try {
        const res = await saveFactoryCounts(out);
        if (res.error) { setError({ text: errorText(lang, res.error), line: res.style }); return; }
        toast(w.cntSaved);
        router.refresh();
      } catch (e) {
        setError({ text: errorText(lang, caught(e, "It didn't save. Try again.")) });
      }
    });
  }

  return (
    <div className="fsmp fcnt">
      <div className="row">
        <h3 className="text-[14px] font-semibold">{w.cntTitle}</h3>
      </div>
      <ul className="fcnt-list">
        {lines.map((l) => {
          const c = last(l.id);
          return (
            <li key={l.id} className="fcnt-row">
              <div className="fcnt-id">
                <b className="code">{l.style}</b>
                <small className="num">{w.cntOf(qty(l.qty))} · {c ? w.cntLast(day(c.counted_on)) : w.cntNone}</small>
              </div>
              <div className="fcnt-fields">
                {FIELDS.map((f) => (
                  <label key={f} className="field">
                    <span>{label[f]}</span>
                    <input className="inp num" inputMode="numeric" pattern="[0-9]*" value={rows[l.id][f]} disabled={!canWrite || pending}
                      onChange={(e) => set(l.id, f, e.target.value)} aria-label={`${l.style} ${label[f]}`} />
                  </label>
                ))}
              </div>
              {error?.line === l.id && <p className="text-[13px] font-semibold text-bad" role="alert">{error.text}</p>}
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <div className="fcnt-acts">
          <button type="button" className="btn" disabled={pending} onClick={save}>{pending ? w.cntSaving : w.cntSave}</button>
          {error && !error.line && <span className="text-[13px] font-semibold text-bad" role="alert">{error.text}</span>}
        </div>
      )}
    </div>
  );
}
