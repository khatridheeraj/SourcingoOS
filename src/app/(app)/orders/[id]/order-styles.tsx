"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, dayAt, daysBetween, DEFAULT_BUFFER_DAYS, planDueAt, PLAN_HOURS, qty, TNA_STEPS } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { toast } from "@/components/toast";
import { project, shipRisk, standardTargets } from "@/lib/tna-plan";
import { FactoryLink } from "../../factories/factory-link";
import { acceptTargetsForFactory, releaseFactoryPo, requestPlan, saveLineStages, setStylePhoto, type LineStageInput } from "../actions";

export type StyleRow = { id: string; style: string; colour: string; qty: number; photoUrl: string | null; hasRate: boolean };
export type FactoryGroup = {
  factoryId: string | null;
  factoryName: string;
  // The factory's own name and phone, for its WhatsApp link.
  factoryShort: string;
  factoryPhone: string | null;
  planRequestedOn: string;
  planRequestedAt: string;
  bufferDays: number | null;
  target: string;
  factorySentAt: string;
  // Who in the team entered the factory's dates for it ("" when the factory sent them itself).
  planEnteredBy: string;
  releasedAt: string;
  lines: StyleRow[];
};
export type StepQc = { result: string; checkedOn: string; kind: string };
export type ExtraStep = { stage: string; label: string };
type Step = { key: string; label: string; required?: boolean; extra?: boolean };
type Cell = { planned_on: string; done_on: string; not_needed: boolean };
type FactoryDates = Record<string, string>;
// The target at release and why the owner moved it since, keyed "line:step".
export type Baseline = { on: string; note: string };
type Dates = Record<string, Cell>;

const blank: Cell = { planned_on: "", done_on: "", not_needed: false };
const key = (lineId: string, stage: string) => `${lineId}:${stage}`;
const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "10 Sep" from YYYY-MM-DD, without the year (the order's dates sit within a few months).
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
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

// Every style as its own card with its full TNA, grouped by factory. A factory's plan is asked for and entered first;
// its PO is released only once nothing is missing, and actual dates are entered after that.
export function OrderStyles({ orderId, orderNo, companyId, open, canEdit, canDone, isOwner, today, now, dueDate, groups, initial, initialExtras, factoryDates, baselines, qc }: {
  orderId: string;
  orderNo: string;
  companyId: string;
  open: boolean;
  canEdit: boolean;
  canDone: boolean;
  // Only the owner moves a target once the factory PO is released, and says why.
  isOwner: boolean;
  today: string;
  now: string;
  dueDate: string;
  groups: FactoryGroup[];
  initial: Dates;
  initialExtras: Record<string, ExtraStep[]>;
  factoryDates: FactoryDates;
  baselines: Record<string, Baseline>;
  // Quality's latest result for each style's step, keyed "line:step".
  qc: Record<string, StepQc>;
}) {
  const router = useRouter();
  const [dates, setDates] = useState<Dates>(initial);
  const [extras, setExtras] = useState<Record<string, ExtraStep[]>>(initialExtras);
  const [newStep, setNewStep] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");
  const [buffers, setBuffers] = useState<Record<string, string>>(
    Object.fromEntries(groups.filter((g) => g.factoryId).map((g) => [g.factoryId!, String(g.bufferDays ?? DEFAULT_BUFFER_DAYS)])));
  const [pending, start] = useTransition();
  const editable = open && canEdit;
  const doneEditable = open && canDone;
  const lines = groups.flatMap((g) => g.lines);
  // Styles whose steps are open: a single style, or while planning the first style of each factory (its targets get copied).
  const [shown, setShown] = useState<Set<string>>(() => new Set(lines.length === 1 ? [lines[0].id]
    : open && canEdit ? groups.filter((g) => g.factoryId && !g.releasedAt).map((g) => g.lines[0].id) : []));

  const get = (lineId: string, stage: string) => dates[key(lineId, stage)] ?? blank;
  const set = (lineId: string, stage: string, patch: Partial<Cell>) => {
    setDates((d) => {
      const next = { ...(d[key(lineId, stage)] ?? blank), ...patch };
      if (next.not_needed) Object.assign(next, { planned_on: "", done_on: "" });
      return { ...d, [key(lineId, stage)]: next };
    });
    setNotice("");
  };
  // A style's steps: the standard ones, then its own extra steps (removed ones are kept as not needed).
  const allSteps = (lineId: string): Step[] => [...TNA_STEPS, ...(extras[lineId] ?? []).map((x) => ({ key: x.stage, label: x.label, extra: true }))];
  const steps = (lineId: string) => allSteps(lineId).filter((s) => !get(lineId, s.key).not_needed);
  const isNew = (lineId: string, stage: string) => !(initialExtras[lineId] ?? []).some((x) => x.stage === stage);
  // Each changed step goes with the values it had when the page loaded, so the database saves only what was changed here
  // and keeps a date someone else entered meanwhile.
  const changed: LineStageInput[] = lines.flatMap((l) => allSteps(l.id).map((s) => ({
    line_id: l.id, stage: s.key, ...get(l.id, s.key), ...(s.extra ? { label: s.label } : {}), was: initial[key(l.id, s.key)] ?? blank,
  }))).filter((r) => !same(r.was, r) || (r.label !== undefined && isNew(r.line_id, r.stage)));

  // Released styles whose set targets this save moves: the owner must give a reason.
  const releasedLine = (lineId: string) => groups.some((g) => !!g.releasedAt && g.lines.some((l) => l.id === lineId));
  const moved = changed.filter((r) => releasedLine(r.line_id) && !!initial[key(r.line_id, r.stage)]?.planned_on
    && (r.planned_on !== initial[key(r.line_id, r.stage)].planned_on || (r.not_needed && !initial[key(r.line_id, r.stage)].not_needed)));

  // Fills every empty target of a factory's styles with the standard days worked back from its target date.
  function fillTargets(g: FactoryGroup, target: string) {
    setDates((d) => {
      const next = { ...d };
      for (const l of g.lines) {
        const empty = TNA_STEPS.map((s) => s.key).filter((st) => { const c = d[key(l.id, st)] ?? blank; return !c.not_needed && !c.planned_on && !c.done_on; });
        const plan = standardTargets(empty, target, today);
        for (const [st, on] of Object.entries(plan)) next[key(l.id, st)] = { ...(d[key(l.id, st)] ?? blank), planned_on: on };
      }
      return next;
    });
    setError("");
    setNotice("Targets filled from the standard days. Check them, then save.");
  }

  function addExtra(lineId: string) {
    const label = (newStep[lineId] ?? "").trim().slice(0, 60);
    if (!label) return;
    if (allSteps(lineId).some((s) => s.label.toLowerCase() === label.toLowerCase() && !get(lineId, s.key).not_needed)) {
      return setError(`This style already has a step called ${label}.`);
    }
    const stage = `extra_${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    setExtras((x) => ({ ...x, [lineId]: [...(x[lineId] ?? []), { stage, label }] }));
    setNewStep((n) => ({ ...n, [lineId]: "" }));
    setError("");
    setNotice("");
  }
  const unsaved = (g: FactoryGroup) => changed.some((r) => g.lines.some((l) => l.id === r.line_id));

  const list = (all: Step[], some: Step[]) => (some.length === all.length ? "all steps" : some.map((s) => s.label).join(", "));
  // Targets the merchandiser still has to set before the factory can be asked, by style.
  const targetGaps = (g: FactoryGroup, target: string) => g.lines.map((l) => {
    const open = steps(l.id);
    const none = open.filter((s) => !get(l.id, s.key).planned_on);
    const after = target ? open.filter((s) => get(l.id, s.key).planned_on > target) : [];
    const gaps = [...(none.length ? [`target (${list(open, none)})`] : []), ...(after.length ? [`after the target date (${list(open, after)})`] : [])];
    return gaps.length ? `${l.style}: ${gaps.join("; ")}` : "";
  }).filter(Boolean);
  // What still stops a factory's PO from being released, by style.
  const missing = (g: FactoryGroup, target: string) => g.lines.map((l) => {
    const open = steps(l.id);
    const noTarget = open.filter((s) => !get(l.id, s.key).planned_on);
    const noFactory = open.filter((s) => !factoryDates[key(l.id, s.key)]);
    const later = open.filter((s) => factoryDates[key(l.id, s.key)] && get(l.id, s.key).planned_on && factoryDates[key(l.id, s.key)] > get(l.id, s.key).planned_on);
    const after = target ? open.filter((s) => get(l.id, s.key).planned_on > target) : [];
    const gaps = [
      ...(l.hasRate ? [] : ["factory rate"]),
      ...(noTarget.length ? [`target (${list(open, noTarget)})`] : []),
      ...(after.length ? [`target after the target date (${list(open, after)})`] : []),
      ...(noFactory.length ? [`factory dates (${list(open, noFactory)})`] : []),
      ...(later.length ? [`factory later than target (${list(open, later)})`] : []),
    ];
    return gaps.length ? `${l.style}: ${gaps.join("; ")}` : "";
  }).filter(Boolean);

  // Behind plan: a step still open past its target (a step done late is history, not behind).
  const late = lines.filter((l) => steps(l.id).some((s) => { const c = get(l.id, s.key); return !c.not_needed && !c.done_on && !!c.planned_on && c.planned_on < today; })).length;

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

  // One tap: the style's next step is done today.
  function doneToday(l: StyleRow, s: Step) {
    const c = get(l.id, s.key);
    setError("");
    setBusy(`done:${l.id}`);
    start(async () => {
      const res = await saveLineStages(orderId, [{ line_id: l.id, stage: s.key, planned_on: c.planned_on, done_on: today, not_needed: false, ...(s.extra ? { label: s.label } : {}) }]);
      setBusy("");
      if (res.error) {
        setError(res.error);
        toast(res.error, "bad");
        return;
      }
      toast(`${s.label} done for ${l.style}`);
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

  // One step of one style: its name and Quality's latest result, the factory's date, the target, the done date and where it stands.
  function stepRow(l: StyleRow, s: Step, released: boolean, target: string) {
    const c = get(l.id, s.key);
    const v = verdict(c, today);
    const f = factoryDates[key(l.id, s.key)];
    const q = qc[key(l.id, s.key)];
    const base = baselines[key(l.id, s.key)];
    const locked = released && !!initial[key(l.id, s.key)]?.planned_on && !isOwner;
    return (
      <li key={s.key} className={`step-row ${c.not_needed ? "off" : v?.cls ?? (c.planned_on ? "plan" : "")}`}>
        <div className="step-name">
          <i className="step-dot" aria-hidden />
          <b>{s.label}</b>
          {q && <span className={`chip ${q.result === "pass" ? "ok" : "bad"}`}>QC {q.result} {dm(q.checkedOn)}</span>}
          {s.extra && editable && !c.done_on && !locked && (
            <button type="button" className="link text-xs" aria-label={`Remove ${s.label} from ${l.style}`}
              onClick={() => set(l.id, s.key, { not_needed: true })}>Remove</button>
          )}
        </div>
        {c.not_needed ? <span className="step-off muted">Not needed</span> : (
          <>
            <div className="step-f"><span>Factory</span>
              <b data-testid={`${l.style} ${s.label} factory`} className={f && c.planned_on && f > c.planned_on ? "text-bad" : f ? "" : "muted font-normal"}>{f ? dm(f) : "Not given"}</b>
            </div>
            <label className="step-f"><span>Target</span>
              <input className="inp" type="date" value={c.planned_on} max={released ? undefined : target || undefined} disabled={!editable || locked}
                title={locked ? "Locked since the PO was released. Only the owner can move it, with a reason." : undefined}
                aria-label={`${l.style} ${s.label} target`}
                onChange={(e) => set(l.id, s.key, { planned_on: e.target.value })} />
              {base && base.on !== c.planned_on && (
                <small className="step-moved" title={base.note || undefined}>Was {dm(base.on)}{base.note ? `: ${base.note}` : ""}</small>
              )}
            </label>
            <label className="step-f"><span>Done</span>
              <input className="inp" type="date" value={c.done_on} max={today} disabled={!doneEditable || !released}
                title={!released ? "Release the factory PO first" : undefined} aria-label={`${l.style} ${s.label} done`}
                onChange={(e) => set(l.id, s.key, { done_on: e.target.value })} />
            </label>
          </>
        )}
        <div className="step-state">
          {c.not_needed ? "" : v?.text ?? (c.planned_on ? `By ${dm(c.planned_on)}` : "No target")}
          {!s.extra && !s.required && (
            <label className="nn">
              <input type="checkbox" checked={c.not_needed} disabled={!editable || !!c.done_on || released} aria-label={`${l.style} ${s.label} not needed`}
                onChange={(e) => set(l.id, s.key, { not_needed: e.target.checked })} />
              Not needed
            </label>
          )}
        </div>
      </li>
    );
  }

  // A style at a glance: how far it has got, what is next or late, and its final QC.
  function summary(l: StyleRow) {
    const cells = steps(l.id).map((s) => ({ s, c: get(l.id, s.key) }));
    const done = cells.filter((x) => x.c.done_on).length;
    const over = cells.filter((x) => !x.c.done_on && x.c.planned_on && x.c.planned_on < today);
    const next = cells.find((x) => !x.c.done_on);
    const last = [...cells].reverse().find((x) => x.c.done_on);
    const status = over.length
      ? { text: `${over[0].s.label} overdue ${plural(daysBetween(over[0].c.planned_on, today))}${over.length > 1 ? `, ${over.length - 1} more late` : ""}`, cls: "bad" }
      : !next ? { text: "Every step done", cls: "ok" }
      : !next.c.planned_on ? { text: `Next: ${next.s.label}, no target yet`, cls: "warn" }
      : { text: `Next: ${next.s.label} by ${dm(next.c.planned_on)}`, cls: verdict(next.c, today)?.cls ?? "" };
    const segs = cells.map(({ s, c }) => {
      const v = verdict(c, today);
      return { key: s.key, label: s.label, cls: c.done_on ? "ok" : v?.cls ?? (c.planned_on ? "plan" : ""), text: v?.text ?? (c.planned_on ? `by ${dm(c.planned_on)}` : "no target") };
    });
    const p = project(cells.map((x) => x.c), today);
    const risk = shipRisk(p, dueDate);
    const outlook = risk.level === "risk" && p ? { text: `Likely ready ${dm(p.finish)}, ${plural(risk.daysLate)} after the ship date`, cls: "bad" }
      : risk.level === "behind" && p ? { text: `Running ${plural(p.slip)} behind plan, ready ${dm(p.finish)}`, cls: "warn" }
      : null;
    return { done, total: cells.length, at: last ? `At ${last.s.label}` : "Not started", status, segs, next: next?.s, outlook };
  }

  const toggle = (id: string) => setShown((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allShown = lines.length > 0 && lines.every((l) => shown.has(l.id));
  const unsavedStyles = new Set(changed.map((r) => r.line_id)).size;

  return (
    <section className="panel scroll-mt-20" id="tna">
      <div className="row mb-1">
        <h2 className="font-bold text-base">Styles and TNA</h2>
        {late > 0 && <span className="chip bad">{late} {late === 1 ? "style" : "styles"} behind plan</span>}
        {lines.length > 1 && (
          <button type="button" className="btn sm ml-auto" onClick={() => setShown(new Set(allShown ? [] : lines.map((l) => l.id)))}>
            {allShown ? "Hide all steps" : "Show all steps"}
          </button>
        )}
      </div>
      <details className="howto mb-4">
        <summary>How planning works</summary>
        <p>
          First set your target date for every step of each style (add extra steps if a style needs them), then ask the factory.
          The factory gives its own date for each step in its panel; if it agrees to your targets by phone or WhatsApp instead, press
          &quot;Factory agreed to targets&quot;. Release the PO once every factory date is in and none is later than its target.
          After release the targets are locked: only the owner can move one, with a reason, and the step shows where it started. The orders team
          and Quality enter done dates. A late step pushes back the steps after it, so a style shows when it will likely be ready and whether
          that misses the ship date. Quality&apos;s latest result shows next to each step it checks. &quot;Fill empty targets&quot; works every
          empty target back from the target date with the usual days per step.
        </p>
      </details>

      {groups.map((g) => {
        const released = !!g.releasedAt;
        const dueAt = g.planRequestedAt ? planDueAt(g.planRequestedAt) : null;
        // A plan sent before the latest "ask again" answers the old request, not this one.
        const sent = g.factorySentAt && (!g.planRequestedAt || g.factorySentAt >= g.planRequestedAt) ? g.factorySentAt : "";
        const critical = !released && !sent && !!dueAt && dueAt.getTime() < Date.parse(now);
        const buffer = g.factoryId ? buffers[g.factoryId] ?? "" : "";
        const bufferOk = /^\d{1,2}$/.test(buffer) && Number(buffer) <= 90;
        const target = released || !g.factoryId ? g.target : dueDate && bufferOk ? addDays(dueDate, -Number(buffer)) : g.target;
        const gaps = missing(g, target);
        const toAsk = targetGaps(g, target);
        const asked = !!(g.planRequestedAt || g.planRequestedOn);
        const status = !g.factoryId ? { text: "No factory chosen", cls: "warn" }
          : released ? { text: `PO released ${dayAt(g.releasedAt)}`, cls: "ok" }
          : !gaps.length ? { text: "Plan complete, ready to release", cls: "info" }
          : critical ? { text: `Critical: no TNA from the factory, due ${at.format(dueAt!)}`, cls: "bad" }
          : sent ? { text: g.planEnteredBy ? `Factory's TNA entered by ${g.planEnteredBy} ${dayAt(sent)}` : `Factory sent its TNA ${dayAt(sent)}`, cls: "warn" }
          : dueAt ? { text: `Waiting for the factory's TNA, due ${at.format(dueAt)}`, cls: "warn" }
          : toAsk.length ? { text: "Set your targets, then ask the factory", cls: "bad" }
          : { text: "Targets set, ask the factory", cls: "warn" };
        return (
          <div key={g.factoryId ?? "none"} className="fac-group" data-factory={g.factoryName}>
            <div className="fac-head">
              <div className="row">
                <h3 className="font-bold text-[14px]">{g.factoryName}</h3>
                <span className={`chip ${status.cls}`}>{status.text}</span>
                <span className="muted text-xs">{g.lines.length} {g.lines.length === 1 ? "style" : "styles"}{target && g.factoryId ? ` · target date ${dm(target)}` : ""}</span>
              </div>
              {editable && g.factoryId && released && (
                <div className="row"><FactoryLink factoryId={g.factoryId} name={g.factoryShort || g.factoryName} phone={g.factoryPhone} /></div>
              )}
              {editable && g.factoryId && !released && (
                <div className="row">
                  <FactoryLink factoryId={g.factoryId} name={g.factoryShort || g.factoryName} phone={g.factoryPhone} />
                  <button type="button" className="btn sm" disabled={pending || !target}
                    title={!target ? "Enter the PO's ship date first" : "Fills every empty target with the standard days before the target date"}
                    onClick={() => fillTargets(g, target)}>Fill empty targets</button>
                  <button type="button" className="btn sm" disabled={pending} onClick={() => copyRequest(g)}>Copy plan request</button>
                  <label className="row gap-1.5 text-[13px]">Buffer
                    <input className="inp w-14 !py-1" inputMode="numeric" value={buffer} aria-label={`Buffer days for ${g.factoryName}`}
                      onChange={(e) => setBuffers((b) => ({ ...b, [g.factoryId!]: e.target.value.replace(/\D/g, "") }))} />
                    days
                  </label>
                  <button type="button" className="btn sm" disabled={pending || !bufferOk || toAsk.length > 0 || unsaved(g)}
                    title={unsaved(g) ? "Save the dates first" : toAsk.length ? "Set every target first" : undefined}
                    onClick={() => run(`req:${g.factoryId}`, () => requestPlan(orderId, g.factoryId!, Number(buffer)),
                      `Asked ${g.factoryName} for its TNA. It has ${PLAN_HOURS} hours to send it in its factory panel.`)}>
                    {busy === `req:${g.factoryId}` ? "Saving…" : asked ? "Ask again (restart 24 hours)" : "Ask factory for plan"}
                  </button>
                  {asked && toAsk.length === 0 && gaps.length > 0 && (
                    <button type="button" className="btn sm" disabled={pending || unsaved(g)}
                      title={unsaved(g) ? "Save the dates first" : `Use when ${g.factoryName} agreed to your targets by phone or WhatsApp`}
                      onClick={() => run(`acc:${g.factoryId}`, () => acceptTargetsForFactory(orderId, g.factoryId!),
                        `Entered your targets as ${g.factoryName}'s dates. You can release the PO now.`)}>
                      {busy === `acc:${g.factoryId}` ? "Saving…" : "Factory agreed to targets"}
                    </button>
                  )}
                  <button type="button" className="btn sm primary" disabled={pending || gaps.length > 0 || unsaved(g)}
                    title={unsaved(g) ? "Save the dates first" : gaps.length ? "The plan is not complete yet" : undefined}
                    onClick={() => run(`rel:${g.factoryId}`, () => releaseFactoryPo(orderId, g.factoryId!), `PO released to ${g.factoryName}.`)}>
                    {busy === `rel:${g.factoryId}` ? "Releasing…" : "Release PO"}
                  </button>
                </div>
              )}
            </div>
            {!g.factoryId && <p className="muted mb-2 text-[13px]">Choose a factory for these styles in Order details below before planning them.</p>}
            {g.factoryId && target && !released && (
              <p className="muted mb-2 text-[13px]">
                Every target and factory date must be on or before <b className="text-foreground">{day(target)}</b>
                {dueDate && ` (PO delivery ${day(dueDate)} less ${!bufferOk ? g.bufferDays ?? 0 : buffer} days buffer)`}.
              </p>
            )}
            {critical && (
              <p className="errbox mb-2" role="status">
                {g.factoryName} hasn&apos;t sent its TNA within {PLAN_HOURS} hours. Chase them now, or move these styles to another factory in Order details.
              </p>
            )}
            {g.factoryId && !released && !asked && toAsk.length > 0 && (
              <p className="mb-2 text-[13px] text-warn"><b>Before asking the factory:</b> {toAsk.join("; ")}</p>
            )}
            {g.factoryId && !released && asked && gaps.length > 0 && (
              <p className="mb-2 text-[13px] text-warn"><b>Missing before release:</b> {gaps.join("; ")}</p>
            )}
            <div className="style-list">
              {g.lines.map((l) => {
                const sm = summary(l);
                const fin = qc[key(l.id, "final_qc")];
                const isOpen = shown.has(l.id);
                const dirty = changed.some((r) => r.line_id === l.id);
                return (
                  <article key={l.id} id={`style-${l.id}`} className={`style-card ${sm.status.cls === "bad" ? "late" : ""}`}>
                    <div className="style-head">
                      <div className="style-photo">
                        {l.photoUrl ? (
                          <a href={l.photoUrl} target="_blank" rel="noreferrer" aria-label={`Photo of ${l.style}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                            <img src={l.photoUrl} alt="" />
                          </a>
                        ) : <div className="ph">No photo</div>}
                      </div>
                      <div className="style-id">
                        <b className="code text-[13.5px]">{l.style}</b>
                        <span>{[l.colour, `${qty(l.qty)} pcs`].filter(Boolean).join(" · ")}</span>
                        {editable && (
                          <label className={`link w-fit cursor-pointer text-xs ${pending ? "pointer-events-none opacity-50" : ""}`}>
                            {busy === `photo:${l.id}` ? "Uploading…" : l.photoUrl ? "Change photo" : "Add photo"}
                            <input type="file" accept="image/*" className="sr-only" aria-label={`Photo for ${l.style}`}
                              onChange={(e) => { photo(l.id, e.target.files); e.target.value = ""; }} />
                          </label>
                        )}
                      </div>
                      <div className="style-prog">
                        <div className="stepper" aria-label={`${l.style}: ${sm.done} of ${sm.total} steps done`}>
                          {sm.segs.map((x) => <i key={x.key} className={x.cls} title={`${x.label}: ${x.text}`} />)}
                        </div>
                        <div className="style-line">
                          <span>{sm.at} · {sm.done} of {sm.total} steps done</span>
                          <b className={sm.status.cls}>{sm.status.text}</b>
                        </div>
                        {sm.outlook && <p className={`style-outlook ${sm.outlook.cls}`}>{sm.outlook.text}</p>}
                      </div>
                      <div className="style-side">
                        {dirty && <span className="chip warn">Unsaved</span>}
                        {doneEditable && released && sm.next && !dirty && (
                          <button type="button" className="btn sm done-btn" disabled={pending} onClick={() => doneToday(l, sm.next!)}>
                            {busy === `done:${l.id}` ? "Saving…" : <><span aria-hidden className="done-tick">✓</span>{sm.next.label} done today</>}
                          </button>
                        )}
                        <a href={`#qc-${l.id}`} className={`chip ${fin ? (fin.result === "pass" ? "ok" : "bad") : ""}`}>
                          {fin ? `Final QC ${fin.result === "pass" ? "passed" : "failed"}` : "Final QC not done"}
                        </a>
                        <button type="button" className="btn sm" aria-expanded={isOpen} aria-controls={`steps-${l.id}`} onClick={() => toggle(l.id)}>
                          {isOpen ? "Hide steps" : editable || doneEditable ? "Show and edit steps" : "Show steps"}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div id={`steps-${l.id}`}>
                        <div className="step-head" aria-hidden><span>Step</span><span>Factory</span><span>Target</span><span>Done</span><span>Status</span></div>
                        <ul className="step-list">
                          {allSteps(l.id).filter((s) => !s.extra || !get(l.id, s.key).not_needed).map((s) => stepRow(l, s, released, target))}
                        </ul>
                        {editable && (
                          <div className="step-add">
                            <input className="inp" value={newStep[l.id] ?? ""} placeholder="Extra step, e.g. Embroidery" maxLength={60}
                              aria-label={`New step for ${l.style}`} onChange={(e) => setNewStep((n) => ({ ...n, [l.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(l.id); } }} />
                            <button type="button" className="btn sm" onClick={() => addExtra(l.id)}>Add step</button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {editable && g.lines.length > 1 && (
              <button type="button" className="btn sm mt-2 max-w-full !whitespace-normal text-left" disabled={pending} onClick={() => copyPlan(g)}>
                Copy {g.lines[0].style}&apos;s targets to {g.factoryName}&apos;s other styles
              </button>
            )}
          </div>
        );
      })}

      {doneEditable && (
        <div className={`savebar ${changed.length ? "dirty" : ""}`}>
          {moved.length > 0 && (
            <input className="inp min-w-[220px] flex-1" value={reason} maxLength={300} aria-label="Why the targets move"
              placeholder={`Why ${moved.length === 1 ? "this target moves" : `these ${moved.length} targets move`} (required)`}
              onChange={(e) => setReason(e.target.value)} />
          )}
          <button type="button" className="btn primary" disabled={pending || !changed.length || (moved.length > 0 && !reason.trim())}
            title={moved.length > 0 && !reason.trim() ? "Say why the released targets move" : undefined}
            onClick={() => run("save", () => saveLineStages(orderId, moved.length ? changed.map((r) => ({ ...r, target_note: reason.trim() })) : changed), "Saved")}>
            {busy === "save" ? "Saving…" : "Save TNA dates"}
          </button>
          {changed.length > 0 && <span className="text-[13px] font-semibold text-warn">Unsaved changes on {unsavedStyles} {unsavedStyles === 1 ? "style" : "styles"}</span>}
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {notice && !error && <span className="text-[13px] font-semibold text-ok">{notice}</span>}
        </div>
      )}
      {!doneEditable && error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
      {!doneEditable && notice && !error && <p className="mt-3 text-[13px] font-semibold text-ok">{notice}</p>}
    </section>
  );
}
