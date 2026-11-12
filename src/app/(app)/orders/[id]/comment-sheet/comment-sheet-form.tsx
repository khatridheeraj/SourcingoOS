"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PhotoPicker, type Picked } from "@/components/photo-picker";
import { toast } from "@/components/toast";
import { caught } from "@/lib/errors";
import { addDays, dm } from "@/lib/quick";
import { uploadPhotos, uploadReports } from "@/lib/photos";
import { FALLBACK_CORRECTION, isDeviation, NEXT_STEP, SHEET_STAGES, sheetFileName, sheetProblem, sheetRows, sheetSummary, sheetText, VERDICTS, type SheetData, type SheetRow, type SheetVerdict } from "@/lib/comment-sheet";
import { reserveSheetRef, saveCommentSheet } from "./actions";
import type { QcFile } from "../../actions";

export type SheetStyle = { id: string; style: string; colour: string; factory: string };

// A photo for the PDF: a JPEG under 1200 px, so the file stays light on WhatsApp.
async function toJpeg(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("Couldn't read that photo."))), "image/jpeg", 0.82));
  return new Uint8Array(await blob.arrayBuffer());
}

export function CommentSheetForm({ orderId, orderNo, companyId, buyer, styles, startLine, today, checkedBy }: {
  orderId: string; orderNo: string; companyId: string; buyer: string; styles: SheetStyle[]; startLine: string; today: string; checkedBy: string;
}) {
  const router = useRouter();
  const [lineId, setLineId] = useState(startLine);
  const [stage, setStage] = useState("pp");
  const [size, setSize] = useState("");
  const [on, setOn] = useState(today);
  const [verdict, setVerdict] = useState<SheetVerdict>("not_approved");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [summary, setSummary] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [step, setStep] = useState("");
  const [pending, start] = useTransition();
  const style = styles.find((s) => s.id === lineId);
  const lines = notes.split("\n").map((s) => s.trim()).filter(Boolean);

  const data: SheetData = {
    refNo: "", date: on, buyer, style: style ? `${style.style}${style.colour ? ` · ${style.colour}` : ""}` : "", factory: style?.factory ?? "", stage, size,
    checkedBy, verdict, summary, nextStep: nextStep || NEXT_STEP[verdict], rows,
  };

  function format(verbatim: boolean) {
    setErr("");
    if (!lines.length) return setErr("Type at least one comment first.");
    const r = sheetRows(notes, verbatim);
    setRows(r);
    setSummary(sheetSummary(r, verdict));
    if (!nextStep) setNextStep(NEXT_STEP[verdict]);
  }
  function pickVerdict(v: SheetVerdict) {
    setVerdict(v);
    if (rows.length) setSummary(sheetSummary(rows, v));
    if (!nextStep || Object.values(NEXT_STEP).includes(nextStep)) setNextStep(NEXT_STEP[v]);
  }
  const edit = (i: number, k: keyof SheetRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const drop = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const todo = rows.filter((r) => r.correction === FALLBACK_CORRECTION).length;

  async function copyText() {
    try { await navigator.clipboard.writeText(sheetText({ ...data, refNo: data.refNo || "(draft)" }, orderNo)); toast("Copied. Paste it into WhatsApp.", "ok"); }
    catch { setErr("Couldn't copy here. Save the sheet and send the PDF instead."); }
  }

  function save() {
    setErr("");
    if (!style) return setErr("Pick the style.");
    const problem = sheetProblem(data);
    if (problem) return setErr(problem);
    start(async () => {
      try {
        setStep("Numbering the sheet…");
        const r = await reserveSheetRef();
        if (!r.ref) { setErr(r.error ?? "Couldn't number the sheet."); return; }
        const d: SheetData = { ...data, refNo: r.ref };
        setStep("Making the PDF…");
        const logo = await fetch("/sourcingo-logo.png").then((x) => (x.ok ? x.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null);
        const pics = [];
        for (const p of photos) pics.push({ jpeg: await toJpeg(p.file), caption: captions[p.url] ?? "" });
        const { renderCommentSheet } = await import("@/lib/comment-sheet-pdf");
        const bytes = await renderCommentSheet(d, orderNo, logo, pics);
        const name = sheetFileName(d.refNo, style.style);
        const pdf = new File([bytes as BlobPart], name, { type: "application/pdf" });
        setStep("Saving to the order…");
        const qcId = crypto.randomUUID();
        const folder = `${companyId}/${orderId}/qc/${qcId}`;
        const docs = await uploadReports(folder, [pdf]);
        const paths = photos.length ? await uploadPhotos(folder, photos.map((p) => p.file)) : [];
        const files: QcFile[] = [...docs.map((x) => ({ path: x.path, kind: "report" as const, file_name: x.file_name })), ...paths.map((path) => ({ path, kind: "photo" as const, file_name: "" }))];
        const res = await saveCommentSheet(orderId, qcId, style.id, d, files);
        if (res.error) { setErr(res.error); return; }
        // The PDF goes to the phone or computer as well, ready to send.
        const url = URL.createObjectURL(pdf);
        const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        toast(`${d.refNo} saved on ${style.style} and downloaded.`, "ok");
        router.push(`/orders/${orderId}#qc`);
        router.refresh();
      } catch (e) {
        setErr(caught(e, "Couldn't save the sheet. Check the connection and try again."));
      } finally {
        setStep("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card" aria-labelledby="cs-1">
        <header className="card-h"><div><h2 id="cs-1">1 · Sample</h2></div></header>
        <div className="flex flex-col gap-4 p-4">
          <div>
            <p className="qs-label">Style</p>
            <div className="qs-chips qc-chips mt-3" role="radiogroup" aria-label="Style">
              {styles.map((s) => <button key={s.id} type="button" role="radio" aria-checked={s.id === lineId} onClick={() => setLineId(s.id)}>{s.style}{s.colour && <small>{s.colour}</small>}</button>)}
            </div>
            {style && <p className="muted mt-2 text-[12.5px]">Factory: {style.factory || "not assigned yet"}</p>}
          </div>
          <div>
            <p className="qs-label">Sample stage</p>
            <div className="qs-chips qc-chips mt-3" role="radiogroup" aria-label="Sample stage">
              {SHEET_STAGES.map((s) => <button key={s.key} type="button" role="radio" aria-checked={s.key === stage} onClick={() => setStage(s.key)}>{s.label}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field"><span>Size</span><input className="inp" value={size} maxLength={40} onChange={(e) => setSize(e.target.value)} placeholder="e.g. M" /></label>
            <label className="field"><span>Checked on</span>
              <select className="inp" value={[today, addDays(today, -1), addDays(today, -2)].includes(on) ? on : "other"} onChange={(e) => e.target.value !== "other" && setOn(e.target.value)}>
                <option value={today}>Today</option><option value={addDays(today, -1)}>Yesterday</option><option value={addDays(today, -2)}>{dm(addDays(today, -2))}</option>
                {![today, addDays(today, -1), addDays(today, -2)].includes(on) && <option value="other">{dm(on)}</option>}
              </select>
            </label>
          </div>
          <div>
            <p className="qs-label">Result</p>
            <div className="qs-chips qc-chips mt-3" role="radiogroup" aria-label="Result">
              {VERDICTS.map((v) => <button key={v.key} type="button" role="radio" aria-checked={v.key === verdict} onClick={() => pickVerdict(v.key)}>{v.label}</button>)}
            </div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="cs-2">
        <header className="card-h"><div><h2 id="cs-2">2 · Comments</h2><p>One point per line, in your own words.</p></div></header>
        <div className="flex flex-col gap-3 p-4">
          <textarea className="inp" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending}
            placeholder={"sleeve 2 inch short\nhem fold showing from outside\nwash care label missing\nno fusing should be applied on collar band"} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn primary" disabled={pending} onClick={() => format(false)}>Format comments</button>
            <button type="button" className="btn" disabled={pending} onClick={() => format(true)}>Add as typed</button>
          </div>
          <p className="muted text-[12.5px]">A correction is never guessed. Where your line doesn&apos;t say what to do, it reads &ldquo;{FALLBACK_CORRECTION}&rdquo; — edit that cell to be specific.</p>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card" aria-labelledby="cs-3">
          <header className="card-h"><div><h2 id="cs-3">3 · Check the sheet</h2><p>{rows.length} {rows.length === 1 ? "point" : "points"}{todo ? ` · ${todo} ${todo === 1 ? "correction" : "corrections"} to fill in` : ""}</p></div></header>
          <div className="flex flex-col gap-3 p-4">
            <div className="row">
              <span className={`chip ${VERDICTS.find((v) => v.key === verdict)!.cls}`}>{VERDICTS.find((v) => v.key === verdict)!.badge}</span>
            </div>
            <label className="field"><span>Summary (one line)</span><input className="inp" value={summary} maxLength={400} onChange={(e) => setSummary(e.target.value)} /></label>
            <ol className="flex flex-col gap-3 p-0">
              {rows.map((r, i) => (
                <li key={i} className="rounded-xl border border-line p-3">
                  <div className="row mb-2"><b className="num">{i + 1}</b>
                    <input className="inp grow" aria-label={`Area ${i + 1}`} value={r.area} maxLength={300} onChange={(e) => edit(i, "area", e.target.value)} placeholder="Area" />
                    <button type="button" className="btn sm" aria-label={`Remove point ${i + 1}`} onClick={() => drop(i)}>✕</button>
                  </div>
                  <label className="field mb-2"><span>Observation</span>
                    <textarea className="inp" rows={2} value={r.observation} maxLength={300} style={isDeviation(r.observation) ? { color: "var(--bad)" } : undefined} onChange={(e) => edit(i, "observation", e.target.value)} /></label>
                  <label className="field"><span>Correction required{r.correction === FALLBACK_CORRECTION && <i> · fill in</i>}</span>
                    <textarea className="inp" rows={2} value={r.correction} maxLength={300} aria-invalid={r.correction === FALLBACK_CORRECTION || undefined} onChange={(e) => edit(i, "correction", e.target.value)} /></label>
                </li>
              ))}
            </ol>
            <label className="field"><span>Next step</span><textarea className="inp" rows={2} value={nextStep || NEXT_STEP[verdict]} maxLength={400} onChange={(e) => setNextStep(e.target.value)} /></label>
            <div>
              <PhotoPicker files={photos} onChange={setPhotos} disabled={pending} label="Photos (go on the sheet and the order)" />
              {photos.map((p, i) => (
                <input key={p.url} className="inp mt-2" value={captions[p.url] ?? ""} maxLength={120} placeholder={`Caption for photo ${i + 1}, e.g. Collar band — fusing`} aria-label={`Caption for photo ${i + 1}`}
                  onChange={(e) => setCaptions({ ...captions, [p.url]: e.target.value })} />
              ))}
            </div>
            {err && <p className="errbox" role="alert">{err}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? step || "Saving…" : "Save sheet & download PDF"}</button>
              <button type="button" className="btn" disabled={pending} onClick={copyText}>Copy as text</button>
            </div>
            <p className="muted text-[12px]">Saving records a {SHEET_STAGES.find((s) => s.key === stage)?.label.toLowerCase()} QC {VERDICTS.find((v) => v.key === verdict)!.result} on {style?.style ?? "the style"}, with the PDF and photos on the order&apos;s QC tab.</p>
          </div>
        </section>
      )}
      {!rows.length && err && <p className="errbox" role="alert">{err}</p>}
    </div>
  );
}
