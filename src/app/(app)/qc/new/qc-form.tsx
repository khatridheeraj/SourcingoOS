"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { COMMON_DEFECTS, nf, QC_KIND_LABEL, type QcDefect, type QcKind, qcJudge, qcSampleSize } from "@/lib/model";
import { saveQc } from "../actions";

export type QcOrder = { id: string; label: string; styles: { id: string; label: string; qty: number }[] };

// Built for a phone on the factory floor: big +/− counters, live verdict.
export function QcForm({ orders, today, initial }: { orders: QcOrder[]; today: string; initial: { so: string; style: string; kind: QcKind } }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [so, setSo] = useState(initial.so || orders[0]?.id || "");
  const order = orders.find((o) => o.id === so);
  const [style, setStyle] = useState(initial.style || order?.styles[0]?.id || "");
  const st = order?.styles.find((s) => s.id === style);
  const [kind, setKind] = useState<QcKind>(initial.kind);
  const [date, setDate] = useState(today);
  const [lot, setLot] = useState(String(st?.qty ?? ""));
  const [sample, setSample] = useState(st ? String(qcSampleSize(st.qty)) : "");
  const [sampleTouched, setSampleTouched] = useState(false);
  const [aqlMajor, setAqlMajor] = useState(2.5);
  const [aqlMinor, setAqlMinor] = useState(4.0);
  const [defects, setDefects] = useState<QcDefect[]>(COMMON_DEFECTS.map((d) => ({ ...d, count: 0 })));
  const [custom, setCustom] = useState("");
  const [meas, setMeas] = useState<boolean | null>(null);
  const [pack, setPack] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const pickStyle = (sid: string, ord = order) => {
    setStyle(sid);
    const s = ord?.styles.find((x) => x.id === sid);
    if (s) { setLot(String(s.qty)); if (!sampleTouched) setSample(String(qcSampleSize(s.qty))); }
  };
  const lotN = Number(lot) || 0;
  const sampleN = Number(sample) || 0;
  const v = useMemo(() => qcJudge({ sample_size: sampleN, aql_major: aqlMajor, aql_minor: aqlMinor, defects, measurements_ok: meas, packing_ok: pack }),
    [sampleN, aqlMajor, aqlMinor, defects, meas, pack]);
  const bump = (i: number, by: number) => setDefects((d) => d.map((x, j) => (j === i ? { ...x, count: Math.max(0, x.count + by) } : x)));

  const yesNo = (label: string, val: boolean | null, set: (v: boolean | null) => void) => (
    <div className="field"><span>{label}</span>
      <div className="seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <button type="button" className={val === true ? "on completed" : ""} onClick={() => set(true)}>OK</button>
        <button type="button" className={val === false ? "on delayed" : ""} onClick={() => set(false)}>Not OK</button>
        <button type="button" className={val === null ? "on" : ""} onClick={() => set(null)}>Not checked</button>
      </div>
    </div>
  );

  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveQc({ so_id: so, style_id: style, kind, inspected_on: date, lot_qty: lotN, sample_size: sampleN, aql_major: aqlMajor, aql_minor: aqlMinor, defects, measurements_ok: meas, packing_ok: pack, notes });
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (r.id) router.push(`/qc/${r.id}?new=1`);
      });
    }}>
      <section className="panel">
        <div className="fgrid">
          <label className="field"><span>Order <i>*</i></span>
            <select className="inp" value={so} onChange={(e) => { setSo(e.target.value); const o = orders.find((x) => x.id === e.target.value); pickStyle(o?.styles[0]?.id ?? "", o); }}>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Style <i>*</i></span>
            <select className="inp" value={style} onChange={(e) => pickStyle(e.target.value)}>
              {order?.styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Inspection date</span><input type="date" className="inp" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="mt-3 seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="group" aria-label="Kind of inspection">
          {(Object.keys(QC_KIND_LABEL) as QcKind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "on in_progress" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{QC_KIND_LABEL[k]}</button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Lot and sample</h3>
        <div className="fgrid">
          <label className="field"><span>Pieces offered (lot)</span>
            <input type="number" inputMode="numeric" min={1} className="inp" value={lot} onChange={(e) => { setLot(e.target.value); if (!sampleTouched) setSample(String(qcSampleSize(Number(e.target.value) || 0))); }} />
          </label>
          <label className="field"><span>Pieces checked (sample)</span>
            <input type="number" inputMode="numeric" min={1} className="inp" value={sample} onChange={(e) => { setSample(e.target.value); setSampleTouched(true); }} />
            <small>AQL level II suggests {nf(qcSampleSize(lotN))} for {nf(lotN)} pieces.</small>
          </label>
          <label className="field"><span>AQL major</span>
            <select className="inp" value={aqlMajor} onChange={(e) => setAqlMajor(Number(e.target.value))}><option value={2.5}>2.5</option><option value={4}>4.0</option></select>
          </label>
          <label className="field"><span>AQL minor</span>
            <select className="inp" value={aqlMinor} onChange={(e) => setAqlMinor(Number(e.target.value))}><option value={2.5}>2.5</option><option value={4}>4.0</option></select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h3>Defects found</h3>
        <p className="-mt-2 mb-2 text-xs text-muted">Tap + for each defective piece. Critical means unsafe or unsellable: any one fails the lot.</p>
        <div>
          {defects.map((d, i) => (
            <div key={d.name + i} className="defect">
              <span><b className="text-[13.5px]">{d.name}</b></span>
              <select className={`sev ${d.severity}`} value={d.severity} aria-label={`${d.name} severity`}
                onChange={(e) => setDefects((x) => x.map((y, j) => (j === i ? { ...y, severity: e.target.value as QcDefect["severity"] } : y)))}>
                <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option>
              </select>
              <div className="counter">
                <button type="button" aria-label={`One less ${d.name}`} onClick={() => bump(i, -1)}>−</button>
                <output aria-live="polite">{d.count}</output>
                <button type="button" aria-label={`One more ${d.name}`} onClick={() => bump(i, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row mt-2">
          <input className="inp" style={{ maxWidth: 260 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Another defect" aria-label="Another defect" />
          <button type="button" className="btn sm" disabled={!custom.trim()} onClick={() => { setDefects((d) => [...d, { name: custom.trim(), severity: "major", count: 1 }]); setCustom(""); }}>+ Add</button>
        </div>
      </section>

      <section className="panel">
        <div className="fgrid">
          {yesNo("Measurements", meas, setMeas)}
          {yesNo("Packing and labels", pack, setPack)}
        </div>
        <label className="field mt-3"><span>Notes for the factory and team</span>
          <textarea className="inp" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Rework open seams on 12 pcs; re-check Thursday" />
        </label>
      </section>

      <div className="sticky-actions">
        <div className="grow">
          <div className={`verdict ${v.result}`} style={{ padding: "8px 12px" }}>
            {v.result === "pass" ? "Pass" : v.result === "fail" ? "Fail" : "On hold"} · critical {v.critical} · major {v.major}/{v.acMajor} · minor {v.minor}/{v.acMinor}
          </div>
        </div>
        <button className="btn primary" disabled={pending || !style || !sampleN || sampleN > lotN}>{pending ? "Saving…" : "Save inspection"}</button>
      </div>
    </form>
  );
}
