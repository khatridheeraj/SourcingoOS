"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markShipped } from "@/app/(app)/cleanup/actions";
import { saveLiveStatus, saveStyleNote, setCheckpoint, unlockOrder } from "@/app/(app)/orders/actions";
import { useFeedback } from "@/components/feedback";
import { DELAY_REASONS, type DelayReason, TNA_LABEL, type TnaStatus } from "@/lib/model";

// Status for one step. Picking Delayed asks why (reason and a note), so the
// delay shows up in alerts and the factory scorecard.
export function CheckpointSelect({ id, value, label, reason, note, disabled }: {
  id: string; value: TnaStatus; label: string; reason?: DelayReason | null; note?: string | null; disabled?: boolean;
}) {
  const { toast } = useFeedback();
  const [v, setV] = useState(value);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState<string>(reason ?? "");
  const [text, setText] = useState(note ?? "");
  const [pending, start] = useTransition();
  const save = (next: TnaStatus, r = "", n = "") => {
    const before = v;
    setV(next);
    start(async () => {
      const res = await setCheckpoint(id, next, n, r);
      if (res.error) { setV(before); toast(res.error, "bad"); return; }
      setAsking(false);
      toast(`${label}: ${TNA_LABEL[next]}`);
    });
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <select
        className="inp"
        style={{ minWidth: 130 }}
        aria-label={`${label} status`}
        value={asking ? "delayed" : v}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value as TnaStatus;
          if (next === "delayed") setAsking(true);
          else { setAsking(false); save(next); }
        }}
      >
        {(Object.keys(TNA_LABEL) as TnaStatus[]).map((s) => <option key={s} value={s}>{TNA_LABEL[s]}</option>)}
      </select>
      {asking && (
        <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); save("delayed", why, text); }}>
          <select className="inp" aria-label="Why is it delayed?" value={why} onChange={(e) => setWhy(e.target.value)}>
            <option value="">Why? (pick a reason)</option>
            {DELAY_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input className="inp" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Note, new expected date" aria-label="Delay note" />
          <div className="row">
            <button className="btn sm primary" disabled={pending}>Save delay</button>
            <button type="button" className="btn sm" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
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

// For orders that left without a challan in the app (shipped before it existed,
// or shipped direct from the factory).
export function MarkShippedButton({ id }: { id: string }) {
  const { toast, prompt } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn" disabled={pending} onClick={async () => {
      const note = await prompt(`Mark ${id} as shipped? Add a note for the record (how and when it shipped).`, "Shipped direct from factory on 2 Oct", "Mark shipped");
      if (note === null) return;
      start(async () => {
        const r = await markShipped([id], note);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (!r.error) router.refresh();
      });
    }}>Mark shipped</button>
  );
}
