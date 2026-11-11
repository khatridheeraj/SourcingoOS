"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { caught, isDropped } from "@/lib/errors";
import { dayTimeNear } from "@/lib/format";
import { PO_BUCKET, PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/client";
import { sendPo } from "./actions";

export type SentPo = {
  id: string; sent_at: string; po: string | null; note: string | null; files: string[];
  state: "with_team" | "added" | "set_aside"; order_po: string | null; order_ref: string | null;
};

const ACCEPT = Object.keys(PO_FILE_TYPES).map((e) => `.${e}`).join(",");
const SHOWN = 4;

// The buyer sends a new PO to Sourcingo from its page: the PO file (or photos of its pages), its number and a note.
// Below, what it sent lately and whether it is an order yet.
export function BuyerSendPo({ companyId, sent, canSend }: { companyId: string; sent: SentPo[]; canSend: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!canSend && !sent.length) return null;

  function pick(list: FileList | null) {
    setError("");
    const picked = [...(list ?? [])];
    for (const f of picked) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!PO_FILE_TYPES[ext]) {
        setError(ext === "heic" || ext === "heif"
          ? `${f.name} is an iPhone HEIC photo, which can't be read. Share it as a JPG, or set the camera to "Most compatible".`
          : `${f.name} isn't a PDF, Excel, CSV or photo.`);
        if (input.current) input.current.value = "";
        return;
      }
      if (f.size > PO_MAX_BYTES) { setError(`${f.name} is over 25 MB.`); if (input.current) input.current.value = ""; return; }
      if (f.size === 0) { setError(`${f.name} is empty. Download it again, then pick the new copy.`); if (input.current) input.current.value = ""; return; }
    }
    if (picked.length > 10) { setError("Send at most 10 files with one PO."); if (input.current) input.current.value = ""; return; }
    setFiles(picked);
  }

  function send() {
    setError("");
    if (!files.length) { setError("Pick the PO file first."); input.current?.focus(); return; }
    start(async () => {
      const id = crypto.randomUUID();
      const supabase = createClient();
      const stored: StoredFile[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop()!.toLowerCase();
        const type = PO_FILE_TYPES[ext];
        const path = `${companyId}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await supabase.storage.from(PO_BUCKET).upload(path, f, { contentType: type });
        if (up) {
          setError(`Couldn't upload ${f.name}: ${isDropped(up.message) ? "the connection dropped. Check the network and try again." : up.message}`);
          return;
        }
        stored.push({ path, name: f.name, type, size: f.size });
      }
      let res: { error?: string };
      try { res = await sendPo(id, stored, po, note); } catch (e) { res = { error: caught(e, "It didn't send. Try again.") }; }
      if (res.error) { setError(res.error); return; }
      setFiles([]); setPo(""); setNote("");
      if (input.current) input.current.value = "";
      toast("Sent. Sourcingo will enter it and it shows here as an order.");
      router.refresh();
    });
  }

  const row = (s: SentPo) => (
    <li key={s.id}>
      <span className="fmoney-id">
        <b>{s.po ? `PO ${s.po}` : s.files[0] ?? "PO"}</b>
        <small>{[`Sent ${dayTimeNear(s.sent_at)}`, s.files.length > 1 ? `${s.files.length} files` : s.po ? s.files[0] : ""].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="fmoney-amt">
        {s.state === "added" ? <b className="text-ok">Order {s.order_po}</b>
          : s.state === "set_aside" ? <small>Not entered as an order</small>
          : <small>With Sourcingo</small>}
        {s.state === "added" && s.order_ref && s.order_ref !== s.order_po && <small>Sourcingo ref {s.order_ref}</small>}
      </span>
    </li>
  );

  return (
    <section className="card fmoney bsend" aria-labelledby="bsend-h">
      <header className="card-h">
        <div>
          <h2 id="bsend-h">Send a new PO</h2>
          <p>Your PO file, or photos of all its pages. Sourcingo enters it and it shows above as an order.</p>
        </div>
      </header>
      {canSend && (
        <form className="bsend-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className="field">
            <span>PO file</span>
            <label className={`btn bsend-pick${pending ? " opacity-60" : ""}`}>
              {files.length ? "Choose again" : "Choose PO file"}
              <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" disabled={pending} aria-label="PO file"
                aria-invalid={(!!error && !files.length) || undefined} aria-describedby={error ? "bsend-err" : undefined}
                onChange={(e) => pick(e.target.files)} />
            </label>
            {files.length > 0 && <small className="bsend-files">{files.map((f) => f.name).join(", ")}</small>}
          </div>
          <label className="field">
            <span>PO number <small className="muted">if it has one</small></span>
            <input className="inp" value={po} maxLength={100} onChange={(e) => setPo(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>Note <small className="muted">optional</small></span>
            <textarea className="inp" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
              placeholder="A delivery date, a changed style…" />
          </label>
          {error && <p id="bsend-err" className="text-[13px] font-semibold text-bad" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={pending}>{pending ? "Sending…" : files.length > 1 ? `Send PO (${files.length} files)` : "Send PO"}</button>
        </form>
      )}
      {sent.length > 0 && (
        <div className="fmoney-part">
          <h3>Sent lately</h3>
          <ul>{sent.slice(0, SHOWN).map(row)}</ul>
          {sent.length > SHOWN && (
            <details className="bmore">
              <summary>Show {sent.length - SHOWN} more</summary>
              <ul>{sent.slice(SHOWN).map(row)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
