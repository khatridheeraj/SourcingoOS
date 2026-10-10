"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, daysBetween, DEFAULT_BUFFER_DAYS, planDueAt, PLAN_HOURS, TNA_STEPS } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { releaseFactoryPo, requestPlan, saveLineStages, setStylePhoto, type LineStageInput } from "../actions";

export type StyleRow = { id: string; style: string; colour: string; qty: number; photoUrl: string | null; hasRate: boolean };
export type FactoryGroup = {
  factoryId: string | null;
  factoryName: string;
  planRequestedOn: string;
  planRequestedAt: string;
  bufferDays: number | null;
  target: string;
  factorySentAt: string;
  releasedAt: string;
  lines: StyleRow[];
};
export type StepQc = { result: string; checkedOn: string; kind: string };
type Cell = { planned_on: string; done_on: string; not_needed: boolean };
type FactoryDates = Record<string, string>;
type Dates = Record<string, Cell>;

const blank: Cell = { planned_on: "", done_on: "", not_needed: false };
const key = (lineId: string, stage: string) => `${lineId}:${stage}`;
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const same = (a: Cell, b: Cell) => a.planned_on === b.planned_on && a.done_on === b.done_on && a.not_needed === b.not_needed;

// Where a step stands against its TNA date.
function verdict(c: Cell, today: string): { text: string; cls: string } | null {
  if (c.not_needed) return null;
  if (c.done_on) {
    if (c.planned_on && c.done_on > c.planned_on) return { text: `Done ${plural(daysBetween(c.planned_on, c.done_on))} late`, cls: "bad" };
    return { text: "Done", cls: "ok" };
  }
  if (!c.planned_on) return null;
  if (c.planned_on < today) return { text: `Overdue ${plural(daysBetween(c.planned_on, today))}`, cls: "bad" };
  const left = daysBetween(today, c.planned_on);
  return left <= 3 ? { text: left === 0 ? "Due today" : `Due in ${plural(left)}`, cls: "warn" } : null;
}

// The full TNA of every style, grouped by factory. A factory's plan is asked for and entered first;
// its PO is released only once nothing is missing, and actual dates are entered after that.
export function OrderStyles({ orderId, orderNo, companyId, open, canEdit, canDone, today, now, dueDate, groups, initial, factoryDates, qc }: {
  orderId: string;
  orderNo: string;
  companyId: string;
  open: boolean;
  canEdit: boolean;
  canDone: boolean;
  today: string;
  now: string;
  dueDate: string;
  groups: FactoryGroup[];
  initial: Dates;
  factoryDates: FactoryDates;
  qc: Record<string, StepQc>;
}) {
  const router = useRouter();
  const [dates, setDates] = useState<Dates>(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [buffers, setBuffers] = useState<Record<string, string>>(
    Object.fromEntries(groups.filter((g) => g.factoryId).map((g) => [g.factoryId!, String(g.bufferDays ?? DEFAULT_BUFFER_DAYS)])));
  const [pending, start] = useTransition();
  const editable = open && canEdit;
  const doneEditable = open && canDone;
  const lines = groups.flatMap((g) => g.lines);

  const get = (lineId: string, stage: string) => dates[key(lineId, stage)] ?? blank;
  const set = (lineId: string, stage: string, patch: Partial<Cell>) => {
    setDates((d) => {
      const next = { ...(d[key(lineId, stage)] ?? blank), ...patch };
      if (next.not_needed) Object.assign(next, { planned_on: "", done_on: "" });
      return { ...d, [key(lineId, stage)]: next };
    });
    setNotice("");
  };
  const changed: LineStageInput[] = lines.flatMap((l) => TNA_STEPS.map((s) => ({ line_id: l.id, stage: s.key, ...get(l.id, s.key) })))
    .filter((r) => !same(initial[key(r.line_id, r.stage)] ?? blank, r));
  const unsaved = (g: FactoryGroup) => changed.some((r) => g.lines.some((l) => l.id === r.line_id));

  // What still stops a factory's PO from being released, by style.
  const missing = (g: FactoryGroup) => g.lines.map((l) => {
    const open = TNA_STEPS.filter((s) => !get(l.id, s.key).not_needed);
    const noFactory = open.filter((s) => !factoryDates[key(l.id, s.key)]).map((s) => s.label);
    const noPlan = open.filter((s) => !get(l.id, s.key).planned_on).map((s) => s.label);
    const gaps = [
      ...(l.hasRate ? [] : ["factory rate"]),
      ...(noFactory.length ? [`factory dates (${noFactory.length === open.length ? "all steps" : noFactory.join(", ")})`] : []),
      ...(noPlan.length ? [`plan (${noPlan.length === open.length ? "all steps" : noPlan.join(", ")})`] : []),
    ];
    return gaps.length ? `${l.style}: ${gaps.join("; ")}` : "";
  }).filter(Boolean);

  const late = lines.filter((l) => TNA_STEPS.some((s) => verdict(get(l.id, s.key), today)?.cls === "bad")).length;

  function copyPlan(g: FactoryGroup) {
    const first = g.lines[0];
    setDates((d) => {
      const next = { ...d };
      for (const l of g.lines.slice(1)) for (const s of TNA_STEPS) {
        const from = d[key(first.id, s.key)] ?? blank;
        const to = next[key(l.id, s.key)] ?? blank;
        next[key(l.id, s.key)] = { ...to, planned_on: from.planned_on, not_needed: from.not_needed, done_on: from.not_needed ? "" : to.done_on };
      }
      return next;
    });
    setNotice("");
  }

  function run(label: string, job: () => Promise<{ error?: string }>, done: string) {
    setError("");
    setNotice("");
    setBusy(label);
    start(async () => {
      const res = await job();
      setBusy("");
      if (res.error) return setError(res.error);
      setNotice(done);
      router.refresh();
    });
  }

  async function copyRequest(g: FactoryGroup) {
    const text = [
      `Please enter your TNA for order ${orderNo} in your Sourcingo factory panel${g.planRequestedAt ? ` by ${at.format(planDueAt(g.planRequestedAt))}` : ` within ${PLAN_HOURS} hours`}. We release the PO only after that.`,
      `Styles: ${g.lines.map((l) => `${l.style}${l.colour ? ` (${l.colour})` : ""}, ${l.qty} pcs`).join("; ")}.`,
      g.target ? `Every date must be on or before ${day(g.target)}.` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Request message copied. Paste it to the factory.");
    } catch {
      setError("Couldn't copy. Your browser blocked the clipboard.");
    }
  }

  function photo(lineId: string, list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setError("");
    setBusy(`photo:${lineId}`);
    start(async () => {
      try {
        const [path] = await uploadPhotos(`${companyId}/${orderId}/styles/${lineId}`, [file]);
        const res = await setStylePhoto(orderId, lineId, path);
        if (res.error) setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photo didn't upload.");
      } finally {
        setBusy("");
      }
      router.refresh();
    });
  }

  return (
    <section className="panel">
      <div className="row mb-1">
        <h2 className="font-bold text-base">TNA by style</h2>
        {late > 0 && <span className="chip bad">{late} {late === 1 ? "style" : "styles"} behind plan</span>}
      </div>
      <p className="muted mb-3 text-[13px]">
        The factory enters its own date for every step in its factory panel; you enter the plan date, or mark a step not needed.
        The PO can be released once both are in. After release the orders team and Quality enter done dates. Quality&apos;s latest result shows under each step it checks.
      </p>

      {groups.map((g) => {
        const gaps = missing(g);
        const released = !!g.releasedAt;
        const dueAt = g.planRequestedAt ? planDueAt(g.planRequestedAt) : null;
        const critical = !released && !g.factorySentAt && !!dueAt && dueAt.getTime() < Date.parse(now);
        const status = !g.factoryId ? { text: "No factory chosen", cls: "warn" }
          : released ? { text: `PO released ${day(g.releasedAt.slice(0, 10))}`, cls: "ok" }
          : !gaps.length ? { text: "Plan complete, ready to release", cls: "info" }
          : critical ? { text: `Critical: no TNA from the factory, due ${at.format(dueAt!)}`, cls: "bad" }
          : g.factorySentAt ? { text: `Factory sent its TNA ${day(g.factorySentAt.slice(0, 10))}`, cls: "warn" }
          : dueAt ? { text: `Waiting for the factory's TNA, due ${at.format(dueAt)}`, cls: "warn" }
          : { text: "Plan not requested", cls: "bad" };
        const buffer = g.factoryId ? buffers[g.factoryId] ?? "" : "";
        const bufferOk = /^\d{1,2}$/.test(buffer) && Number(buffer) <= 90;
        const target = released || !g.factoryId ? g.target : dueDate && bufferOk ? addDays(dueDate, -Number(buffer)) : g.target;
        return (
          <div key={g.factoryId ?? "none"} className="mb-5" data-factory={g.factoryName}>
            <div className="row mb-2">
              <h3 className="font-bold text-[14px]">{g.factoryName}</h3>
              <span className={`chip ${status.cls}`}>{status.text}</span>
              {editable && g.factoryId && !released && (
                <>
                  <button type="button" className="btn" disabled={pending} onClick={() => copyRequest(g)}>Copy plan request</button>
                  <label className="row gap-1.5 text-[13px]">Buffer
                    <input className="inp w-16" inputMode="numeric" value={buffer} aria-label={`Buffer days for ${g.factoryName}`}
                      onChange={(e) => setBuffers((b) => ({ ...b, [g.factoryId!]: e.target.value.replace(/\D/g, "") }))} />
                    days
                  </label>
                  <button type="button" className="btn" disabled={pending || !bufferOk}
                    onClick={() => run(`req:${g.factoryId}`, () => requestPlan(orderId, g.factoryId!, Number(buffer)),
                      `Asked ${g.factoryName} for its TNA. It has ${PLAN_HOURS} hours to send it in its factory panel.`)}>
                    {busy === `req:${g.factoryId}` ? "Saving…" : g.planRequestedAt || g.planRequestedOn ? "Ask again (restart 24 hours)" : "Ask factory for plan"}
                  </button>
                  <button type="button" className="btn primary" disabled={pending || gaps.length > 0 || unsaved(g)}
                    title={unsaved(g) ? "Save the dates first" : gaps.length ? "The plan is not complete yet" : undefined}
                    onClick={() => run(`rel:${g.factoryId}`, () => releaseFactoryPo(orderId, g.factoryId!), `PO released to ${g.factoryName}.`)}>
                    {busy === `rel:${g.factoryId}` ? "Releasing…" : "Release PO"}
                  </button>
                </>
              )}
            </div>
            {!g.factoryId && <p className="muted mb-2 text-[13px]">Choose a factory for these styles in the order below before planning them.</p>}
            {g.factoryId && target && (
              <p className="muted mb-2 text-[13px]">
                Target date <b className="text-foreground">{day(target)}</b>: every factory and plan date must be on or before it
                {dueDate && ` (PO delivery ${day(dueDate)} less ${released || !bufferOk ? g.bufferDays ?? 0 : buffer} days buffer)`}.
              </p>
            )}
            {critical && (
              <p className="errbox mb-2" role="status">
                {g.factoryName} hasn&apos;t sent its TNA within {PLAN_HOURS} hours. Chase them now, or move these styles to another factory in the order below.
              </p>
            )}
            {g.factoryId && !released && gaps.length > 0 && (
              <p className="mb-2 text-[13px] text-warn"><b>Missing before release:</b> {gaps.join("; ")}</p>
            )}
            <div className="table-wrap">
              <table className="tbl tna">
                <thead>
                  <tr>
                    <th>Style</th>
                    {TNA_STEPS.map((s) => {
                      const q = qc[s.key];
                      return (
                        <th key={s.key}>
                          {s.label}
                          {q && <div><span className={`chip ${q.result === "pass" ? "ok" : q.result === "fail" ? "bad" : "warn"}`}>
                            QC {q.result} {day(q.checkedOn)}</span></div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l) => (
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
                                {busy === `photo:${l.id}` ? "Uploading…" : l.photoUrl ? "Change" : "Add photo"}
                                <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for ${l.style}`}
                                  onChange={(e) => { photo(l.id, e.target.files); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                          <div className="min-w-0">
                            <b className="code">{l.style}</b>
                            <div className="muted text-xs">{[l.colour, `${l.qty} pcs`].filter(Boolean).join(" · ")}</div>
                          </div>
                        </div>
                      </td>
                      {TNA_STEPS.map((s) => {
                        const c = get(l.id, s.key);
                        const v = verdict(c, today);
                        return (
                          <td key={s.key} className={`tna-cell ${v?.cls ?? ""} ${c.not_needed ? "opacity-60" : ""}`}>
                            {!c.not_needed && (
                              <>
                                <div className="text-[11.5px]"><span className="muted">Factory </span>
                                  <b data-testid={`${l.style} ${s.label} factory`}>{factoryDates[key(l.id, s.key)] ? day(factoryDates[key(l.id, s.key)]) : "not given"}</b>
                                </div>
                                <label><span>Plan</span>
                                  <input className="inp" type="date" value={c.planned_on} max={target || undefined} disabled={!editable} aria-label={`${l.style} ${s.label} plan`}
                                    onChange={(e) => set(l.id, s.key, { planned_on: e.target.value })} />
                                </label>
                                <label><span>Done</span>
                                  <input className="inp" type="date" value={c.done_on} max={today} disabled={!doneEditable || !released}
                                    title={!released ? "Release the factory PO first" : undefined} aria-label={`${l.style} ${s.label} done`}
                                    onChange={(e) => set(l.id, s.key, { done_on: e.target.value })} />
                                </label>
                              </>
                            )}
                            {s.required ? <span className="block text-[11px] text-muted">Required</span> : (
                              <label className="nn">
                                <input type="checkbox" checked={c.not_needed} disabled={!editable || !!c.done_on} aria-label={`${l.style} ${s.label} not needed`}
                                  onChange={(e) => set(l.id, s.key, { not_needed: e.target.checked })} />
                                Not needed
                              </label>
                            )}
                            {v && <small>{v.text}</small>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && g.lines.length > 1 && (
              <button type="button" className="btn mt-2" disabled={pending} onClick={() => copyPlan(g)}>
                Copy {g.lines[0].style}&apos;s plan to {g.factoryName}&apos;s other styles
              </button>
            )}
          </div>
        );
      })}

      {doneEditable && (
        <div className="row mt-1">
          <button type="button" className="btn primary" disabled={pending || !changed.length}
            onClick={() => run("save", () => saveLineStages(orderId, changed), "Saved")}>
            {busy === "save" ? "Saving…" : "Save TNA dates"}
          </button>
          {changed.length > 0 && <span className="muted text-[13px]">Unsaved changes</span>}
        </div>
      )}
      {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      {notice && !error && <p className="mt-3 text-[13px] font-semibold text-ok">{notice}</p>}
    </section>
  );
}
