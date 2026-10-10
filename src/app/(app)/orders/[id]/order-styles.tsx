"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { daysBetween, STAGES, stageLabel } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { saveLineStages, setStylePhoto, type LineStageInput } from "../actions";

export type StyleRow = { id: string; style: string; colour: string; qty: number; photoUrl: string | null };
type Dates = Record<string, { planned_on: string; done_on: string }>;

const key = (lineId: string, stage: string) => `${lineId}:${stage}`;
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

// Where a stage stands against its TNA date.
function verdict(plan: string, done: string, today: string): { text: string; cls: string } | null {
  if (done) {
    if (plan && done > plan) return { text: `Done ${plural(daysBetween(plan, done))} late`, cls: "bad" };
    return { text: "Done", cls: "ok" };
  }
  if (!plan) return null;
  if (plan < today) return { text: `Overdue ${plural(daysBetween(plan, today))}`, cls: "bad" };
  const left = daysBetween(today, plan);
  return left <= 3 ? { text: left === 0 ? "Due today" : `Due in ${plural(left)}`, cls: "warn" } : null;
}

// Each style's stages with the planned (TNA) date and the actual date, side by side, and the style's photo.
export function OrderStyles({ orderId, companyId, open, canEdit, today, lines, initial }: {
  orderId: string;
  companyId: string;
  open: boolean;
  canEdit: boolean;
  today: string;
  lines: StyleRow[];
  initial: Dates;
}) {
  const router = useRouter();
  const blank = { planned_on: "", done_on: "" };
  const [dates, setDates] = useState<Dates>(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState("");
  const [pending, start] = useTransition();
  const editable = open && canEdit;

  const get = (lineId: string, stage: string) => dates[key(lineId, stage)] ?? blank;
  const set = (lineId: string, stage: string, field: "planned_on" | "done_on", v: string) => {
    setDates((d) => ({ ...d, [key(lineId, stage)]: { ...(d[key(lineId, stage)] ?? blank), [field]: v } }));
    setSaved(false);
  };
  const changed: LineStageInput[] = lines.flatMap((l) => STAGES.map((s) => ({ line_id: l.id, stage: s.key, ...get(l.id, s.key) })))
    .filter((r) => {
      const was = initial[key(r.line_id, r.stage)] ?? blank;
      return was.planned_on !== r.planned_on || was.done_on !== r.done_on;
    });

  // A style's latest finished stage.
  const lastDone = (lineId: string) => [...STAGES].reverse().find((s) => get(lineId, s.key).done_on)?.key ?? null;
  const late = lines.filter((l) => STAGES.some((s) => verdict(get(l.id, s.key).planned_on, get(l.id, s.key).done_on, today)?.cls === "bad")).length;

  function copyPlan() {
    const first = lines[0];
    setDates((d) => {
      const next = { ...d };
      for (const l of lines.slice(1)) for (const s of STAGES) {
        next[key(l.id, s.key)] = { ...(next[key(l.id, s.key)] ?? blank), planned_on: (d[key(first.id, s.key)] ?? blank).planned_on };
      }
      return next;
    });
    setSaved(false);
  }

  function save() {
    setError("");
    start(async () => {
      const res = await saveLineStages(orderId, changed);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  function photo(lineId: string, list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError("");
    setUploading(lineId);
    start(async () => {
      try {
        const [path] = await uploadPhotos(`${companyId}/${orderId}/styles/${lineId}`, [file]);
        const res = await setStylePhoto(orderId, lineId, path);
        if (res.error) setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photo didn't upload.");
      } finally {
        setUploading("");
      }
      router.refresh();
    });
  }

  return (
    <section className="panel">
      <div className="row mb-1">
        <h2 className="font-bold text-base">Production by style</h2>
        {late > 0 && <span className="chip bad">{late} {late === 1 ? "style" : "styles"} behind plan</span>}
      </div>
      <p className="muted mb-3 text-[13px]">Plan is the TNA date. Done is the day the stage actually finished. The order&apos;s stage follows its slowest style.</p>

      <div className="table-wrap">
        <table className="tbl tna">
          <thead>
            <tr><th>Style</th>{STAGES.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="tna-style">
                  <div className="flex items-start gap-2.5">
                    <div className="shrink-0">
                      {l.photoUrl ? (
                        <a href={l.photoUrl} target="_blank" rel="noreferrer" aria-label={`Photo of ${l.style}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                          <img src={l.photoUrl} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />
                        </a>
                      ) : (
                        <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-[11px] text-muted">No photo</div>
                      )}
                      {editable && (
                        <label className={`link mt-1 block text-center text-xs ${pending ? "pointer-events-none opacity-50" : ""}`}>
                          {uploading === l.id ? "Uploading…" : l.photoUrl ? "Change" : "Add photo"}
                          <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for ${l.style}`}
                            onChange={(e) => { photo(l.id, e.target.files); e.target.value = ""; }} />
                        </label>
                      )}
                    </div>
                    <div className="min-w-0">
                      <b className="code">{l.style}</b>
                      <div className="muted text-xs">{[l.colour, `${l.qty} pcs`].filter(Boolean).join(" · ")}</div>
                      <span className="chip mt-1">{lastDone(l.id) ? `${stageLabel(lastDone(l.id))} done` : "Not started"}</span>
                    </div>
                  </div>
                </td>
                {STAGES.map((s) => {
                  const d = get(l.id, s.key);
                  const v = verdict(d.planned_on, d.done_on, today);
                  return (
                    <td key={s.key} className={`tna-cell ${v?.cls ?? ""}`}>
                      <label><span>Plan</span>
                        <input className="inp" type="date" value={d.planned_on} disabled={!editable} aria-label={`${l.style} ${s.label} plan`}
                          onChange={(e) => set(l.id, s.key, "planned_on", e.target.value)} />
                      </label>
                      <label><span>Done</span>
                        <input className="inp" type="date" value={d.done_on} max={today} disabled={!editable} aria-label={`${l.style} ${s.label} done`}
                          onChange={(e) => set(l.id, s.key, "done_on", e.target.value)} />
                      </label>
                      {v && <small>{v.text}</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="row mt-3">
          <button type="button" className="btn primary" disabled={pending || !changed.length} onClick={save}>
            {pending && !uploading ? "Saving…" : "Save style dates"}
          </button>
          {lines.length > 1 && <button type="button" className="btn" disabled={pending} onClick={copyPlan}>Copy {lines[0].style}&apos;s plan to all styles</button>}
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {saved && !error && !changed.length && <span className="text-[13px] font-semibold text-ok">Saved</span>}
        </div>
      )}
      {!editable && error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
