"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { latinDigits } from "@/lib/digits";
import { packGaps, packTotals, rowProblem, type PackRow, type PackStyle } from "@/lib/packing";
import { savePackingList } from "../../actions";

type Draft = { from: string; to: string; line: string; sizes: Record<string, string>; net: string; gross: string };
const NO_SIZES = "Pieces";

const toDraft = (r: PackRow): Draft => ({ from: String(r.carton_from), to: String(r.carton_to), line: r.line_id, net: r.net_kg == null ? "" : String(r.net_kg), gross: r.gross_kg == null ? "" : String(r.gross_kg),
  sizes: Object.fromEntries(Object.entries(r.sizes).map(([k, v]) => [k, String(v)])) });
const whole = (v: string) => { const t = latinDigits(v).replace(/[,\s]/g, ""); return t === "" ? NaN : /^\d+$/.test(t) ? Number(t) : NaN; };
const kg = (v: string) => { const t = latinDigits(v).replace(/[,\s]|kg/gi, ""); return t === "" ? null : Number(t); };

// The packing list editor: one card per run of identical cartons, with the style's sizes as boxes.
export function PackingEditor({ dispatchId, styles, initial }: { dispatchId: string; styles: PackStyle[]; initial: PackRow[] }) {
  const router = useRouter();
  const blank = (from: number, line = styles.length === 1 ? styles[0].id : ""): Draft => ({ from: String(from), to: String(from), line, sizes: {}, net: "", gross: "" });
  const [rows, setRows] = useState<Draft[]>(initial.length ? initial.map(toDraft) : [blank(1)]);
  const [error, setError] = useState<{ text: string; row?: number } | null>(null);
  const [pending, start] = useTransition();
  const sizesOf = (line: string) => { const s = styles.find((x) => x.id === line)?.sizes ?? []; return s.length ? s : [NO_SIZES]; };

  const parsed: PackRow[] = rows.map((d) => ({
    carton_from: whole(d.from), carton_to: whole(d.to), line_id: d.line, net_kg: kg(d.net), gross_kg: kg(d.gross),
    sizes: Object.fromEntries(sizesOf(d.line).map((s) => [s, whole(d.sizes[s] ?? "") || 0]).filter(([, n]) => (n as number) > 0)),
  }));
  const t = packTotals(parsed.filter((r) => Number.isInteger(r.carton_from) && Number.isInteger(r.carton_to)));
  const gaps = packGaps(parsed, styles);

  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function add() {
    const last = rows[rows.length - 1];
    const next = (whole(last?.to ?? "0") || 0) + 1;
    // A new run usually repeats the last one's style, sizes and weights.
    setRows([...rows, last ? { ...last, from: String(next), to: String(next) } : blank(1)]);
  }
  function save() {
    setError(null);
    for (let i = 0; i < parsed.length; i++) {
      const p = rowProblem(parsed[i], i, parsed);
      if (p) { setError({ text: p, row: i }); document.getElementById(`pk-${i}`)?.scrollIntoView({ block: "center" }); return; }
      if ([parsed[i].net_kg, parsed[i].gross_kg].some((n) => n != null && !(n > 0))) { setError({ text: `Row ${i + 1}: weights are in kg, like 6.5.`, row: i }); return; }
    }
    start(async () => {
      try {
        const res = await savePackingList(dispatchId, parsed);
        if (res.error) { setError({ text: res.error }); return; }
        toast(`Packing list saved: ${t.cartons} cartons.`);
        router.refresh();
      } catch (e) { setError({ text: caught(e, "The packing list didn't save. Try again.") }); }
    });
  }

  return (
    <section className="card pk" aria-labelledby="pk-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="pk-h">Cartons</h2>
          <p>{t.cartons} {t.cartons === 1 ? "carton" : "cartons"} · {t.pcs.toLocaleString("en-IN")} pcs{t.gross ? ` · ${t.gross.toFixed(1)} kg gross` : ""}</p>
        </div>
      </header>
      <ol className="pk-rows">
        {rows.map((d, i) => (
          <li key={i} id={`pk-${i}`} className={`pk-row${error?.row === i ? " bad" : ""}`}>
            <div className="pk-line">
              <label className="field"><span>Cartons from</span><input className="inp num" inputMode="numeric" value={d.from} onChange={(e) => set(i, { from: e.target.value, to: whole(d.to) < whole(e.target.value) || d.to === d.from ? e.target.value : d.to })} /></label>
              <label className="field"><span>to</span><input className="inp num" inputMode="numeric" value={d.to} onChange={(e) => set(i, { to: e.target.value })} /></label>
              <label className="field pk-style"><span>Style</span>
                <select className="inp" value={d.line} onChange={(e) => set(i, { line: e.target.value, sizes: {} })}>
                  <option value="">Pick a style</option>
                  {styles.map((s) => <option key={s.id} value={s.id}>{s.style}{s.colour ? ` · ${s.colour}` : ""}</option>)}
                </select>
              </label>
            </div>
            {d.line && (
              <div className="pk-sizes" role="group" aria-label={`Pieces in one carton, row ${i + 1}`}>
                {sizesOf(d.line).map((s) => (
                  <label key={s} className="field"><span>{s}</span><input className="inp num" inputMode="numeric" value={d.sizes[s] ?? ""} placeholder="0" onChange={(e) => set(i, { sizes: { ...d.sizes, [s]: e.target.value } })} /></label>
                ))}
                <label className="field"><span>Net kg</span><input className="inp num" inputMode="decimal" value={d.net} onChange={(e) => set(i, { net: e.target.value })} /></label>
                <label className="field"><span>Gross kg</span><input className="inp num" inputMode="decimal" value={d.gross} onChange={(e) => set(i, { gross: e.target.value })} /></label>
              </div>
            )}
            <div className="pk-foot">
              <small className="muted">{Object.values(parsed[i].sizes).reduce((a, b) => a + b, 0)} pcs in each carton · weights per carton</small>
              {rows.length > 1 && <button type="button" className="link text-[13px]" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            {error?.row === i && <p className="text-[13px] font-semibold text-bad" role="alert">{error.text}</p>}
          </li>
        ))}
      </ol>
      <div className="pk-acts">
        <button type="button" className="btn" onClick={add}>Add cartons</button>
        {gaps.length > 0 && <p className="text-[13px] text-warn">{gaps.join(" · ")}</p>}
        {error && error.row == null && <p className="text-[13px] font-semibold text-bad" role="alert">{error.text}</p>}
        <button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save packing list"}</button>
      </div>
      <details className="howto border-t border-line px-4 py-3">
        <summary>How to fill this in</summary>
        <p>Write one row for each run of identical cartons: cartons 1 to 10 each with S 4, M 8, L 8, XL 4 of one style. Each carton holds one style. Weights are for one carton, in kg. The list should add up to the pieces in this lot; a line above Save says when it doesn&apos;t.</p>
      </details>
    </section>
  );
}
