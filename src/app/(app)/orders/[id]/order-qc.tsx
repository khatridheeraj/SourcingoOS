"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { day, QC_KINDS, qcKindLabel, SHIP_QC } from "@/lib/format";
import { REPORT_ACCEPT, uploadPhotos, uploadReports } from "@/lib/photos";
import { addQcComment, addQcFiles, cancelQc, recordQc, removeQcPhoto, type QcFile, type QcInput } from "../actions";

export type QcCheck = {
  id: string; line_id: string; kind: string; checked_on: string; result: string; pieces_checked: number | null; defects: number;
  notes: string | null; by: string; cancelled_at: string | null; cancel_reason: string | null;
  photos: { id: string; url: string }[];
  reports: { id: string; url: string; name: string }[];
  comments: { id: string; by: string; at: string; body: string }[];
};

const pct = (d: number, p: number | null) => (p ? `${((d / p) * 100).toFixed(1)}%` : "");
const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Uploads photos and reports into a check's folder. Photos are shrunk first; reports go up as they are.
async function upload(folder: string, photos: File[], reports: File[]): Promise<QcFile[]> {
  const paths = photos.length ? await uploadPhotos(folder, photos) : [];
  const docs = reports.length ? await uploadReports(folder, reports) : [];
  return [
    ...paths.map((path) => ({ path, kind: "photo" as const, file_name: "" })),
    ...docs.map((d) => ({ path: d.path, kind: "report" as const, file_name: d.file_name })),
  ];
}

export type QcStyle = { id: string; style: string; colour: string; qty: number };

// Sampling and production inspections, kept separately for each style of the order. Saved checks are cancelled, never edited.
// The Quality team records them with proof; everyone else can read them and comment.
export function OrderQc({ orderId, companyId, open, canRecord, today, checks, finalPassed, styles }: {
  orderId: string;
  companyId: string;
  open: boolean;
  canRecord: boolean;
  today: string;
  checks: QcCheck[];
  finalPassed: boolean;
  styles: QcStyle[];
}) {
  const router = useRouter();
  const blank: QcInput = { line_id: "", kind: "", checked_on: today, result: "", pieces_checked: "", defects: "", notes: "" };
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(blank);
  const [photos, setPhotos] = useState<File[]>([]);
  const [reports, setReports] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof QcInput, v: string) => setQ({ ...q, [k]: v });
  const can = open && canRecord;

  function startFor(lineId: string) {
    setQ({ ...blank, line_id: lineId }); setPhotos([]); setReports([]); setError(""); setAdding(true);
  }

  function reset() {
    setAdding(false); setError(""); setQ(blank); setPhotos([]); setReports([]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!q.line_id) return setError("Pick the style this check is for.");
    if (!q.kind) return setError("Pick the type of check.");
    if (!q.result) return setError("Pick Pass or Fail.");
    if (!photos.length) return setError("Add at least one photo as proof of the check.");
    start(async () => {
      const id = crypto.randomUUID();
      try {
        setBusy("new");
        const files = await upload(`${companyId}/${orderId}/qc/${id}`, photos, reports);
        const res = await recordQc(orderId, id, q, files);
        if (res.error) return setError(res.error);
      } catch (err) {
        return setError(err instanceof Error ? err.message : "The files didn't upload. Try again.");
      } finally {
        setBusy("");
      }
      reset();
      router.refresh();
    });
  }

  function addLater(qcId: string, list: FileList | null, kind: "photo" | "report") {
    if (!list?.length) return;
    const files = [...list];
    setNotice("");
    start(async () => {
      try {
        setBusy(qcId);
        const up = await upload(`${companyId}/${orderId}/qc/${qcId}`, kind === "photo" ? files : [], kind === "report" ? files : []);
        const res = await addQcFiles(orderId, qcId, up);
        if (res.error) setNotice(`The files weren't added: ${res.error}`);
      } catch (err) {
        setNotice(`The files weren't added: ${err instanceof Error ? err.message : "upload failed."}`);
      } finally {
        setBusy("");
      }
      router.refresh();
    });
  }

  function removeFile(id: string, what: string) {
    if (!window.confirm(`Take this ${what} off the check? It stays in the records.`)) return;
    start(async () => {
      const res = await removeQcPhoto(orderId, id);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  function cancel(id: string) {
    const reason = window.prompt("Why cancel this QC check? For example: entered on the wrong order.");
    if (reason == null) return;
    start(async () => {
      const res = await cancelQc(orderId, id, reason);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  function comment(qcId: string) {
    const body = drafts[qcId] ?? "";
    if (!body.trim()) return;
    start(async () => {
      const res = await addQcComment(orderId, qcId, body);
      if (res.error) return window.alert(res.error);
      setDrafts((d) => ({ ...d, [qcId]: "" }));
      router.refresh();
    });
  }

  // Each style's latest final QC or re-check (checks come newest first).
  const finalOf = (lineId: string) => checks.find((c) => c.line_id === lineId && !c.cancelled_at && SHIP_QC.includes(c.kind));
  const passedCount = styles.filter((st) => finalOf(st.id)?.result === "pass").length;
  const anyFailed = styles.some((st) => finalOf(st.id)?.result === "fail");
  // Checks on styles that were later taken off the order stay visible in their own group.
  const gone = checks.filter((c) => !styles.some((st) => st.id === c.line_id));
  const groups = gone.length ? [...styles, { id: "", style: "Styles taken off the order", colour: "", qty: 0 }] : styles;
  const styleName = (id: string) => styles.find((st) => st.id === id)?.style ?? "";

  const form = (
    <form onSubmit={submit} className="mb-4 rounded-[10px] border border-line p-3">
      <p className="mb-3 text-[13px]">New check for <b className="code">{styleName(q.line_id)}</b>. Its photos and reports belong to this style only.</p>
      <div className="field">
        <span>Type of check <i>*</i></span>
        <div className="steps" role="group" aria-label="Type of check">
          {QC_KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={q.kind === k.key} onClick={() => set("kind", k.key)}>{k.label}</button>
          ))}
        </div>
        <small>Greige to size set: samples and approvals. Inline and mid-line: during production. Final before shipping; re-check after a failed final.</small>
      </div>
      <div className="fgrid mt-3">
        <div className="field">
          <span>Result <i>*</i></span>
          <div className="steps" role="group" aria-label="Result">
            <button type="button" aria-pressed={q.result === "pass"} onClick={() => set("result", "pass")}>Pass</button>
            <button type="button" aria-pressed={q.result === "fail"} onClick={() => set("result", "fail")}>Fail</button>
          </div>
        </div>
        <label className="field">
          <span>Date checked</span>
          <input className="inp" type="date" max={today} value={q.checked_on} onChange={(e) => set("checked_on", e.target.value)} />
        </label>
        <label className="field">
          <span>Pieces checked</span>
          <input className="inp" inputMode="numeric" value={q.pieces_checked} onChange={(e) => set("pieces_checked", e.target.value)} />
        </label>
        <label className="field">
          <span>Defects found</span>
          <input className="inp" inputMode="numeric" value={q.defects} placeholder="0" onChange={(e) => set("defects", e.target.value)} />
        </label>
      </div>
      <label className="field mt-3">
        <span>Notes{q.result === "fail" && <i> *</i>}</span>
        <textarea className="inp" rows={2} value={q.notes} onChange={(e) => set("notes", e.target.value)}
          placeholder={q.result === "fail" ? "What failed, and what the factory must fix" : "Anything worth remembering"} />
      </label>
      <div className="fgrid mt-3">
        <label className="field">
          <span>Photos <i>*</i></span>
          <input className="inp" type="file" accept="image/*" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])])} />
          <small>{photos.length ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"} ready` : "At least one photo as proof. Add as many as you need."}</small>
        </label>
        <label className="field">
          <span>Reports</span>
          <input className="inp" type="file" accept={REPORT_ACCEPT} multiple onChange={(e) => setReports([...(e.target.files ?? [])])} />
          <small>{reports.length ? `${reports.length} ${reports.length === 1 ? "report" : "reports"} ready` : "Inspection reports: PDF, Excel, Word or CSV, up to 10 MB each."}</small>
        </label>
      </div>
      <div className="row mt-3">
        <button className="btn primary" disabled={pending}>{pending ? (busy ? "Uploading proof…" : "Saving…") : `Save QC${q.line_id ? ` for ${styleName(q.line_id)}` : ""}`}</button>
        <button type="button" className="btn" onClick={reset}>Close</button>
        {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
      </div>
    </form>
  );

  return (
    <section className="panel">
      <div className="row mb-3">
        <h2 className="font-bold text-base">Quality checks</h2>
        {finalPassed ? <span className="chip ok">Final QC passed for every style</span>
          : anyFailed ? <span className="chip bad">Final QC failed on a style</span>
          : open ? <span className="chip warn">Final QC passed for {passedCount} of {styles.length} {styles.length === 1 ? "style" : "styles"}</span> : null}
      </div>
      {notice && <p className="mb-3 text-[13px] font-semibold text-bad" role="status">{notice}</p>}
      {open && !finalPassed && <p className="muted mb-3 text-[13px]">Each style has its own QC. The order can be marked Shipped once every style&apos;s latest final QC has passed.{!canRecord && " The Quality team records QC; you can comment on any check."}</p>}


      <div className="flex flex-col gap-4">
        {groups.map((st) => {
          const mine = st.id ? checks.filter((c) => c.line_id === st.id) : gone;
          const fin = st.id ? finalOf(st.id) : undefined;
          return (
            <div key={st.id || "gone"}>
              <div className="row mb-2">
                <b className={st.id ? "code" : ""}>{st.style}</b>
                {st.id && <span className="muted text-xs">{[st.colour, `${st.qty} pcs`].filter(Boolean).join(" · ")}</span>}
                {st.id && (fin ? <span className={`chip ${fin.result === "pass" ? "ok" : "bad"}`}>Final QC {fin.result === "pass" ? "passed" : "failed"}</span>
                  : open && <span className="chip warn">Final QC not done</span>)}
                {st.id && can && !(adding && q.line_id === st.id) && (
                  <button type="button" className="btn sm ml-auto" onClick={() => startFor(st.id)}>Record QC</button>
                )}
              </div>
              {st.id && adding && q.line_id === st.id && form}
              {mine.length === 0 ? (!(adding && q.line_id === st.id) && <p className="muted text-[13px]">No QC recorded for this style yet.</p>) : (
              <ul className="flex flex-col gap-2">
          {mine.map((c) => {
            const editable = can && !c.cancelled_at;
            return (
              <li key={c.id} className={`rounded-[10px] border border-line p-3 text-[13px] ${c.cancelled_at ? "opacity-60" : ""}`}>
                <div className="row">
                  <b>{qcKindLabel(c.kind)}</b>
                  <span className={c.cancelled_at ? "chip" : c.result === "pass" ? "chip ok" : "chip bad"}>
                    {c.cancelled_at ? "Cancelled" : c.result === "pass" ? "Pass" : "Fail"}
                  </span>
                  <span className="muted">{day(c.checked_on)} · {c.by}</span>
                  {editable && <button type="button" className="btn sm danger ml-auto" disabled={pending} onClick={() => cancel(c.id)}>Cancel</button>}
                </div>
                {(c.pieces_checked != null || c.defects > 0) && (
                  <div className="mt-1">
                    {c.pieces_checked != null && <>{c.pieces_checked} pcs checked · </>}
                    {c.defects} {c.defects === 1 ? "defect" : "defects"}
                    {c.pieces_checked ? ` (${pct(c.defects, c.pieces_checked)})` : ""}
                  </div>
                )}
                {c.notes && <div className="mt-1 whitespace-pre-line">{c.notes}</div>}
                {c.cancelled_at && <div className="muted mt-1">Cancelled: {c.cancel_reason}</div>}

                {(c.photos.length > 0 || editable) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {c.photos.map((ph, i) => (
                      <span key={ph.id} className="relative">
                        <a href={ph.url} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1} of this check`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                          <img src={ph.url} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" />
                        </a>
                        {editable && (
                          <button type="button" className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-line bg-surface text-[11px] leading-none text-bad"
                            aria-label={`Remove photo ${i + 1}`} disabled={pending} onClick={() => removeFile(ph.id, "photo")}>✕</button>
                        )}
                      </span>
                    ))}
                    {editable && (
                      <label className={`btn sm ${pending ? "pointer-events-none opacity-50" : ""}`}>
                        {busy === c.id ? "Uploading…" : "Add photos"}
                        <input type="file" accept="image/*" multiple className="sr-only" aria-label="Add photos to this check"
                          onChange={(e) => { addLater(c.id, e.target.files, "photo"); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}

                {(c.reports.length > 0 || editable) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {c.reports.map((r) => (
                      <span key={r.id} className="chip info">
                        <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.name}</a>
                        {editable && <button type="button" className="ml-1 text-bad" aria-label={`Remove ${r.name}`} disabled={pending} onClick={() => removeFile(r.id, "report")}>✕</button>}
                      </span>
                    ))}
                    {editable && (
                      <label className={`btn sm ${pending ? "pointer-events-none opacity-50" : ""}`}>
                        Add report
                        <input type="file" accept={REPORT_ACCEPT} multiple className="sr-only" aria-label="Add reports to this check"
                          onChange={(e) => { addLater(c.id, e.target.files, "report"); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                )}

                {c.comments.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-2">
                    {c.comments.map((m) => (
                      <li key={m.id}>
                        <span className="muted text-xs">{m.by} · {time.format(new Date(m.at))}</span>
                        <div className="whitespace-pre-line">{m.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <input className="inp flex-1" placeholder="Add a comment" aria-label="Comment on this check" value={drafts[c.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); comment(c.id); } }} />
                  <button type="button" className="btn sm" disabled={pending || !(drafts[c.id] ?? "").trim()} onClick={() => comment(c.id)}>Comment</button>
                </div>
              </li>
            );
          })}
              </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
