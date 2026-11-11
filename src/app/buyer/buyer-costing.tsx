"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { dayNear as day, money, qty } from "@/lib/format";
import { uploadPhotos } from "@/lib/photos";
import { answerCosting, askCosting } from "./actions";
import { costingState, type BuyerCostingAsk } from "./costing-state";

const blank = { product: "", details: "", qty: "", target: "" };

// The buyer's costings: ask for the price of an exact product, then see each ask through to an order.
export function BuyerCosting({ companyId, asks, canWrite, today }: { companyId: string; asks: BuyerCostingAsk[]; canWrite: boolean; today: string }) {
  const router = useRouter();
  const askBox = useRef<HTMLDialogElement>(null);
  const answerBox = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<Picked[]>([]);
  const [pick, setPick] = useState<{ a: BuyerCostingAsk; accept: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [pending, start] = useTransition();
  if (!canWrite && !asks.length) return null;

  function openAsk() {
    setError(""); setField("");
    askBox.current?.showModal();
  }
  function send() {
    setError(""); setField("");
    if (!form.product.trim()) { setField("product"); return setError("Say what the product is, like \"Cotton co-ord set\"."); }
    if (!form.qty.trim()) { setField("qty"); return setError("Enter how many pieces you need, like 500."); }
    start(async () => {
      try {
        const id = crypto.randomUUID();
        const paths = files.length ? await uploadPhotos(`${companyId}/inquiries/${id}`, files.map((f) => f.file)) : [];
        const res = await askCosting(id, form, paths);
        if (res.error) return setError(res.error);
        askBox.current?.close();
        setForm(blank); setFiles([]);
        toast(`Sent as ${res.no}. Send your sample to Sourcingo marked ${res.no}.`);
        router.refresh();
      } catch (e) {
        setError(caught(e, "Couldn't send the photos. Try again."));
      }
    });
  }
  function openAnswer(a: BuyerCostingAsk, accept: boolean) {
    setPick({ a, accept }); setNote(""); setError("");
    answerBox.current?.showModal();
  }
  function answer() {
    if (!pick) return;
    if (!pick.accept && !note.trim()) return setError("Say what to change, like a target price or a different fabric.");
    setError("");
    start(async () => {
      let res: { error?: string };
      try { res = await answerCosting(pick.a.id, pick.accept, note); } catch (e) { res = { error: caught(e, "It didn't send. Try again.") }; }
      if (res.error) return setError(res.error);
      answerBox.current?.close();
      toast(pick.accept ? "Accepted. Send your PO below, and Sourcingo makes the order." : "Sent. Sourcingo will revise the price.");
      router.refresh();
    });
  }

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const open = asks.filter((a) => a.status === "new" || a.status === "quoted");
  const closed = asks.filter((a) => a.status !== "new" && a.status !== "quoted");
  const waiting = open.filter((a) => costingState(a, today).waits).length;

  const item = (a: BuyerCostingAsk) => {
    const s = costingState(a, today);
    const canAnswer = canWrite && a.status === "quoted" && !!a.quote && !a.answer;
    const ended = !!a.quote?.valid_till && a.quote.valid_till < today;
    return (
      <li key={a.id} className="bcost-item">
        <div className="bsmp-h">
          <span className="smp-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links */}
            {a.photoUrls[0] ? <img src={a.photoUrls[0]} alt="" /> : <span aria-hidden>{a.product.slice(0, 2)}</span>}
          </span>
          <div className="min-w-0 grow">
            <div className="smp-title"><b>{a.product}</b></div>
            <div className="smp-sub num">{[a.no, a.qty ? `${qty(a.qty)} pcs` : "", a.target ? `your target ${money(a.target)}` : "", `asked ${day(a.asked_at.slice(0, 10))}`].filter(Boolean).join(" · ")}</div>
            {s.chip && <span className={`chip ${s.chip.cls} mt-1.5`}>{s.chip.text}</span>}
          </div>
        </div>
        {a.quote && a.status !== "lost" && (
          <div className="bcost-quote">
            <span className="eyebrow">{a.quote.round > 1 ? `Revised price (${a.quote.round})` : "Sourcingo's price"}</span>
            <b className="num">{money(a.quote.price)}<small> a piece</small></b>
            <span className="muted num">
              {[a.quote.qty ? `for ${qty(a.quote.qty)} pcs` : "", a.quote.qty ? `${money(Math.round(a.quote.price * a.quote.qty))} in all` : "",
                a.quote.valid_till ? `${ended ? "held" : "holds"} till ${day(a.quote.valid_till)}` : ""].filter(Boolean).join(" · ")}
            </span>
            {a.quote.note && <q className="bsmp-note">{a.quote.note}</q>}
          </div>
        )}
        <p className="bsmp-ship">{s.text}</p>
        {a.answer === "changes" && a.answer_note && a.status === "quoted" && <p className="muted text-[12.5px]">You wrote: “{a.answer_note}”</p>}
        {canAnswer && (
          <div className="bsmp-acts">
            {!ended && <button type="button" className="btn done-btn" onClick={() => openAnswer(a, true)}><span aria-hidden className="done-tick">✓</span>Accept</button>}
            <button type="button" className="btn" onClick={() => openAnswer(a, false)}>Ask to revise</button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className={`card bcost${waiting ? " wait" : ""}`} aria-labelledby="bcost-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="bcost-h">Costings</h2>
          <p>Get Sourcingo&apos;s price for an exact product. Send the sample to our office, and the price comes back here.</p>
        </div>
        {waiting > 0 && <span className="chip warn">{waiting} waiting for you</span>}
      </header>
      {open.length > 0 && <ul className="bcost-list">{open.map(item)}</ul>}
      {canWrite && (
        <div className="bcost-new">
          <button type="button" className={`btn ${open.length ? "" : "primary"}`} onClick={openAsk}>Ask for a costing</button>
        </div>
      )}
      {closed.length > 0 && (
        <details className="bmore">
          <summary>Earlier costings ({closed.length})</summary>
          <ul className="bcost-list">{closed.map(item)}</ul>
        </details>
      )}

      <dialog ref={askBox} className="sheet" aria-labelledby="bcost-ask-h" onClick={(e) => { if (e.target === askBox.current && !pending) askBox.current?.close(); }}>
        <div className="sheet-body">
          <span className="grabber" aria-hidden />
          <div className="row justify-between">
            <h2 id="bcost-ask-h" className="text-[17px] font-semibold">Ask for a costing</h2>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => askBox.current?.close()}>Close</button>
          </div>
          <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label className="field"><span>Product <i>*</i></span>
              <input className="inp" value={form.product} maxLength={200} onChange={set("product")} disabled={pending} placeholder="Cotton co-ord set, printed"
                aria-invalid={field === "product" || undefined} autoComplete="off" />
            </label>
            <label className="field"><span>Pieces <i>*</i></span>
              <input className="inp num" inputMode="numeric" value={form.qty} maxLength={12} onChange={set("qty")} disabled={pending} placeholder="500"
                aria-invalid={field === "qty" || undefined} />
            </label>
            <label className="field"><span>Target price a piece <small className="muted">optional</small></span>
              <input className="inp num" inputMode="decimal" value={form.target} maxLength={12} onChange={set("target")} disabled={pending} placeholder="₹ 450" />
            </label>
            <label className="field"><span>Details <small className="muted">optional</small></span>
              <textarea className="inp" rows={3} value={form.details} maxLength={4000} onChange={set("details")} disabled={pending}
                placeholder="Sizes S to XL, 2 colours, same fabric as the sample, delivery by March…" />
            </label>
            <PhotoPicker files={files} onChange={setFiles} max={8} disabled={pending} label="Photos of the sample (optional)" />
            {error && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
            <p className="muted text-[12.5px]">After you send, post or bring the sample to the Sourcingo office with the number you get, so we cost the exact piece.</p>
            <div className="sheet-acts">
              <button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
            </div>
          </form>
        </div>
      </dialog>

      <dialog ref={answerBox} className="sheet" aria-labelledby="bcost-ans-h" onClick={(e) => { if (e.target === answerBox.current && !pending) answerBox.current?.close(); }}>
        {pick && pick.a.quote && (
          <div className="sheet-body">
            <span className="grabber" aria-hidden />
            <div className="row justify-between">
              <h2 id="bcost-ans-h" className="text-[17px] font-semibold">{pick.a.product}: {money(pick.a.quote.price)} a piece</h2>
              <button type="button" className="btn ghost sm" disabled={pending} onClick={() => answerBox.current?.close()}>Close</button>
            </div>
            <div className="seg mt-3 w-full" role="radiogroup" aria-label="Your answer">
              {!(pick.a.quote.valid_till && pick.a.quote.valid_till < today) && (
                <button type="button" role="radio" aria-checked={pick.accept} disabled={pending} onClick={() => setPick({ ...pick, accept: true })}>Accept</button>
              )}
              <button type="button" role="radio" aria-checked={!pick.accept} disabled={pending} onClick={() => setPick({ ...pick, accept: false })}>Ask to revise</button>
            </div>
            <label className="field mt-3"><span>{pick.accept ? "Anything to add (optional)" : "What should change?"}</span>
              <textarea className="inp h-24 resize-none font-[inherit]" maxLength={1000} value={note} disabled={pending} onChange={(e) => setNote(e.target.value)}
                placeholder={pick.accept ? "e.g. PO follows this week." : "e.g. Our target is ₹ 420. Can you try a cheaper lining?"} />
            </label>
            {pick.accept && <p className="mt-2 muted text-[12.5px]">Accepting tells Sourcingo to go ahead. Send your PO from this page, and it becomes your order.</p>}
            {error && <p className="mt-3 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
            <div className="sheet-acts">
              <button type="button" className={`btn ${pick.accept ? "primary" : ""}`} disabled={pending} onClick={answer}>
                {pending ? "Sending…" : pick.accept ? "Accept price" : "Send"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
