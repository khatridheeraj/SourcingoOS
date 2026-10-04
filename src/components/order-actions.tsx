"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLiveStatus, saveStyleNote, setCheckpoint, unlockOrder } from "@/app/(app)/orders/actions";
import { useFeedback } from "@/components/feedback";
import { TNA_LABEL, type TnaStatus } from "@/lib/model";

export function CheckpointSelect({ id, value, label, disabled }: { id: string; value: TnaStatus; label: string; disabled?: boolean }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  return (
    <select
      className="inp"
      style={{ minWidth: 130 }}
      aria-label={`${label} status`}
      value={v}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value as TnaStatus;
        const before = v;
        setV(next);
        start(async () => {
          const r = await setCheckpoint(id, next);
          if (r.error) { setV(before); toast(r.error, "bad"); } else toast(`${label}: ${TNA_LABEL[next]}`);
        });
      }}
    >
      {(Object.keys(TNA_LABEL) as TnaStatus[]).map((s) => <option key={s} value={s}>{TNA_LABEL[s]}</option>)}
    </select>
  );
}

export function StyleNote({ id, note }: { id: string; note: string }) {
  const { toast } = useFeedback();
  const [v, setV] = useState(note);
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field"><span>Internal note (not visible to factory or buyer)</span>
        <textarea className="inp" rows={2} value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <div>
        <button type="button" className="btn sm" disabled={pending || v === note} onClick={() => start(async () => {
          const r = await saveStyleNote(id, v);
          toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        })}>{pending ? "Saving…" : "Save note"}</button>
      </div>
    </div>
  );
}

export function LiveStatus({ id, merchDate, remarks }: { id: string; merchDate: string; remarks: string }) {
  const { toast } = useFeedback();
  const [m, setM] = useState(merchDate);
  const [r, setR] = useState(remarks);
  const [pending, start] = useTransition();
  return (
    <section className="panel">
      <h3>Live status</h3>
      <div className="fgrid">
        <label className="field"><span>Merchandiser predicted date</span><input type="date" className="inp" value={m} onChange={(e) => setM(e.target.value)} /></label>
        <label className="field" style={{ gridColumn: "span 2" }}><span>Current status remarks</span>
          <textarea className="inp" rows={2} value={r} onChange={(e) => setR(e.target.value)} placeholder="Fabric booked, lab dips awaited from mill" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn sm primary" disabled={pending || (m === merchDate && r === remarks)} onClick={() => start(async () => {
          const res = await saveLiveStatus(id, m, r);
          toast(res.error ?? res.ok ?? "", res.error ? "bad" : undefined);
        })}>{pending ? "Saving…" : "Save status"}</button>
      </div>
    </section>
  );
}

export function UnlockButton({ id }: { id: string }) {
  const { toast, confirm } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn" disabled={pending} onClick={async () => {
      if (!(await confirm(`Unlock the TNA for ${id}? It goes back to TNA review so styles and dates can be edited, and you'll need to lock it again.`, "Unlock TNA"))) return;
      start(async () => {
        const r = await unlockOrder(id);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (r.ok) router.refresh();
      });
    }}>Unlock TNA</button>
  );
}
