"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { COMMON_DEFECTS, type Defect, defectLine, defectMessage, SEVERITY, type Severity } from "@/lib/defects";
import { saveQcDefects } from "../actions";

type Row = { defect: string; pieces: string; severity: Severity };
const blank = (): Row => ({ defect: "", pieces: "", severity: "major" });

// A check's defect list: which defects, how many pieces, how serious. Quality writes it; everyone reads it, and a
// failed check's list goes to the factory on WhatsApp so it knows what to fix before the re-check.
export function QcDefects({ orderId, qcId, list, can, failed, message }: {
  orderId: string; qcId: string; list: Defect[]; can: boolean; failed: boolean;
  message: { order: string; style: string; kind: string; on: string; checked: number | null; notes: string | null };
}) {
  const router = useRouter();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const open = () => {
    setRows(list.length ? list.map((d) => ({ defect: d.defect, pieces: String(d.pieces), severity: d.severity })) : [blank(), blank()]);
    setError("");
    setEditing(true);
  };
  const set = (i: number, k: keyof Row, v: string) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r))); if (error) setError(""); };
  const save = () => start(async () => {
    const r = await saveQcDefects(orderId, qcId, rows);
    if (r.error) { setError(r.error); return; }
    setEditing(false);
    toast("Defect list saved");
    router.refresh();
  });
  const text = list.length ? defectMessage({ ...message, list }) : "";

  if (editing) {
    return (
      <div className="qc-defects edit">
        <b className="text-[13px]">Defects found</b>
        <datalist id={`${ids}-d`}>{COMMON_DEFECTS.map((d) => <option key={d} value={d} />)}</datalist>
        <ul className="def-rows">
          {rows.map((r, i) => (
            <li key={i} className="def-row">
              <input className="inp" list={`${ids}-d`} value={r.defect} maxLength={80} placeholder="e.g. Open seam" aria-label={`Defect ${i + 1}`} onChange={(e) => set(i, "defect", e.target.value)} />
              <input className="inp num" inputMode="numeric" value={r.pieces} placeholder="Pcs" aria-label={`Pieces with defect ${i + 1}`} onChange={(e) => set(i, "pieces", e.target.value)} />
              <select className="inp" value={r.severity} aria-label={`How serious is defect ${i + 1}`} onChange={(e) => set(i, "severity", e.target.value)}>
                {(Object.keys(SEVERITY) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY[s]}</option>)}
              </select>
              <button type="button" className="btn sm ghost" aria-label={`Remove defect ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
        {error && <p className="text-xs text-bad" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="btn sm" onClick={() => setRows((rs) => [...rs, blank()])}>Add a defect</button>
          <button type="button" className="btn sm primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save list"}</button>
          <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  if (!list.length && !(can && failed)) return null;
  return (
    <div className="qc-defects">
      {list.length > 0 ? <span><b>Defects:</b> {defectLine(list)}</span> : <span className="text-warn">Which defects? Write the list so the factory knows what to fix.</span>}
      <span className="row">
        {can && <button type="button" className="btn sm ghost" onClick={open}>{list.length ? "Edit defects" : "Add defect list"}</button>}
        {failed && list.length > 0 && <a className="btn sm ghost" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Send to factory</a>}
      </span>
    </div>
  );
}
