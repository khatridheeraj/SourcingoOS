"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { KNOWN_CARRIERS, MODE_LABEL, MODES, NO_LABEL, stageLabel, stagesFor, type Mode, type Stage } from "@/lib/tracking";
import { addTrackEvent, saveTracking, takeBackTrackEvent } from "../../actions";

// How the part travels. Opens by itself until a mode is set.
export function TrackDetails({ id, mode, carrier, no, to, eta, shippedOn }: {
  id: string; mode: Mode | null; carrier: string | null; no: string | null; to: string | null; eta: string | null; shippedOn: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!mode);
  const [f, setF] = useState({ mode: mode ?? "road", carrier: carrier ?? "", no: no ?? "", to: to ?? "", eta: eta ?? "" });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!open) return <button type="button" className="btn sm" onClick={() => setOpen(true)}>Edit</button>;
  return (
    <form className="trk-form" onSubmit={(e) => {
      e.preventDefault();
      setError("");
      start(async () => {
        const r = await saveTracking(id, f);
        if (r.error) return setError(r.error);
        toast("Tracking saved.");
        setOpen(false);
        router.refresh();
      });
    }}>
      <div className="trk-grid">
        <label className="field"><span>How it travels</span>
          <select className="inp" value={f.mode} onChange={(e) => set("mode", e.target.value)}>
            {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="field"><span>Carrier</span>
          <input className="inp" list="trk-carriers" maxLength={60} value={f.carrier} placeholder="e.g. Maersk, DHL, VRL" onChange={(e) => set("carrier", e.target.value)} />
          <datalist id="trk-carriers">{KNOWN_CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="field"><span>{NO_LABEL[f.mode as Mode]}</span>
          <input className="inp code" maxLength={60} value={f.no} onChange={(e) => set("no", e.target.value)} />
        </label>
        <label className="field"><span>Going to</span>
          <input className="inp" maxLength={80} value={f.to} placeholder="City, port or warehouse" onChange={(e) => set("to", e.target.value)} />
        </label>
        <label className="field"><span>Expected to arrive</span>
          <input className="inp" type="date" min={shippedOn} value={f.eta} onChange={(e) => set("eta", e.target.value)} />
        </label>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save tracking"}</button>
        {mode && <button type="button" className="btn ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>}
      </div>
    </form>
  );
}

// One update: where the goods are now, the day, and a place or note.
export function AddUpdate({ id, mode, next, today, shippedOn }: { id: string; mode: Mode | null; next: Stage; today: string; shippedOn: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(next);
  const [on, setOn] = useState(today);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form className="trk-form" onSubmit={(e) => {
      e.preventDefault();
      setError("");
      start(async () => {
        const r = await addTrackEvent(id, stage, on, place, note);
        if (r.error) return setError(r.error);
        toast(`${stageLabel(stage, mode)} recorded.`);
        setPlace(""); setNote("");
        router.refresh();
      });
    }}>
      <div className="trk-grid">
        <label className="field"><span>Where the goods are</span>
          <select className="inp" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {stagesFor(mode).filter((s) => s !== "shipped").map((s) => <option key={s} value={s}>{stageLabel(s, mode)}</option>)}
          </select>
        </label>
        <label className="field"><span>On</span><input className="inp" type="date" min={shippedOn} max={today} value={on} onChange={(e) => setOn(e.target.value)} /></label>
        <label className="field"><span>Place</span><input className="inp" maxLength={80} value={place} placeholder="e.g. Nhava Sheva" onChange={(e) => setPlace(e.target.value)} /></label>
        <label className="field"><span>Note</span><input className="inp" maxLength={300} value={note} placeholder="e.g. vessel name, delay reason" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {error && <div className="errbox" role="alert">{error}</div>}
      <button className="btn primary trk-save" disabled={pending}>{pending ? "Saving…" : "Add update"}</button>
    </form>
  );
}

export function TakeBackUpdate({ id, eventId }: { id: string; eventId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="row gap-1.5">
      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => start(async () => {
        const r = await takeBackTrackEvent(id, eventId);
        if (r.error) return setError(r.error);
        toast("Update taken back.");
        router.refresh();
      })}>{pending ? "Taking back…" : "Take back"}</button>
      {error && <small className="text-bad" role="alert">{error}</small>}
    </span>
  );
}
