"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { blankSheet, sheetFrom, sheetProblem, totals, type Sheet } from "@/lib/costing";
import { caught } from "@/lib/errors";
import { dayNear, money } from "@/lib/format";
import { addDays } from "@/lib/payments";
import { answerSeen, saveCostingDraft, sendCosting, setSampleIn } from "../actions";

export type SentCosting = { id: string; sheet: unknown; cost: number; price: number; qty: number | null; valid_till: string | null; note: string | null; created_at: string; by: string };

// The costing of one inquiry: for a buyer-page ask, first the buyer's sample arriving at the office; then the costing
// itself (fabric in metres, trims, stitching, other costs, margin) and the quote sent; then the buyer's answer.
export function CostingCard({ id, no, buyer, open, fromPage, sampleIn, sampleInNote, draft, sent, answer, answerNote, answerAt, answerSeenAt, estQty, today }: {
  id: string; no: string; buyer: string; open: boolean; fromPage: boolean; sampleIn: string | null; sampleInNote: string | null;
  draft: unknown; sent: SentCosting[]; answer: "accepted" | "changes" | null; answerNote: string | null; answerAt: string | null;
  answerSeenAt: string | null; estQty: number | null; today: string;
}) {
  const router = useRouter();
  const last = sent[0] ?? null;
  const [sheet, setSheet] = useState<Sheet>(() => (draft ? sheetFrom(draft) : last ? sheetFrom(last.sheet) : blankSheet()));
  const t = totals(sheet);
  // The price follows the worked-out one until someone types their own.
  const [own, setOwn] = useState("");
  const price = own || (t.price ? String(t.price) : "");
  const [valid, setValid] = useState(addDays(today, 15));
  const [note, setNote] = useState("");
  const [arrived, setArrived] = useState({ on: today, note: "" });
  const [mode, setMode] = useState<"" | "sample" | "build">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  const waitingSample = fromPage && !sampleIn;
  const answerOpen = !!answer && !answerSeenAt && open;
  // The costing is open when it is the next job: nothing sent yet, or the buyer asked for a new price.
  const building = open && !waitingSample && (mode === "build" || !last || (answerOpen && answer === "changes"));

  if (!open && !last && !fromPage) return null;

  function run(label: string, job: () => Promise<{ error?: string }>, done: string, after?: () => void) {
    setError(""); setBusy(label);
    start(async () => {
      let res: { error?: string };
      try { res = await job(); } catch (e) { res = { error: caught(e, "It didn't save. Try again.") }; }
      setBusy("");
      if (res.error) return setError(res.error);
      toast(done);
      after?.();
      router.refresh();
    });
  }

  const edit = (f: (s: Sheet) => Sheet) => setSheet((s) => f(structuredClone(s)));
  const problem = sheetProblem(sheet, price);

  return (
    <section className="panel cost" aria-labelledby="cost-h">
      <div className="row !items-start">
        <div className="grow min-w-0">
          <h2 id="cost-h" className="!mb-0">Costing</h2>
          {fromPage && <p className="text-[13px] text-muted">{buyer} asked for this on their page. They see the price a piece, never the costs or margin.</p>}
        </div>
        {last && open && !building && <button type="button" className="btn sm" onClick={() => setMode("build")}>Revise the costing</button>}
      </div>

      {waitingSample && open && (
        <div className="cost-wait">
          <p><b>Waiting for {buyer}&apos;s sample.</b> They were asked to send it marked <span className="code">{no}</span>. The costing starts when it arrives.</p>
          {mode !== "sample" ? (
            <button type="button" className="btn primary" onClick={() => setMode("sample")}>Sample arrived</button>
          ) : (
            <div className="inq-choice">
              <div className="fgrid">
                <label className="field"><span>Arrived on</span>
                  <input className="inp" type="date" max={today} value={arrived.on} onChange={(e) => setArrived({ ...arrived, on: e.target.value })} />
                </label>
                <label className="field"><span>What came <small className="muted">optional</small></span>
                  <input className="inp" maxLength={300} value={arrived.note} onChange={(e) => setArrived({ ...arrived, note: e.target.value })} placeholder="1 pc, size M, by DTDC" />
                </label>
              </div>
              <div className="row">
                <button type="button" className="btn primary" disabled={pending} onClick={() => run("sample", () => setSampleIn(id, arrived.on, arrived.note), "Sample noted. The costing is next.", () => setMode(""))}>
                  {busy === "sample" ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {fromPage && sampleIn && <p className="mt-2 text-[13px] text-muted">Sample in the office since {dayNear(sampleIn, today)}{sampleInNote ? ` · ${sampleInNote}` : ""}</p>}

      {answerOpen && (
        <div className={`${answer === "accepted" ? "okbox" : "warnbox"} cost-answer`}>
          <p>
            <b>{answer === "accepted" ? `${buyer} accepted ${money(last?.price)} a piece` : `${buyer} asked to revise ${money(last?.price)}`}</b>
            {answerAt && <span className="muted"> · {dayNear(answerAt.slice(0, 10), today)}</span>}
          </p>
          {answerNote && <q className="bsmp-note">{answerNote}</q>}
          <p className="text-[13px]">{answer === "accepted" ? "Make the order from Next step when their PO comes." : "Change the costing below and send the new price."}</p>
          <button type="button" className="btn sm" disabled={pending} onClick={() => run("seen", () => answerSeen(id), "Taken off Home")}>{busy === "seen" ? "Saving…" : "Done"}</button>
        </div>
      )}

      {last && (
        <div className="cost-sent">
          <div className="cost-sent-h">
            <span className="eyebrow">{sent.length > 1 ? `Price sent (${sent.length})` : "Price sent"}</span>
            <b className="num">{money(last.price)}<small> a piece</small></b>
            <span className="muted num text-[13px]">
              {[`cost ${money(last.cost)}`, last.cost > 0 ? `${Math.round(((last.price - last.cost) / last.cost) * 100)}% over cost` : "",
                last.valid_till ? `holds till ${dayNear(last.valid_till, today)}` : "", `${dayNear(last.created_at.slice(0, 10), today)} by ${last.by}`].filter(Boolean).join(" · ")}
            </span>
          </div>
          {last.note && <q className="bsmp-note">{last.note}</q>}
          {sent.length > 1 && (
            <p className="text-[12.5px] text-muted">Earlier: {sent.slice(1).map((c) => `${money(c.price)} on ${dayNear(c.created_at.slice(0, 10), today)}`).join(" · ")}</p>
          )}
        </div>
      )}

      {building && (
        <div className="cost-build">
          <h3>Fabric <small>metres a piece × ₹ a metre</small></h3>
          <ul className="cost-rows">
            {sheet.fabrics.map((f, n) => (
              <li key={n} className="cost-row cfab">
                <input className="inp" aria-label={`Fabric ${n + 1} name`} value={f.name} maxLength={80} placeholder="Cotton cambric"
                  onChange={(e) => edit((s) => { s.fabrics[n].name = e.target.value; return s; })} />
                <label className="cost-num"><input className="inp num" inputMode="decimal" aria-label={`Fabric ${n + 1} metres a piece`} value={f.metres} maxLength={8} placeholder="2.4"
                  onChange={(e) => edit((s) => { s.fabrics[n].metres = e.target.value; return s; })} /><span>m</span></label>
                <label className="cost-num"><span>₹</span><input className="inp num" inputMode="decimal" aria-label={`Fabric ${n + 1} rupees a metre`} value={f.rate} maxLength={10} placeholder="180"
                  onChange={(e) => edit((s) => { s.fabrics[n].rate = e.target.value; return s; })} /></label>
                <b className="num cost-amt">{money(totals({ fabrics: [f], costs: [], margin: "0" }).fabric) || "—"}</b>
                <button type="button" className="btn ghost sm" aria-label={`Remove fabric ${n + 1}`} onClick={() => edit((s) => { s.fabrics.splice(n, 1); return s; })}>×</button>
              </li>
            ))}
          </ul>
          {sheet.fabrics.length < 12 && <button type="button" className="btn ghost sm cost-add" onClick={() => edit((s) => { s.fabrics.push({ name: "", metres: "", rate: "" }); return s; })}>+ Add fabric</button>}

          <h3>Other costs <small>₹ a piece</small></h3>
          <ul className="cost-rows">
            {sheet.costs.map((c, n) => (
              <li key={n} className="cost-row coth">
                <input className="inp" aria-label={`Cost ${n + 1} name`} value={c.name} maxLength={80} placeholder="Embroidery"
                  onChange={(e) => edit((s) => { s.costs[n].name = e.target.value; return s; })} />
                <label className="cost-num"><span>₹</span><input className="inp num" inputMode="decimal" aria-label={`${c.name || `Cost ${n + 1}`}, rupees a piece`} value={c.amount} maxLength={10} placeholder="0"
                  onChange={(e) => edit((s) => { s.costs[n].amount = e.target.value; return s; })} /></label>
                <button type="button" className="btn ghost sm" aria-label={`Remove ${c.name || `cost ${n + 1}`}`} onClick={() => edit((s) => { s.costs.splice(n, 1); return s; })}>×</button>
              </li>
            ))}
          </ul>
          {sheet.costs.length < 20 && <button type="button" className="btn ghost sm cost-add" onClick={() => edit((s) => { s.costs.push({ name: "", amount: "" }); return s; })}>+ Add cost</button>}

          <dl className="cost-sum num">
            <div><dt>Fabric</dt><dd>{money(t.fabric)}</dd></div>
            <div><dt>Other costs</dt><dd>{money(t.other)}</dd></div>
            <div className="tot"><dt>Cost a piece</dt><dd>{money(t.cost)}</dd></div>
            <div><dt><label htmlFor="cost-margin">Margin</label></dt>
              <dd><span className="cost-num"><input id="cost-margin" className="inp num" inputMode="decimal" value={sheet.margin} maxLength={6}
                onChange={(e) => edit((s) => { s.margin = e.target.value; return s; })} /><span>%</span></span></dd></div>
            <div className="tot"><dt>Price at that margin</dt><dd>{money(t.price)}</dd></div>
          </dl>

          <div className="fgrid">
            <label className="field"><span>Price a piece to send <i>*</i></span>
              <input className="inp num" inputMode="decimal" value={price} maxLength={12} onChange={(e) => setOwn(e.target.value)} placeholder={t.price ? String(t.price) : "450"} />
              {own && Number(own) !== t.price && t.price > 0 && <small className="muted">Worked out: {money(t.price)}. <button type="button" className="link" onClick={() => setOwn("")}>Use it</button></small>}
            </label>
            <label className="field"><span>Price holds till</span>
              <input className="inp" type="date" min={today} value={valid} onChange={(e) => setValid(e.target.value)} />
            </label>
          </div>
          {estQty && priceNumOk(price) ? <p className="text-[13px] text-muted num">{money(Math.round(Number(price) * estQty))} for {estQty.toLocaleString("en-IN")} pcs</p> : null}
          <label className="field"><span>Note {fromPage ? `for ${buyer}` : ""} <small className="muted">optional</small></span>
            <textarea className="inp" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Price for sizes S to XL, ex-factory Jaipur, 45 days after PO." />
          </label>
          {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn primary" disabled={pending}
              onClick={() => problem ? setError(problem) : run("send", () => sendCosting(id, sheet, price, valid, note),
                fromPage ? `Sent. ${buyer} sees ${money(Number(price))} a piece on their page.` : "Price saved. The inquiry is Quoted.", () => { setMode(""); setOwn(""); setNote(""); })}>
              {busy === "send" ? "Sending…" : fromPage ? `Send price to ${buyer}` : "Save as the quoted price"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => run("draft", () => saveCostingDraft(id, sheet), "Costing kept. Pick it up any time.")}>
              {busy === "draft" ? "Saving…" : "Keep for later"}
            </button>
            {last && mode === "build" && <button type="button" className="btn ghost" onClick={() => setMode("")}>Cancel</button>}
          </div>
        </div>
      )}
      {!building && error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}

      {last && !building && (
        <details className="cost-detail">
          <summary>See the costing</summary>
          <Breakdown sheet={last.sheet} cost={last.cost} />
        </details>
      )}
    </section>
  );
}

const priceNumOk = (s: string) => /^\d+(\.\d+)?$/.test(s.trim()) && Number(s) > 0;

// A sent costing, line by line.
function Breakdown({ sheet, cost }: { sheet: unknown; cost: number }) {
  const s = (sheet ?? {}) as { fabrics?: { name: string; metres: number; rate: number }[]; costs?: { name: string; amount: number }[]; margin?: number };
  return (
    <dl className="cost-sum num">
      {(s.fabrics ?? []).map((f, n) => <div key={`f${n}`}><dt>{f.name} · {f.metres} m × {money(f.rate)}</dt><dd>{money(Math.round(f.metres * f.rate * 100) / 100)}</dd></div>)}
      {(s.costs ?? []).map((c, n) => <div key={`c${n}`}><dt>{c.name}</dt><dd>{money(c.amount)}</dd></div>)}
      <div className="tot"><dt>Cost a piece</dt><dd>{money(cost)}</dd></div>
      {s.margin != null && <div><dt>Margin used</dt><dd>{s.margin}%</dd></div>}
    </dl>
  );
}
