"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadQuick } from "@/app/(app)/orders/quick-actions";
import { recordQc } from "@/app/(app)/orders/actions";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { addDays, dm, live, type QOrder, type QStyle } from "@/lib/quick";
import { QC_KINDS, qcKindLabel, TNA_STEPS } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";

type Open = { orderId: string; kind?: string; lineId?: string };
const EVENT = "sourcingo:qc-sheet";

// Opens the quick QC sheet for an order from anywhere.
export function openQcSheet(orderId: string, kind?: string, lineId?: string) {
  window.dispatchEvent(new CustomEvent<Open>(EVENT, { detail: { orderId, kind, lineId } }));
}

export function QcButton({ orderId, kind, lineId, className = "btn sm", children }: Open & { className?: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => openQcSheet(orderId, kind, lineId)}>{children}</button>;
}

// The QC a style is due for next: the first step not done that has a check.
function dueKind(s: QStyle) {
  for (const x of live(s)) {
    if (x.done_on) continue;
    const qc = TNA_STEPS.find((t) => t.key === x.key)?.qc;
    if (qc) return qc[0];
  }
  return "final";
}

// Recording a QC from a phone in a few taps: style, check, pass or fail, photos from the camera. Pieces, defects and
// notes are there when needed (notes are a must on a fail, so the factory knows what to fix).
export function QcSheet() {
  const box = useRef<HTMLDialogElement>(null);
  const [req, setReq] = useState<Open | null>(null);
  const [order, setOrder] = useState<QOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Open>).detail;
      setReq(d); setOrder(null); setError("");
      box.current?.showModal();
      loadQuick(d.orderId).then((r) => (r.order ? setOrder(r.order) : setError(r.error ?? "Couldn't load this order.")))
        .catch(() => setError("Couldn't load this order. Check the connection and try again."));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const close = () => box.current?.close();

  return (
    <dialog ref={box} className="sheet qs" aria-labelledby="qc-h" onClick={(e) => { if (e.target === box.current) close(); }} onClose={() => setReq(null)}>
      <div className="sheet-body">
        <span className="grabber" aria-hidden />
        <header className="qs-head">
          <div className="min-w-0">
            <h2 id="qc-h">{order ? <><span className="qs-no">{order.orderNo}</span>Record QC</> : "Loading…"}</h2>
            {order && <p>{order.buyer}{order.due ? ` · ships ${dm(order.due)}` : ""}</p>}
          </div>
          <button type="button" className="qs-x" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>
        {error ? <p className="errbox mt-3">{error}</p> : !order || !req ? <div className="qs-skel" aria-hidden><i /><i /><i /></div> : (
          <QcForm key={`${req.orderId}:${req.kind}:${req.lineId}`} order={order} req={req} onDone={close} />
        )}
      </div>
    </dialog>
  );
}

function QcForm({ order, req, onDone }: { order: QOrder; req: Open; onDone: () => void }) {
  const router = useRouter();
  const styles = order.groups.flatMap((g) => g.styles);
  const first = styles.find((s) => s.id === req.lineId) ?? (req.kind ? styles.find((s) => dueKind(s) === req.kind) : null) ?? styles[0];
  // One check or many: the same result, photos and notes are saved for every style picked (Quality often checks a
  // whole shipment at once).
  // From a to-do row: every style still waiting for that check, so a whole shipment is one save.
  const waiting = req.kind && !req.lineId
    ? styles.filter((s) => live(s).some((x) => !x.done_on && TNA_STEPS.find((t) => t.key === x.key)?.qc?.includes(req.kind!))).map((s) => s.id)
    : [];
  const [lineIds, setLineIds] = useState<string[]>(waiting.length ? waiting : first ? [first.id] : []);
  const [on, setOn] = useState(order.today);
  const [kind, setKind] = useState(req.kind ?? (first ? dueKind(first) : "final"));
  const [result, setResult] = useState<"" | "pass" | "fail">("");
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [more, setMore] = useState(false);
  const [pieces, setPieces] = useState("");
  const [defects, setDefects] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const picked = styles.filter((s) => lineIds.includes(s.id));
  const today = order.today;

  function pickStyle(s: QStyle) {
    const next = lineIds.includes(s.id) ? lineIds.filter((x) => x !== s.id) : [...lineIds, s.id];
    setLineIds(next);
    if (!req.kind && next.length === 1) setKind(dueKind(styles.find((x) => x.id === next[0])!));
  }

  function save() {
    setErr("");
    if (!picked.length) return setErr("Pick the style.");
    if (!result) return setErr("Tap Pass or Fail.");
    if (result === "fail" && !notes.trim()) { setMore(true); return setErr("Write what failed, so the factory knows what to fix."); }
    if (!photos.length) return setErr("Add at least one photo as proof of the check.");
    start(async () => {
      // Each style gets its own check with its own copy of the photos, so cancelling one never touches another.
      const saved: string[] = [];
      for (const s of picked) {
        const id = crypto.randomUUID();
        try {
          const paths = await uploadPhotos(`${order.companyId}/${order.id}/qc/${id}`, photos.map((p) => p.file));
          const res = await recordQc(order.id, id, { line_id: s.id, kind, checked_on: on, result, pieces_checked: picked.length === 1 ? pieces : "", defects: picked.length === 1 ? defects : "", notes },
            paths.map((path) => ({ path, kind: "photo" as const, file_name: "" })));
          if (res.error) { setErr(saved.length ? `Saved for ${saved.join(", ")}. ${s.style}: ${res.error}` : res.error); setLineIds(lineIds.filter((x) => !saved.includes(styles.find((y) => y.id === x)?.style ?? ""))); router.refresh(); return; }
          saved.push(s.style);
        } catch (e) {
          setErr(`${saved.length ? `Saved for ${saved.join(", ")}. ` : ""}${e instanceof Error ? e.message : "The photos didn't upload. Try again."}`);
          router.refresh();
          return;
        }
      }
      toast(`${qcKindLabel(kind)} QC ${result === "pass" ? "passed" : "failed"} for ${saved.length === 1 ? saved[0] : `${saved.length} styles`}.`, result === "pass" ? "ok" : "bad");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="qs-form">
      <p className="qs-label">{styles.length > 1 ? "Styles (pick one or more)" : "Style"}</p>
      <div className="qs-chips qc-chips" role="group" aria-label="Styles">
        {styles.map((s) => (
          <button key={s.id} type="button" role="checkbox" aria-checked={lineIds.includes(s.id)} onClick={() => pickStyle(s)}>
            {s.style}{s.colour && <small>{s.colour}</small>}
          </button>
        ))}
      </div>
      <p className="qs-label">Check</p>
      <div className="qs-chips qc-chips" role="radiogroup" aria-label="Type of check">
        {QC_KINDS.map((k) => (
          <button key={k.key} type="button" role="radio" aria-checked={k.key === kind} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>
      <div className="qc-result" role="radiogroup" aria-label="Result">
        <button type="button" role="radio" aria-checked={result === "pass"} className="pass" onClick={() => setResult("pass")}><span aria-hidden>✓</span>Pass</button>
        <button type="button" role="radio" aria-checked={result === "fail"} className="fail" onClick={() => { setResult("fail"); setMore(true); }}><span aria-hidden>✕</span>Fail</button>
      </div>
      <PhotoPicker files={photos} onChange={setPhotos} disabled={pending} label="Photos" />
      {!more ? (
        <button type="button" className="link qc-more" onClick={() => setMore(true)}>+ Pieces, defects and notes</button>
      ) : (
        <div className="qc-extra">
          {picked.length === 1 && <div className="qs-two">
            <label className="field"><span>Pieces checked</span><input className="inp" inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} /></label>
            <label className="field"><span>Defects</span><input className="inp" inputMode="numeric" value={defects} onChange={(e) => setDefects(e.target.value)} placeholder="0" /></label>
          </div>}
          <label className="field"><span>Notes{result === "fail" && <i> *</i>}</span>
            <textarea className="inp" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={result === "fail" ? "What failed and what the factory must fix" : "Anything worth noting"} />
          </label>
        </div>
      )}
      <div className="qs-days" role="radiogroup" aria-label="Checked on">
        {[["Today", today], ["Yesterday", addDays(today, -1)], ["2 days ago", addDays(today, -2)]].map(([t, d]) => (
          <button key={d} type="button" role="radio" aria-checked={on === d} onClick={() => setOn(d)}>{t}</button>
        ))}
        <label className={`qs-pick ${[today, addDays(today, -1), addDays(today, -2)].includes(on) ? "" : "on"}`}>
          <input type="date" value={on} max={today} aria-label="Another day" onChange={(e) => e.target.value && setOn(e.target.value)} />
          <span>{[today, addDays(today, -1), addDays(today, -2)].includes(on) ? "Pick a day" : dm(on)}</span>
        </label>
      </div>
      <footer className="qs-foot">
        {err && <p className="qs-err" role="alert">{err}</p>}
        <button type="button" className={`btn primary qs-go ${result === "fail" ? "danger" : ""}`} disabled={pending} onClick={save}>
          {pending ? "Saving…" : result ? `Save ${qcKindLabel(kind)} ${result === "pass" ? "pass" : "fail"}${picked.length === 1 ? ` · ${picked[0].style}` : picked.length ? ` · ${picked.length} styles` : ""}` : "Save QC"}
        </button>
        <p className="qs-fine">A full report (PDF or Excel) can be added on the order&apos;s QC tab.</p>
      </footer>
    </div>
  );
}
