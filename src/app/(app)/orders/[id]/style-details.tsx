"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { qty } from "@/lib/format";
import { sizeEntries } from "@/lib/sizes";
import { uploadAttachments } from "@/lib/photos";
import { toast } from "@/components/toast";
import { addLineFiles, removeLineFile, saveStyleDetails, type LineFileKind } from "../actions";
import { caught } from "@/lib/errors";
import { wholeText } from "@/lib/digits";

export type LineFile = { id: string; kind: LineFileKind; name: string; url: string | null };
export type StyleDetail = { fabric: string; sizes: Record<string, number>; files: LineFile[] };

// Common size runs, so a new style's sizes are one tap.
const RUNS: { label: string; sizes: string[] }[] = [
  { label: "XS to XXL", sizes: ["XS", "S", "M", "L", "XL", "XXL"] },
  { label: "S to 3XL", sizes: ["S", "M", "L", "XL", "XXL", "3XL"] },
  { label: "28 to 38", sizes: ["28", "30", "32", "34", "36", "38"] },
];
const KINDS: { key: LineFileKind; label: string; hint: string }[] = [
  { key: "tech_pack", label: "Tech pack", hint: "The factory sees it in its panel" },
  { key: "cutting", label: "Cutting program", hint: "The factory sees it in its panel" },
  { key: "other", label: "Other files", hint: "Team only: buyer mails, trims, labels" },
];
const toRows = (sizes: Record<string, number>) => sizeEntries(sizes).map(([size, n]) => ({ size, qty: String(n) }));

// A style's fabric, its pieces per size, and its tech pack, cutting program and other files.
// A fabric style is bought by the metre and has no sizes, so it shows only the fabric.
export function StyleDetails({ orderId, companyId, lineId, style, styleQty, detail, editable, fabricOrder = false }: {
  orderId: string;
  companyId: string;
  lineId: string;
  style: string;
  styleQty: number;
  detail: StyleDetail;
  editable: boolean;
  fabricOrder?: boolean;
}) {
  const router = useRouter();
  const [fabric, setFabric] = useState(detail.fabric);
  const [rows, setRows] = useState(toRows(detail.sizes));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();
  // Which job the shown error came from: the fabric and sizes save, or a file.
  const [errorFrom, setErrorFrom] = useState("");
  // The size row a save message is about ("name" or "qty" box), marked and focused before anything is sent.
  const [badRow, setBadRow] = useState<{ i: number; k: "size" | "qty" } | null>(null);
  const rowsBox = useRef<HTMLDivElement>(null);
  const saveError = !!error && errorFrom === "save";
  const filled = rows.filter((r) => r.size.trim() || r.qty.trim());
  const sum = filled.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const dirty = fabric.trim() !== detail.fabric || JSON.stringify(filled.map((r) => [r.size.trim(), Number(r.qty) || 0]).filter(([, n]) => n))
    !== JSON.stringify(sizeEntries(detail.sizes));

  function run(label: string, job: () => Promise<{ error?: string; stale?: boolean }>, done: string) {
    setError("");
    setBusy(label);
    start(async () => {
      const res = await job();
      setBusy("");
      if (res.stale) router.refresh();
      if (res.error) {
        setErrorFrom(label);
        return setError(res.error);
      }
      toast(done);
      router.refresh();
    });
  }

  function addFiles(kind: LineFileKind, list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setErrorFrom("");
    if (detail.files.length + files.length > 30) return setError("A style can keep up to 30 files. Take off old ones first.");
    run(`up:${kind}`, async () => {
      try {
        const paths = await uploadAttachments(`${companyId}/${orderId}/files/${lineId}`, files);
        return await addLineFiles(orderId, lineId, kind, paths.map((path, i) => ({ path, file_name: files[i].name })));
      } catch (e) {
        return { error: caught(e, "The files didn't upload.") };
      }
    }, files.length === 1 ? "File added" : `${files.length} files added`);
  }

  const setRow = (i: number, patch: Partial<{ size: string; qty: string }>) => {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    if (badRow?.i === i) { setBadRow(null); setError(""); }
  };

  // The same checks the save makes, on the phone first, pointing at the row on screen.
  function save() {
    const seen = new Map<string, number>();
    for (const [i, r] of rows.entries()) {
      const k = r.size.trim().toUpperCase();
      if (!k && !r.qty.trim()) continue;
      const stop = (kind: "size" | "qty", msg: string) => {
        setErrorFrom("save"); setError(msg); setBadRow({ i, k: kind });
        requestAnimationFrame(() => rowsBox.current?.querySelector<HTMLElement>(`[data-cell="${i}-${kind}"]`)?.focus());
      };
      if (!k) return stop("size", `Give the size with ${r.qty} pcs a name, like S or 32.`);
      // A size picked from a run but left blank (the buyer orders no XS) is simply left out.
      if (!r.qty.trim()) continue;
      if (seen.has(k)) return stop("size", `Size ${r.size.trim()} is entered twice.`);
      seen.set(k, i);
    }
    setBadRow(null);
    run("save", () => saveStyleDetails(orderId, lineId, fabric, filled, { fabric: detail.fabric, sizes: detail.sizes }), `${style} saved`);
  }
  const sizesTotal = Object.values(detail.sizes).reduce((a, n) => a + n, 0);

  return (
    <div className="sdetail">
      <div className="fgrid">
        <label className="field">
          <span>Fabric</span>
          {editable ? (
            <input className="inp" value={fabric} maxLength={160} onChange={(e) => setFabric(e.target.value)} placeholder="Cotton cambric 60s, 120 GSM" />
          ) : <b className="text-[14px] font-medium">{detail.fabric || "Not entered"}</b>}
        </label>
      </div>

      {!fabricOrder && <div className="grid gap-2">
        <div className="row !gap-2">
          <span className="text-[12.5px] font-medium">Pieces per size</span>
          {editable && rows.length > 0 && (
            <span className={`text-[12.5px] font-semibold ${sum === styleQty ? "text-ok" : "text-warn"}`}>
              {qty(sum)} of {qty(styleQty)} pcs{sum !== styleQty && ` (${sum > styleQty ? `${qty(sum - styleQty)} too many` : `${qty(styleQty - sum)} to go`})`}
            </span>
          )}
        </div>
        {editable ? (
          <>
            {rows.length === 0 && (
              <div className="row !gap-2">
                {RUNS.map((r) => (
                  <button key={r.label} type="button" className="chip" onClick={() => setRows(r.sizes.map((size) => ({ size, qty: "" })))}>{r.label}</button>
                ))}
                <button type="button" className="chip" onClick={() => setRows([{ size: "", qty: "" }])}>Own sizes</button>
              </div>
            )}
            {rows.length > 0 && (
              <div className="sizes" ref={rowsBox}>
                {rows.map((r, i) => (
                  <label key={i}>
                    <input className="inp !font-semibold" data-cell={`${i}-size`} aria-invalid={(badRow?.i === i && badRow.k === "size") || undefined} value={r.size} maxLength={12} placeholder="Size" aria-label={`Size ${i + 1} name`}
                      onChange={(e) => setRow(i, { size: e.target.value })} />
                    <input className="inp" inputMode="numeric" data-cell={`${i}-qty`} aria-invalid={(badRow?.i === i && badRow.k === "qty") || undefined} value={r.qty} placeholder="pcs" aria-label={`Pieces in ${r.size || `size ${i + 1}`}`}
                      onChange={(e) => setRow(i, { qty: wholeText(e.target.value) })} />
                  </label>
                ))}
                {rows.length < 12 && (
                  <button type="button" className="btn sm self-end" onClick={() => setRows((x) => [...x, { size: "", qty: "" }])}>+ Size</button>
                )}
              </div>
            )}
          </>
        ) : sizesTotal ? (
          <div className="sizes">
            {sizeEntries(detail.sizes).map(([s, n]) => <label key={s}><b className="text-[13px] text-foreground">{s}</b>{qty(n)}</label>)}
          </div>
        ) : <span className="muted text-[13px]">Not entered</span>}
      </div>}

      {editable && (dirty || error) && (
        <div className="row">
          <button type="button" className="btn primary sm" disabled={pending || !dirty || (filled.length > 0 && sum !== styleQty)}
            title={filled.length > 0 && sum !== styleQty ? `The sizes must add up to ${qty(styleQty)} pcs` : undefined}
            onClick={save}>
            {busy === "save" ? "Saving…" : fabricOrder ? "Save fabric" : "Save fabric and sizes"}
          </button>
          {dirty && (
            <button type="button" className="btn sm" disabled={pending} onClick={() => { setFabric(detail.fabric); setRows(toRows(detail.sizes)); setError(""); setBadRow(null); }}>Undo</button>
          )}
        </div>
      )}

      {/* A save problem shows by the Save button, not below the files where a phone can't see it. */}
      {saveError && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}

      <div className="sfiles">
        {KINDS.map((k) => {
          const mine = detail.files.filter((f) => f.kind === k.key);
          return (
            <div key={k.key} className="sfile-box">
              <b>{k.label}</b>
              {mine.map((f) => (
                <div key={f.id} className="sfile">
                  {f.url ? <a href={f.url} target="_blank" rel="noreferrer" title={f.name}>{f.name}</a> : <span className="muted">{f.name}</span>}
                  {editable && (
                    <button type="button" className="ml-auto text-[12px] text-muted hover:text-bad" disabled={pending} aria-label={`Take off ${f.name}`}
                      onClick={() => run(`rm:${f.id}`, () => removeLineFile(orderId, f.id), "File taken off")}>
                      {busy === `rm:${f.id}` ? "…" : "Remove"}
                    </button>
                  )}
                </div>
              ))}
              {!mine.length && !editable && <span className="muted text-[12.5px]">None</span>}
              {editable && (
                <label className={`link w-fit cursor-pointer text-[12.5px] ${pending ? "pointer-events-none opacity-50" : ""}`}>
                  {busy === `up:${k.key}` ? "Uploading…" : mine.length ? "+ Add more" : "+ Add file"}
                  <input type="file" multiple className="sr-only" aria-label={`Add ${k.label.toLowerCase()} for ${style}`}
                    accept="image/*,.pdf,.xls,.xlsx,.doc,.docx,.csv" onChange={(e) => { addFiles(k.key, e.target.files); e.target.value = ""; }} />
                </label>
              )}
              {editable && <span className="text-[11.5px] text-muted">{k.hint}</span>}
            </div>
          );
        })}
      </div>
      {error && !saveError && <p className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
