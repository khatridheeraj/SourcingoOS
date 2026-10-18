"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, dayAt, PLAN_HOURS, qty, TNA_STEPS } from "@/lib/format";
import { saveFactoryTna, type FactoryDateInput } from "./actions";
import { FactoryProgress, type FactoryUpdate } from "./step-update";

type Stage = { stage: string; label: string | null; factory_on: string | null; planned_on: string | null; done_on: string | null };
export type PanelOrder = {
  order_id: string;
  order_no: string;
  ship_date: string | null;
  plan_requested_on: string | null;
  sent_at: string | null;
  released_at: string | null;
  plan_due_at: string | null;
  target: string | null;
  lines: { id: string; style: string; colour: string | null; qty: number; rate: number | null; stages: Stage[] }[];
};

const key = (lineId: string, stage: string) => `${lineId}:${stage}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// One order in the factory's panel: its styles, and the factory's date for every TNA step.
export function FactoryOrder({ order, now, companyId, updates }: { order: PanelOrder; now: string; companyId: string; updates: FactoryUpdate[] }) {
  const router = useRouter();
  const released = !!order.released_at;
  // Each style's steps as Sourcingo set them: standard steps it goes through, then its extra steps.
  const stageOf = (lineId: string, stage: string) => order.lines.find((l) => l.id === lineId)?.stages.find((s) => s.stage === stage);
  const extrasOf = (l: PanelOrder["lines"][number]) => l.stages.filter((s) => s.stage.startsWith("extra_"));
  const initial = Object.fromEntries(order.lines.flatMap((l) => l.stages.map((s) => [key(l.id, s.stage), s.factory_on ?? ""])));
  const [dates, setDates] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  // A plan sent before Sourcingo asked again answers the old request, so the factory sends it again.
  const sentAt = order.sent_at && (!order.plan_due_at || Date.parse(order.sent_at) >= Date.parse(order.plan_due_at) - PLAN_HOURS * 3_600_000)
    ? order.sent_at : null;

  const missing = order.lines.reduce((n, l) => n + l.stages.filter((s) => !dates[key(l.id, s.stage)]).length, 0);
  const changed: FactoryDateInput[] = order.lines.flatMap((l) => l.stages.map((s) => ({ line_id: l.id, stage: s.stage, factory_on: dates[key(l.id, s.stage)] ?? "" })))
    .filter((r) => r.factory_on !== initial[key(r.line_id, r.stage)]);
  const laterThanTarget = order.lines.flatMap((l) => l.stages.filter((s) => s.planned_on && dates[key(l.id, s.stage)] > s.planned_on)
    .map((s) => `${l.style} ${s.label ?? TNA_STEPS.find((t) => t.key === s.stage)?.label}`));

  function copyFirst() {
    const first = order.lines[0];
    setDates((d) => {
      const next = { ...d };
      for (const l of order.lines.slice(1)) for (const s of l.stages) if (stageOf(first.id, s.stage)) next[key(l.id, s.stage)] = d[key(first.id, s.stage)] ?? "";
      return next;
    });
    setSent(false);
  }

  function send() {
    setError("");
    start(async () => {
      const first = order.lines[0].stages[0];
      const res = await saveFactoryTna(order.order_id, changed.length ? changed : [{ line_id: order.lines[0].id, stage: first.stage, factory_on: dates[key(order.lines[0].id, first.stage)] ?? "" }]);
      if (res.error) return setError(res.error);
      setSent(true);
      router.refresh();
    });
  }

  const late = !released && !sentAt && !!order.plan_due_at && order.plan_due_at < now;
  const beyond = order.target ? Object.values(dates).some((d) => d && d > order.target!) : false;
  const status = released ? { text: `PO released ${dayAt(order.released_at!)}`, cls: "ok" }
    : late ? { text: `Overdue: was due ${at.format(new Date(order.plan_due_at!))}`, cls: "bad" }
    : sentAt && !missing ? { text: `Your TNA sent ${dayAt(sentAt)}, waiting for release`, cls: "info" }
    : { text: missing ? `${missing} ${missing === 1 ? "date" : "dates"} to fill` : "Ready to send", cls: "warn" };

  function fields(lineId: string, style: string, label: string, st: Stage) {
    const v = dates[key(lineId, st.stage)] ?? "";
    return (
      <>
        {st.planned_on && <div className="text-[11.5px]"><span className="muted">Target </span><b>{day(st.planned_on)}</b></div>}
        <label><span>Your date</span>
          <input className="inp" type="date" value={v} max={order.target ?? undefined} disabled={released || pending}
            aria-label={`${style} ${label} your date`}
            onChange={(e) => { setDates((d) => ({ ...d, [key(lineId, st.stage)]: e.target.value })); setSent(false); }} />
        </label>
        {!released && st.planned_on && v > st.planned_on && <small className="block text-bad">Later than target</small>}
        {released && st.done_on && <small className="block text-ok">Done {day(st.done_on)}</small>}
      </>
    );
  }

  return (
    <section className="panel" data-order={order.order_no}>
      <div className="row mb-1">
        <h2 className="font-bold text-base"><span className="code">{order.order_no}</span></h2>
        <span className={`chip ${status.cls}`}>{status.text}</span>
      </div>
      <p className="muted mb-3 text-[13px]">
        {order.target && <>Target date <b className="text-foreground">{day(order.target)}</b>: every date must be on or before it. </>}
        {!released && !sentAt && order.plan_due_at && <>Send your TNA by <b className="text-foreground">{at.format(new Date(order.plan_due_at))}</b>. </>}
        {released ? "Your dates are fixed. Mark each step done as you finish it; done dates show once Sourcingo confirms." : "Sourcingo's target for each step is shown above your date. Give your date for each step; a date later than its target holds up the PO."}
      </p>
      {released && <FactoryProgress companyId={companyId} order={order} updates={updates.filter((u) => u.order_id === order.order_id)} />}
      {/* On a phone: one card per style, one row per step, big date boxes. */}
      <div className="show-phone fstyles">
        {order.lines.map((l) => (
          <article key={l.id} className="fstyle">
            <header>
              <b className="code">{l.style}</b>
              <span className="muted text-[13px]">{[l.colour, `${qty(l.qty)} pcs`, l.rate != null ? `₹${qty(l.rate)}` : ""].filter(Boolean).join(" · ")}</span>
            </header>
            <ul>
              {[...TNA_STEPS.map((s) => ({ label: s.label, st: stageOf(l.id, s.key) })), ...extrasOf(l).map((st) => ({ label: st.label ?? "", st }))].map(({ label, st }) => (
                <li key={label} className="fstep">
                  <div>
                    <b>{label}</b>
                    {st?.planned_on ? <small>Target {day(st.planned_on)}</small> : <small className="muted">{st ? "No target" : "Not set yet"}</small>}
                    {st && !released && st.planned_on && (dates[key(l.id, st.stage)] ?? "") > st.planned_on && <small className="text-bad">Later than target</small>}
                    {released && st?.done_on && <small className="text-ok">Done {day(st.done_on)}</small>}
                  </div>
                  {st && (
                    <input className="inp" type="date" value={dates[key(l.id, st.stage)] ?? ""} max={order.target ?? undefined} disabled={released || pending}
                      aria-label={`${l.style} ${label} your date`}
                      onChange={(e) => { setDates((d) => ({ ...d, [key(l.id, st.stage)]: e.target.value })); setSent(false); }} />
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="table-wrap hide-phone">
        <table className="tbl tna">
          <thead><tr><th>Style</th>{TNA_STEPS.map((s) => <th key={s.key}>{s.label}</th>)}<th>Extra steps</th></tr></thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td className="tna-style">
                  <b className="code">{l.style}</b>
                  <div className="muted text-xs">{[l.colour, `${qty(l.qty)} pcs`].filter(Boolean).join(" · ")}</div>
                  {l.rate != null && <div className="muted text-xs">Rate ₹{qty(l.rate)}</div>}
                </td>
                {TNA_STEPS.map((s) => {
                  const st = stageOf(l.id, s.key);
                  return st ? <td key={s.key} className="tna-cell">{fields(l.id, l.style, s.label, st)}</td>
                    : <td key={s.key} className="tna-cell muted text-xs">Not set yet</td>;
                })}
                <td className="tna-cell min-w-[160px]">
                  {extrasOf(l).map((st) => (
                    <div key={st.stage} className="mb-2 rounded-md border border-line p-1.5">
                      <div className="text-[12.5px] font-semibold">{st.label}</div>
                      {fields(l.id, l.style, st.label ?? "", st)}
                    </div>
                  ))}
                  {!extrasOf(l).length && <span className="muted text-xs">None</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!released && (
        <div className="row mt-3 fsend">
          <button type="button" className="btn primary" disabled={pending || missing > 0 || beyond || (!changed.length && !!sentAt)} onClick={send}
            title={missing ? "Fill every date first" : beyond ? "Bring every date on or before the target date" : undefined}>
            {pending ? "Sending…" : sentAt ? "Send updated TNA" : "Send my TNA"}
          </button>
          {order.lines.length > 1 && <button type="button" className="btn" disabled={pending} onClick={copyFirst}>Copy {order.lines[0].style}&apos;s dates to all styles</button>}
          {laterThanTarget.length > 0 && !beyond && <span className="text-[13px] font-semibold text-warn">{laterThanTarget.length} {laterThanTarget.length === 1 ? "date is" : "dates are"} later than Sourcingo&apos;s target. Sourcingo will need to agree before releasing the PO.</span>}
          {beyond && <span className="text-[13px] font-semibold text-bad">Some dates are after the target date {day(order.target)}.</span>}
          {missing > 0 && <span className="muted text-[13px]">Fill all {missing} remaining {missing === 1 ? "date" : "dates"} to send.</span>}
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {sent && !error && <span className="text-[13px] font-semibold text-ok">Sent to Sourcingo</span>}
        </div>
      )}
    </section>
  );
}
