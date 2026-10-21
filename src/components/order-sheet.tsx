"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { closeOldOrder, loadQuick, lockPlan, logChase, markStepsDone, startProduction } from "@/app/(app)/orders/quick-actions";
import { daysBetween, DEFAULT_BUFFER_DAYS, TNA_STEPS } from "@/lib/format";
import { addDays, byNextStep, catchUpRows, dm, live, sharedSteps, startTargets, when, type QOrder, type QStyle } from "@/lib/quick";
import { toast } from "@/components/toast";

type Mode = "update" | "start";
type Open = { orderId: string; mode: Mode; factoryId?: string };
const EVENT = "sourcingo:order-sheet";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Opens the quick sheet for an order from anywhere: mark steps done ("update") or start a factory's production ("start").
export function openOrderSheet(orderId: string, mode: Mode, factoryId?: string) {
  window.dispatchEvent(new CustomEvent<Open>(EVENT, { detail: { orderId, mode, factoryId } }));
}

export function SheetButton({ orderId, mode, factoryId, className = "btn sm", children }: Open & { className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openOrderSheet(orderId, mode, factoryId)}>{children}</button>;
}

// A WhatsApp chase to a factory with the message ready; the chase is noted so the team sees it was done today.
export function ChaseLink({ href, factoryId, orderId, chased, className = "btn sm" }: { href: string; factoryId: string; orderId: string | null; chased?: boolean; className?: string }) {
  const [done, setDone] = useState(!!chased);
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${className} wa-link ${done ? "is-done" : ""}`}
      onClick={() => { setDone(true); logChase(factoryId, orderId).catch(() => {}); }}>
      <WaIcon />{done ? "Chased" : "Chase"}
    </a>
  );
}

export function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden fill="currentColor">
      <path d="M12 2.2a9.7 9.7 0 0 0-8.3 14.8L2.3 21.8l4.9-1.3A9.7 9.7 0 1 0 12 2.2Zm0 17.7c-1.5 0-3-.4-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 19.9Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.2Z" />
    </svg>
  );
}

// The one sheet, mounted once in the app layout.
export function OrderSheet() {
  const box = useRef<HTMLDialogElement>(null);
  const [req, setReq] = useState<Open | null>(null);
  const [order, setOrder] = useState<QOrder | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("update");

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Open>).detail;
      setReq(d);
      setMode(d.mode);
      setOrder(null);
      setError("");
      box.current?.showModal();
      loadQuick(d.orderId).then((r) => (r.order ? setOrder(r.order) : setError(r.error ?? "Couldn't load this order."))).catch(() => setError("Couldn't load this order. Check the connection and try again."));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = () => box.current?.close();
  const reload = () => req && loadQuick(req.orderId).then((r) => r.order && setOrder(r.order));

  return (
    <dialog ref={box} className="sheet qs" aria-labelledby="qs-h" onClick={(e) => { if (e.target === box.current) close(); }} onClose={() => setReq(null)}>
      <div className="sheet-body">
        <span className="grabber" aria-hidden />
        <header className="qs-head">
          <div className="min-w-0">
            <h2 id="qs-h">{order ? <><span className="qs-no">{order.orderNo}</span>{order.buyer}</> : "Loading…"}</h2>
            {order && <p>{plural(order.groups.reduce((n, g) => n + g.styles.length, 0), "style")}{order.due ? ` · ships ${dm(order.due)}` : ""}{order.due && order.due < order.today ? ` · ${plural(daysBetween(order.due, order.today), "day")} late` : ""}</p>}
          </div>
          <button type="button" className="qs-x" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>
        {error ? <p className="errbox mt-3">{error}</p> : !order ? <Skeleton /> : order.status !== "open" ? (
          <p className="qs-note mt-3">This order is {order.status}. Nothing left to update.</p>
        ) : mode === "update" ? (
          <UpdateView order={order} onDone={close} onStart={(f) => { setReq((r) => r && { ...r, factoryId: f }); setMode("start"); }} />
        ) : (
          <StartView order={order} factoryId={req?.factoryId} onDone={close} onChanged={reload} />
        )}
      </div>
    </dialog>
  );
}

function Skeleton() {
  return <div className="qs-skel" aria-hidden><i /><i /><i /><i /></div>;
}

// ---------------------------------------------------------------- marking steps done
function UpdateView({ order, onDone, onStart }: { order: QOrder; onDone: () => void; onStart: (factoryId: string) => void }) {
  const router = useRouter();
  const today = order.today;
  const released = order.groups.filter((g) => g.released);
  const waiting = order.groups.filter((g) => !g.released);
  const groups = useMemo(() => byNextStep(order.groups), [order]);
  const [tab, setTab] = useState<"next" | "catch">("next");
  // Next steps: the styles ticked in each step's group (all at first).
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups.flatMap((g) => g.styles.map((s) => `${g.key}:${s.id}`))));
  const [on, setOn] = useState(today);
  // Catch up: the styles chosen, and the last step they have finished.
  const styles = released.flatMap((g) => g.styles);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(styles.map((s) => s.id)));
  const [upTo, setUpTo] = useState("");
  const [onTarget, setOnTarget] = useState(true);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const nextRows = groups.flatMap((g) => g.styles.filter((s) => picked.has(`${g.key}:${s.id}`)).map((s) => {
    const x = s.steps.find((y) => y.key === g.key)!;
    return { line_id: s.id, stage: x.key, planned_on: x.planned_on, done_on: on, not_needed: false, ...(x.extra ? { label: x.label } : {}),
      was: { planned_on: x.planned_on, done_on: x.done_on, not_needed: x.not_needed } };
  }));
  const chosenStyles = styles.filter((s) => chosen.has(s.id));
  const catchRows = upTo ? catchUpRows(chosenStyles, upTo, today, onTarget) : [];
  const rows = tab === "next" ? nextRows : catchRows;

  function save() {
    setError("");
    start(async () => {
      const res = await markStepsDone(order.id, rows);
      if (res.error) { setError(res.error); return; }
      const nStyles = new Set(rows.map((r) => r.line_id)).size;
      const steps = new Set(rows.map((r) => r.stage));
      const label = steps.size === 1 ? (TNA_STEPS.find((t) => t.key === rows[0].stage)?.label ?? rows[0].label ?? "Step") : plural(rows.length, "step");
      toast(steps.size === 1 ? `${label} done on ${plural(nStyles, "style")}` : `${label} done on ${plural(nStyles, "style")}`);
      onDone();
      router.refresh();
    });
  }
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  if (!released.length) {
    return (
      <div className="qs-empty">
        <b>Production hasn&apos;t started yet</b>
        <p>Steps can be marked done once the plan is locked. Set it up now: it takes a minute.</p>
        <button type="button" className="btn primary" onClick={() => onStart(waiting[0]?.factoryId ?? "")}>Start production</button>
      </div>
    );
  }
  return (
    <>
      <div className="seg qs-tabs" role="tablist" aria-label="How to update">
        <button type="button" role="tab" aria-selected={tab === "next"} onClick={() => setTab("next")}>Next steps</button>
        <button type="button" role="tab" aria-selected={tab === "catch"} onClick={() => setTab("catch")}>Catch up</button>
      </div>

      {tab === "next" ? (
        groups.length === 0 ? <p className="qs-note">Every step is done on every style. Lovely.</p> : (
          <div className="qs-groups">
            {groups.map((g) => {
              const keys = g.styles.map((s) => `${g.key}:${s.id}`);
              const n = keys.filter((k) => picked.has(k)).length;
              const w = when(g.planned, today);
              return (
                <section key={g.key} className={`qs-group ${n ? "on" : ""}`}>
                  <label className="qs-group-h">
                    <input type="checkbox" className="qs-check" checked={n === keys.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < keys.length; }}
                      onChange={() => setPicked((p) => { const x = new Set(p); for (const k of keys) { if (n === keys.length) x.delete(k); else x.add(k); } return x; })} />
                    <span className="grow"><b>{g.label}</b><small>{n === keys.length ? (keys.length === 1 ? g.styles[0].style : `All ${keys.length} styles`) : `${n} of ${keys.length} styles`}</small></span>
                    <span className={`qs-when ${w.cls}`}>{w.text}</span>
                  </label>
                  {g.styles.length > 1 && (
                    <div className="qs-chips">
                      {g.styles.map((s) => (
                        <button key={s.id} type="button" aria-pressed={picked.has(`${g.key}:${s.id}`)} onClick={() => setPicked((p) => toggle(p, `${g.key}:${s.id}`))}>
                          {s.style}{s.colour && <small>{s.colour}</small>}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="qs-catch">
          <p className="qs-note">Where are they really? Tap the <b>last step that&apos;s finished</b>. Every step before it is marked done too.</p>
          {styles.length > 1 && (
            <div className="qs-chips mb-3">
              {styles.map((s) => (
                <button key={s.id} type="button" aria-pressed={chosen.has(s.id)} onClick={() => setChosen((c) => toggle(c, s.id))}>
                  {s.style}{s.colour && <small>{s.colour}</small>}
                </button>
              ))}
            </div>
          )}
          <ol className="qs-steps">
            {sharedSteps(chosenStyles).map((st, i, all) => {
              const idx = all.findIndex((x) => x.key === upTo);
              const done = chosenStyles.length > 0 && chosenStyles.every((s) => live(s).find((x) => (st.key.startsWith("x:") ? x.extra && `x:${x.label.toLowerCase()}` === st.key : x.key === st.key))?.done_on);
              const cls = done ? "done" : idx >= 0 && i <= idx ? "will" : "";
              return (
                <li key={st.key}>
                  <button type="button" className={cls} aria-pressed={upTo === st.key} disabled={done} onClick={() => setUpTo(upTo === st.key ? "" : st.key)}>
                    <i aria-hidden />{st.label}{done && <small>Done</small>}{upTo === st.key && <small>Finished up to here</small>}
                  </button>
                </li>
              );
            })}
          </ol>
          <label className="qs-toggle">
            <input type="checkbox" checked={onTarget} onChange={(e) => setOnTarget(e.target.checked)} />
            <span>Date each step on its target date <small>Off: every step is dated today</small></span>
          </label>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="qs-wait">
          {waiting.map((g) => (
            <div key={g.factoryId ?? "none"}>
              <span><b>{g.factoryName}</b> · {plural(g.styles.length, "style")} not started yet</span>
              <button type="button" className="link" onClick={() => onStart(g.factoryId ?? "")}>Start</button>
            </div>
          ))}
        </div>
      )}

      <footer className="qs-foot">
        {tab === "next" && (
          <div className="qs-days" role="radiogroup" aria-label="Done on">
            {[["Today", today], ["Yesterday", addDays(today, -1)], ["2 days ago", addDays(today, -2)]].map(([t, d]) => (
              <button key={d} type="button" role="radio" aria-checked={on === d} onClick={() => setOn(d)}>{t}</button>
            ))}
            <label className={`qs-pick ${[today, addDays(today, -1), addDays(today, -2)].includes(on) ? "" : "on"}`}>
              <input type="date" value={on} max={today} aria-label="Another day" onChange={(e) => e.target.value && setOn(e.target.value)} />
              <span>{[today, addDays(today, -1), addDays(today, -2)].includes(on) ? "Pick a day" : dm(on)}</span>
            </label>
          </div>
        )}
        {tab === "catch" && upTo && catchRows.length > 0 && (
          <p className="qs-sum">{plural(catchRows.length, "step")} on {plural(new Set(catchRows.map((r) => r.line_id)).size, "style")}, dated {onTarget ? `on their targets (latest ${dm(catchRows.reduce((m, r) => (r.done_on > m ? r.done_on : m), ""))})` : "today"}</p>
        )}
        {error && <p className="qs-err" role="alert">{error}</p>}
        <button type="button" className="btn primary qs-go" disabled={pending || !rows.length} onClick={save}>
          {pending ? "Saving…" : !rows.length ? (tab === "next" ? "Pick the styles that are done" : "Tap the last step finished") : tab === "next" ? `Mark ${rows.length === 1 ? "it" : rows.length} done` : `Mark ${plural(rows.length, "step")} done`}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------- starting production
function StartView({ order, factoryId, onDone, onChanged }: { order: QOrder; factoryId?: string; onDone: () => void; onChanged: () => void }) {
  const router = useRouter();
  const today = order.today;
  const open = order.groups.filter((g) => !g.released);
  const [fid, setFid] = useState<string>(() => (open.find((g) => (g.factoryId ?? "") === (factoryId ?? "")) ?? open[0])?.factoryId ?? "");
  const g = open.find((x) => (x.factoryId ?? "") === fid) ?? open[0];
  const [buffer, setBuffer] = useState(g?.bufferDays ?? DEFAULT_BUFFER_DAYS);
  const [agreed, setAgreed] = useState(true);
  const [pickFactory, setPickFactory] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [newShip, setNewShip] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [oldNote, setOldNote] = useState("");

  if (!g) return <p className="qs-note mt-3">Production has started for every factory on this order. Use Update to mark steps done.</p>;
  const due = newShip || order.due;
  const target = due ? addDays(due, -buffer) : "";
  const pastDue = !order.due || addDays(order.due, -buffer) < today;
  const noRate = g.styles.filter((s) => !s.hasRate);
  const plan = target && target >= today ? startTargets(g.styles, target, today) : {};
  const first = g.styles[0];
  const dateOf = (s: QStyle, k: string) => plan[s.id]?.[k] ?? s.steps.find((x) => x.key === k)?.planned_on ?? "";
  const same = g.styles.every((s) => live(s).every((x) => dateOf(s, x.key) === dateOf(first, x.key)));
  const waitingLock = !!g.lockRequestedAt;
  const old = order.due && order.due < addDays(today, -14);

  function go() {
    setError("");
    start(async () => {
      const res = await startProduction(order.id, {
        factoryId: g.factoryId ?? "", bufferDays: buffer, agreed,
        styles: g.styles.map((s) => ({ line_id: s.id, ...(g.factoryId ? {} : { factory_id: pickFactory }), ...(rates[s.id] ? { factory_rate: rates[s.id] } : {}) })),
        ...(pastDue && newShip ? { newShipDate: newShip, reason } : {}),
      });
      if (res.error) { setError(res.error); return; }
      toast(res.done ?? "Done");
      router.refresh();
      if (open.length > 1) { onChanged(); setFid(open.find((x) => x !== g)?.factoryId ?? ""); } else onDone();
    });
  }
  function lock() {
    setError("");
    start(async () => {
      const res = await lockPlan(order.id, g.factoryId!);
      if (res.error) { setError(res.error); return; }
      toast(`Locked. ${g.factoryName}'s production has started.`);
      router.refresh();
      onDone();
    });
  }
  function closeOld() {
    setError("");
    start(async () => {
      const res = await closeOldOrder(order.id, oldNote);
      if (res.error) { setError(res.error); return; }
      toast(`${order.orderNo} closed as shipped`);
      router.refresh();
      onDone();
    });
  }

  return (
    <>
      {open.length > 1 && (
        <div className="seg qs-tabs" role="tablist" aria-label="Factory">
          {open.map((x) => <button key={x.factoryId ?? "none"} type="button" role="tab" aria-selected={x === g} onClick={() => setFid(x.factoryId ?? "")}>{x.factoryName}</button>)}
        </div>
      )}
      <h3 className="qs-title">Start production{g.factoryId ? ` at ${g.factoryName}` : ""}</h3>
      <p className="qs-note">{plural(g.styles.length, "style")}: {g.styles.map((s) => s.style).join(", ")}</p>

      {waitingLock ? (
        <div className={`qs-banner ${order.isOwner ? "bad" : "info"}`}>
          {order.isOwner ? <><b>Sent for your lock.</b> Check the dates below, then lock it and the factory starts.</> : <><b>Waiting for {order.ownerName} to lock it.</b> Nothing else to do. It shows on Home when it&apos;s locked.</>}
        </div>
      ) : g.lockNote ? (
        <div className="qs-banner bad"><b>{order.ownerName} sent it back:</b> {g.lockNote}</div>
      ) : null}

      {!waitingLock && (
        <div className="qs-form">
          {!g.factoryId && (
            <label className="field"><span>Factory making them</span>
              <select className="inp" value={pickFactory} onChange={(e) => setPickFactory(e.target.value)}>
                <option value="">Pick a factory</option>
                {order.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          {noRate.length > 0 && (
            <div className="field"><span>Factory rate per piece</span>
              <div className="qs-rates">
                {noRate.map((s) => (
                  <label key={s.id}><small>{s.style}</small>
                    <span className="qs-money"><i>₹</i><input className="inp" inputMode="decimal" value={rates[s.id] ?? ""} placeholder="0" aria-label={`${s.style} factory rate`}
                      onChange={(e) => setRates((r) => ({ ...r, [s.id]: e.target.value }))} /></span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {pastDue && (
            <div className="qs-banner warn">
              <b>{order.due ? `The ship date (${dm(order.due)}) is too close or past.` : "This order has no ship date."}</b> Set the new one to plan against.
              <div className="qs-two mt-2">
                <input className="inp" type="date" min={addDays(today, 1)} value={newShip} aria-label="New ship date" onChange={(e) => setNewShip(e.target.value)} />
                <input className="inp" value={reason} maxLength={300} placeholder="Why it moves" aria-label="Why the ship date moves" onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
          )}
          <div className="qs-buffer">
            <span className="grow"><b>Buffer</b><small>{target ? `Factory finishes by ${dm(target)}, ${plural(buffer, "day")} before shipping` : "Days kept before the ship date"}</small></span>
            <span className="qs-stepper">
              <button type="button" aria-label="Fewer days" disabled={buffer <= 0} onClick={() => setBuffer((b) => Math.max(0, b - 1))}>−</button>
              <b className="num">{buffer}</b>
              <button type="button" aria-label="More days" disabled={buffer >= 30} onClick={() => setBuffer((b) => Math.min(30, b + 1))}>+</button>
            </span>
          </div>
        </div>
      )}

      {target && target >= today && (
        <div className="qs-plan">
          <div className="qs-plan-h"><b>The plan</b><small>{same ? (g.styles.length > 1 ? `Same for all ${g.styles.length} styles` : "") : `Shown for ${first.style}; the others are close`}</small></div>
          <ol>
            {live(first).map((x) => (
              <li key={x.key} className={x.done_on ? "done" : ""}>
                <span>{x.label}</span>
                <b className="num">{x.done_on ? `Done ${dm(x.done_on)}` : dateOf(first, x.key) ? dm(dateOf(first, x.key)) : "–"}</b>
              </li>
            ))}
          </ol>
          {!waitingLock && <p className="qs-fine">You can change any date on the order page before it&apos;s locked.</p>}
        </div>
      )}

      {!waitingLock && (
        <div className="qs-choice" role="radiogroup" aria-label="Factory's dates">
          <button type="button" role="radio" aria-checked={agreed} onClick={() => setAgreed(true)}>
            <i aria-hidden /><span><b>The factory agreed to these dates</b><small>{order.isOwner ? "It's locked and production starts now." : `Goes to ${order.ownerName} to lock.`}</small></span>
          </button>
          <button type="button" role="radio" aria-checked={!agreed} onClick={() => setAgreed(false)}>
            <i aria-hidden /><span><b>Ask the factory for its own dates</b><small>They get 24 hours on their factory link.</small></span>
          </button>
        </div>
      )}

      {old && !waitingLock && (
        <details className="qs-old">
          <summary>Already shipped before we used the app?</summary>
          <div className="qs-two mt-2">
            <input className="inp" value={oldNote} maxLength={300} placeholder={`e.g. Shipped ${dm(order.due)} by road`} aria-label="How it shipped" onChange={(e) => setOldNote(e.target.value)} />
            <button type="button" className="btn" disabled={pending || oldNote.trim().length < 3} onClick={closeOld}>Close as shipped</button>
          </div>
        </details>
      )}

      <footer className="qs-foot">
        {error && <p className="qs-err" role="alert">{error}</p>}
        {waitingLock ? (order.isOwner ? (
          <button type="button" className="btn primary qs-go" disabled={pending} onClick={lock}>{pending ? "Locking…" : "Lock and start production"}</button>
        ) : <button type="button" className="btn qs-go" onClick={onDone}>OK</button>) : (
          <button type="button" className="btn primary qs-go" onClick={go}
            disabled={pending || (!g.factoryId && !pickFactory) || noRate.some((s) => !(rates[s.id] ?? "").trim()) || (pastDue && (!newShip || !reason.trim()))}>
            {pending ? "Starting…" : !agreed ? "Set targets and ask the factory" : order.isOwner ? "Lock and start production" : `Send to ${order.ownerName} to lock`}
          </button>
        )}
      </footer>
    </>
  );
}

