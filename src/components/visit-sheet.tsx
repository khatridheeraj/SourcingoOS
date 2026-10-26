"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadVisit, postFloorUpdate, type VisitData, type VisitStyle } from "@/app/(app)/orders/floor-actions";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { FLOOR_STATUS, floorLine, NOT_DONE_ON_VISIT, type FloorStatus } from "@/lib/floor";
import { uploadPhotos } from "@/lib/photos";
import { dm, when } from "@/lib/quick";

type Open = { factoryId?: string; orderId?: string };
const EVENT = "sourcingo:visit";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Opens the factory visit from anywhere: every style in production at a factory (or on one order), one update each.
export function openVisit(scope: Open) {
  window.dispatchEvent(new CustomEvent<Open>(EVENT, { detail: scope }));
}

export function VisitButton({ factoryId, orderId, className = "btn sm", children }: Open & { className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openVisit({ factoryId, orderId })}>{children}</button>;
}

// A style's open steps, the one it is on first: the earliest target, then its place in the TNA.
const openSteps = (s: VisitStyle) => s.steps.map((x, i) => ({ ...x, i })).filter((x) => !x.done)
  .sort((a, b) => (a.planned || "9999").localeCompare(b.planned || "9999") || a.i - b.i);

// The visit, mounted once in the app layout. On a phone it rises from the bottom like the other sheets.
export function VisitSheet() {
  const box = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<Open | null>(null);
  const [visit, setVisit] = useState<VisitData | null>(null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [openId, setOpenId] = useState("");
  // Styles updated while the sheet is open.
  const [posted, setPosted] = useState<Set<string>>(new Set());

  function load(s: Open) {
    setScope(s);
    setVisit(null);
    setError("");
    setPicking(false);
    loadVisit(s).then((r) => {
      if (!r.visit) return setError(r.error ?? "Couldn't load the visit.");
      setVisit(r.visit);
      if (!r.visit.styles.length) setPicking(!s.orderId);
      setOpenId(r.visit.styles[0]?.id ?? "");
    }).catch(() => setError("Couldn't load the visit. Check the connection and try again."));
  }
  useEffect(() => {
    const on = (e: Event) => {
      setPosted(new Set());
      load((e as CustomEvent<Open>).detail);
      box.current?.showModal();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = () => box.current?.close();
  const styles = visit?.styles ?? [];
  const orders = new Set(styles.map((s) => s.orderId)).size;

  function done(id: string) {
    setPosted((p) => new Set(p).add(id));
    // On to the next style not yet updated, so a visit is one tap after another.
    const i = styles.findIndex((s) => s.id === id);
    const next = [...styles.slice(i + 1), ...styles.slice(0, i)].find((s) => !posted.has(s.id) && s.id !== id);
    setOpenId(next?.id ?? "");
    if (scope) loadVisit(scope).then((r) => r.visit && setVisit(r.visit));
  }

  return (
    <dialog ref={box} className="sheet qs vs" aria-labelledby="vs-h" onClick={(e) => { if (e.target === box.current) close(); }} onClose={() => setScope(null)}>
      <div className="sheet-body">
        <span className="grabber" aria-hidden />
        <header className="qs-head">
          <div className="min-w-0">
            <span className="vs-kicker">Factory visit · {visit ? dm(visit.today) : "today"}</span>
            <h2 id="vs-h">{!visit ? "Loading…" : picking || (!visit.factoryName && !scope?.orderId) ? "Which factory are you at?" : visit.factoryName || `${styles[0]?.orderNo ?? "Order"} · ${styles[0]?.buyer ?? ""}`}</h2>
            {visit && !picking && styles.length > 0 && (
              <p>
                {plural(styles.length, "style")}{orders > 1 ? ` · ${plural(orders, "order")}` : ""}
                {posted.size > 0 && <> · <b className="text-ok">{posted.size} updated</b></>}
                {visit.factories.length > 1 && !scope?.orderId && <> · <button type="button" className="link" onClick={() => setPicking(true)}>Another factory</button></>}
              </p>
            )}
          </div>
          <button type="button" className="qs-x" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>

        {error ? <p className="errbox mt-3">{error}</p> : !visit ? (
          <div className="qs-skel" aria-hidden><i /><i /><i /><i /></div>
        ) : picking || (!visit.factoryName && !scope?.orderId) ? (
          visit.factories.length === 0 ? <p className="qs-note">No factory has production running yet. Updates start once a factory PO is released.</p> : (
            <ul className="vs-pick">
              {visit.factories.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => load({ factoryId: f.id })} aria-current={f.id === visit.factoryId || undefined}>
                    <b>{f.name}</b><small>{plural(f.styles, "style")} in production</small>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : styles.length === 0 ? (
          <p className="qs-note">Nothing in production here yet. Updates start once the factory PO is released.</p>
        ) : (
          <div className="vs-list">
            {styles.map((s) => (
              <StyleCard key={`${s.id}:${s.steps.filter((x) => x.done).length}`} s={s} companyId={visit.companyId} today={visit.today} open={openId === s.id} posted={posted.has(s.id)}
                onToggle={() => setOpenId(openId === s.id ? "" : s.id)} onPosted={() => done(s.id)} />
            ))}
          </div>
        )}

        <footer className="qs-foot">
          <button type="button" className="btn qs-go" onClick={close}>{posted.size ? `Finish visit · ${plural(posted.size, "update")} posted` : "Close"}</button>
        </footer>
      </div>
    </dialog>
  );
}

// One style on the visit: where it is, and the update for it.
function StyleCard({ s, companyId, today, open, posted, onToggle, onPosted }: {
  s: VisitStyle; companyId: string; today: string; open: boolean; posted: boolean; onToggle: () => void; onPosted: () => void;
}) {
  const router = useRouter();
  const steps = openSteps(s);
  const first = steps[0];
  const [stage, setStage] = useState(first?.key ?? "");
  const [all, setAll] = useState(false);
  const [status, setStatus] = useState<FloorStatus | "">("");
  const [qty, setQty] = useState("");
  const [ready, setReady] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const card = useRef<HTMLElement>(null);
  // The style that opens next comes into view, so the visit flows down the list.
  useEffect(() => { if (open) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [open]);
  const cur = s.steps.find((x) => x.key === stage);
  const w = first ? when(first.planned, today) : null;
  const noDone = NOT_DONE_ON_VISIT[stage];
  const total = `${s.qty.toLocaleString("en-IN")} ${s.unit}`;
  const shown = all ? steps : steps.slice(0, 4).concat(steps.slice(4).filter((x) => x.key === stage));
  const missing = !stage ? "Pick the step" : !status ? "Pick how it is" : status === "behind" && !ready ? "Give the ready date"
    : status === "issue" && !note.trim() ? "Say what the problem is" : !files.length ? "Add a photo" : "";

  function save() {
    if (!status || missing) return;
    setError("");
    start(async () => {
      try {
        const photos = await uploadPhotos(`${companyId}/${s.orderId}/visits/${s.id}`, files.map((f) => f.file));
        const res = await postFloorUpdate({ lineId: s.id, orderId: s.orderId, stage, status, qty: status === "done" ? "" : qty, expectedOn: ready, note, photos });
        if (res.error) { setError(res.error); return; }
        toast(status === "done" ? `${s.style} ${cur?.label ?? "step"} done today` : `${s.style}: update posted`);
        setStatus(""); setQty(""); setReady(""); setNote(""); setFiles([]);
        onPosted();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photos didn't upload. Try again.");
      }
    });
  }

  return (
    <article ref={card} className={`vs-style ${open ? "open" : ""} ${posted ? "posted" : ""}`}>
      <button type="button" className="vs-head" aria-expanded={open} onClick={onToggle}>
        <span className="vs-ph">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
          {s.photoUrl ? <img src={s.photoUrl} alt="" /> : <span aria-hidden>{s.style.slice(0, 2)}</span>}
        </span>
        <span className="vs-id">
          <b><span className="code">{s.orderNo}</span>{s.style}{s.colour && <small> · {s.colour}</small>}</b>
          <span className={`vs-now ${w?.cls ?? ""}`}>{first ? `${first.label} · ${w?.text}` : "Every step done"}</span>
          {s.last && <small className="vs-last">{floorLine({ status: s.last.status, qty_done: s.last.qtyDone, expected_on: s.last.expectedOn || null }, s.last.step, `${s.qty.toLocaleString("en-IN")} ${s.unit}`, dm)} · {at.format(new Date(s.last.at))} · {s.last.by.split(" ")[0]}</small>}
        </span>
        {posted ? <span className="vs-tick" aria-label="Updated">✓</span> : <span className="vs-chev" aria-hidden />}
      </button>

      {open && first && (
        <div className="vs-form">
          <div className="field"><span>Step</span>
            <div className="vs-steps" role="radiogroup" aria-label={`${s.style} step`}>
              {shown.map((x) => {
                const ww = when(x.planned, today);
                return (
                  <button key={x.key} type="button" role="radio" aria-checked={stage === x.key} onClick={() => { setStage(x.key); if (NOT_DONE_ON_VISIT[x.key] && status === "done") setStatus(""); }}>
                    {x.label}<small className={ww.cls}>{ww.text}</small>
                  </button>
                );
              })}
              {!all && steps.length > 4 && <button type="button" className="vs-more" onClick={() => setAll(true)}>+{steps.length - 4} more</button>}
            </div>
          </div>

          <div className="field"><span>How is it?</span>
            <div className="vs-status" role="radiogroup" aria-label={`How ${cur?.label ?? "the step"} is`}>
              {FLOOR_STATUS.map((x) => {
                const off = x.key === "done" && !!noDone;
                return (
                  <button key={x.key} type="button" role="radio" aria-checked={status === x.key} className={`tone-${x.tone || "plain"}`} disabled={off} onClick={() => setStatus(x.key)}>
                    <i aria-hidden /><b>{x.label}</b><small>{off ? noDone : x.hint}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {(status === "behind" || status === "issue") && (
            <label className="field"><span>Ready by{status === "behind" && <i> *</i>}</span>
              <input className="inp" type="date" min={today} value={ready} onChange={(e) => setReady(e.target.value)} />
              {cur?.planned && <small>Target was {dm(cur.planned)}.</small>}
            </label>
          )}
          {status && status !== "done" && !noDone && (
            <label className="field"><span>{s.unit === "m" ? "Metres" : "Pieces"} done so far</span>
              <span className="vs-qty"><input className="inp num" inputMode="numeric" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value)} /><small>of {total}</small></span>
            </label>
          )}
          {status && (
            <label className="field"><span>Note{status === "issue" && <i> *</i>}</span>
              <textarea className="inp" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={status === "issue" ? "What is wrong, e.g. shade difference on 40 pcs" : status === "behind" ? "Why, e.g. fabric came 3 days late" : "Anything the team should know"} />
            </label>
          )}
          {status && <PhotoPicker files={files} onChange={setFiles} disabled={pending} label="Photos from the floor" />}

          {error && <p className="qs-err" role="alert">{error}</p>}
          <button type="button" className={`btn primary qs-go ${status === "done" ? "" : "vs-go"}`} disabled={pending || !!missing} onClick={save}>
            {pending ? "Posting…" : missing || (status === "done" ? `Mark ${cur?.label ?? "it"} done` : "Post update")}
          </button>
        </div>
      )}
    </article>
  );
}
