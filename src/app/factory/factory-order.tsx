"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, dayAt, PLAN_HOURS, qty, TNA_STEPS } from "@/lib/format";
import { saveFactoryTna, type FactoryDateInput } from "./actions";
import { stepName, words, type Lang } from "./i18n";
import { sizeEntries } from "@/lib/sizes";
import { FactoryProgress, type FactoryUpdate } from "./step-update";
import { FactorySamples, type FactoryRound } from "./factory-samples";

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

// What the orders team entered for a style: its fabric, pieces per size, tech pack and cutting program.
export type StyleInfo = { fabric: string; sizes: Record<string, number>; files: { kind: string; name: string; url: string }[] };

const key = (lineId: string, stage: string) => `${lineId}:${stage}`;

function Info({ info, lang }: { info?: StyleInfo; lang: Lang }) {
  const w = words(lang);
  if (!info) return null;
  const sizes = sizeEntries(info.sizes);
  return (
    <div className="finfo">
      {info.fabric && <span><b>{w.fabric}</b> {info.fabric}</span>}
      {sizes.length > 0 && <span><b>{w.sizes}</b> {sizes.map(([s, n]) => `${s} ${qty(n)}`).join(" · ")}</span>}
      {info.files.map((f) => (
        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="chip info">
          {f.kind === "cutting" ? w.cuttingProgram : w.techPack}: {f.name}
        </a>
      ))}
    </div>
  );
}
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// One order in the factory's panel: its styles, and the factory's date for every TNA step.
export function FactoryOrder({ order, now, companyId, updates, rounds, lang, info }: {
  order: PanelOrder; now: string; companyId: string; updates: FactoryUpdate[]; rounds: FactoryRound[]; lang: Lang; info: Record<string, StyleInfo>;
}) {
  const router = useRouter();
  const w = words(lang);
  const label = (stage: string, own: string | null | undefined) => stepName(lang, stage, own, TNA_STEPS.find((t) => t.key === stage)?.label ?? stage);
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
    .map((s) => `${l.style} ${label(s.stage, s.label)}`));

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
  const status = released ? { text: w.released(dayAt(order.released_at!)), cls: "ok" }
    : late ? { text: w.overdue(at.format(new Date(order.plan_due_at!))), cls: "bad" }
    : sentAt && !missing ? { text: w.sentWaiting(dayAt(sentAt)), cls: "info" }
    : { text: missing ? w.toFill(missing) : w.readyToSend, cls: "warn" };

  function fields(lineId: string, style: string, label: string, st: Stage) {
    const v = dates[key(lineId, st.stage)] ?? "";
    return (
      <>
        {st.planned_on && <div className="text-[11.5px]"><span className="muted">{w.target} </span><b>{day(st.planned_on)}</b></div>}
        <label><span>{w.yourDate}</span>
          <input className="inp" type="date" value={v} max={order.target ?? undefined} disabled={released || pending}
            aria-label={`${style} ${label} your date`}
            onChange={(e) => { setDates((d) => ({ ...d, [key(lineId, st.stage)]: e.target.value })); setSent(false); }} />
        </label>
        {!released && st.planned_on && v > st.planned_on && <small className="block text-bad">{w.laterThanTarget}</small>}
        {released && st.done_on && <small className="block text-ok">{w.done(day(st.done_on))}</small>}
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
        {order.target && <>{w.targetDate} <b className="text-foreground">{day(order.target)}</b>{w.targetRule} </>}
        {!released && !sentAt && order.plan_due_at && <>{w.sendBy} <b className="text-foreground">{at.format(new Date(order.plan_due_at))}</b>. </>}
        {released ? w.releasedHelp : w.planHelp}
      </p>
      {released && <FactorySamples companyId={companyId} order={order} rounds={rounds} lang={lang} />}
      {released && <FactoryProgress companyId={companyId} order={order} updates={updates.filter((u) => u.order_id === order.order_id)} lang={lang} />}
      {/* On a phone: one card per style, one row per step, big date boxes. */}
      <div className="show-phone fstyles">
        {order.lines.map((l) => (
          <article key={l.id} className="fstyle">
            <header>
              <b className="code">{l.style}</b>
              <span className="muted text-[13px]">{[l.colour, `${qty(l.qty)} ${w.pcs}`, l.rate != null ? `₹${qty(l.rate)}` : ""].filter(Boolean).join(" · ")}</span>
              <Info info={info[l.id]} lang={lang} />
            </header>
            <ul>
              {[...TNA_STEPS.map((s) => ({ label: label(s.key, null), st: stageOf(l.id, s.key) })), ...extrasOf(l).map((st) => ({ label: st.label ?? "", st }))].map(({ label, st }) => (
                <li key={label} className="fstep">
                  <div>
                    <b>{label}</b>
                    {st?.planned_on ? <small>{w.target} {day(st.planned_on)}</small> : <small className="muted">{st ? w.noTarget : w.notSetYet}</small>}
                    {st && !released && st.planned_on && (dates[key(l.id, st.stage)] ?? "") > st.planned_on && <small className="text-bad">{w.laterThanTarget}</small>}
                    {released && st?.done_on && <small className="text-ok">{w.done(day(st.done_on))}</small>}
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
          <thead><tr><th>{w.style}</th>{TNA_STEPS.map((s) => <th key={s.key}>{label(s.key, null)}</th>)}<th>{w.extraSteps}</th></tr></thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td className="tna-style">
                  <b className="code">{l.style}</b>
                  <div className="muted text-xs">{[l.colour, `${qty(l.qty)} ${w.pcs}`].filter(Boolean).join(" · ")}</div>
                  {l.rate != null && <div className="muted text-xs">{w.rate} ₹{qty(l.rate)}</div>}
                  <Info info={info[l.id]} lang={lang} />
                </td>
                {TNA_STEPS.map((s) => {
                  const st = stageOf(l.id, s.key);
                  return st ? <td key={s.key} className="tna-cell">{fields(l.id, l.style, s.label, st)}</td>
                    : <td key={s.key} className="tna-cell muted text-xs">{w.notSetYet}</td>;
                })}
                <td className="tna-cell min-w-[160px]">
                  {extrasOf(l).map((st) => (
                    <div key={st.stage} className="mb-2 rounded-md border border-line p-1.5">
                      <div className="text-[12.5px] font-semibold">{st.label}</div>
                      {fields(l.id, l.style, st.label ?? "", st)}
                    </div>
                  ))}
                  {!extrasOf(l).length && <span className="muted text-xs">{w.none}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!released && (
        <div className="row mt-3 fsend">
          <button type="button" className="btn primary" disabled={pending || missing > 0 || beyond || (!changed.length && !!sentAt)} onClick={send}
            title={missing ? w.fillFirst : beyond ? w.bringBefore : undefined}>
            {pending ? w.sending : sentAt ? w.sendUpdated : w.sendMine}
          </button>
          {order.lines.length > 1 && <button type="button" className="btn" disabled={pending} onClick={copyFirst}>{w.copyDates(order.lines[0].style)}</button>}
          {laterThanTarget.length > 0 && !beyond && <span className="text-[13px] font-semibold text-warn">{w.laterCount(laterThanTarget.length)}</span>}
          {beyond && <span className="text-[13px] font-semibold text-bad">{w.afterTarget(day(order.target))}</span>}
          {missing > 0 && <span className="muted text-[13px]">{w.fillRemaining(missing)}</span>}
          {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
          {sent && !error && <span className="text-[13px] font-semibold text-ok">{w.sent}</span>}
        </div>
      )}
    </section>
  );
}
