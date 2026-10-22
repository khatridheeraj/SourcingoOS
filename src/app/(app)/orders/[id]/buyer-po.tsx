"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { PO_BUCKET, PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/client";
import { addOrderPoFiles, removeOrderPoFile } from "../actions";

// One file of the buyer's PO. Files that came with the email (or from Incoming POs) can't be taken off here.
export type PoDoc = { key: string; id: string | null; name: string; ext: string; size: number; url: string | null; download: string | null; from: string };

const ACCEPT = Object.keys(PO_FILE_TYPES).map((e) => `.${e}`).join(",");
const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// The buyer's PO as the buyer sent it: open it, download it, or add it when it came on WhatsApp or by hand.
export function BuyerPo({ orderId, companyId, docs, canEdit }: { orderId: string; companyId: string; docs: PoDoc[]; canEdit: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, start] = useTransition();

  function upload(list: FileList | null) {
    const files = [...(list ?? [])];
    if (input.current) input.current.value = "";
    if (!files.length) return;
    setError("");
    // Every file is checked before any is sent, so one wrong file doesn't leave the others half added.
    const picked: { f: File; ext: string; type: string }[] = [];
    for (const f of files) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const type = PO_FILE_TYPES[ext];
      if (!type) {
        return setError(ext === "heic" || ext === "heif"
          ? `${f.name} is an iPhone HEIC photo. Share it as a JPG, or set the camera to "Most compatible".`
          : `${f.name} isn't a PDF, Excel, CSV or photo.`);
      }
      if (f.size > PO_MAX_BYTES) return setError(`${f.name} is over 25 MB.`);
      picked.push({ f, ext, type });
    }
    setBusy("up");
    start(async () => {
      const supabase = createClient();
      const stored: StoredFile[] = [];
      for (const { f, ext, type } of picked) {
        const path = `${companyId}/${orderId}/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await supabase.storage.from(PO_BUCKET).upload(path, f, { contentType: type });
        if (up) {
          setBusy("");
          return setError(`Couldn't upload ${f.name}: ${up.message}`);
        }
        stored.push({ path, name: f.name, type, size: f.size });
      }
      const res = await addOrderPoFiles(orderId, stored);
      setBusy("");
      if (res.error) return setError(res.error);
      toast(stored.length === 1 ? "PO added to the order" : `${stored.length} PO files added`);
      router.refresh();
    });
  }

  function remove(d: PoDoc) {
    if (!d.id || !window.confirm(`Take ${d.name} off this order?`)) return;
    setError("");
    setBusy(d.key);
    start(async () => {
      const res = await removeOrderPoFile(orderId, d.id!);
      setBusy("");
      if (res.error) return setError(res.error);
      toast("PO file taken off");
      router.refresh();
    });
  }

  const picker = (label: string, primary: boolean) => (
    <label className={`btn ${primary ? "primary" : "sm"} ${pending ? "pointer-events-none opacity-60" : ""}`}>
      {busy === "up" ? "Uploading…" : label}
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" disabled={pending}
        onChange={(e) => upload(e.target.files)} aria-label="Buyer's PO file" />
    </label>
  );

  return (
    <section className="panel scroll-mt-20" id="details-po" aria-labelledby="bpo-h">
      <div className="row mb-1">
        <h2 id="bpo-h" className="font-bold text-base">Buyer&apos;s PO</h2>
        {docs.length > 0 && <span className="chip ok">{docs.length === 1 ? "On file" : `${docs.length} files`}</span>}
        {canEdit && docs.length > 0 && <span className="ml-auto">{picker("+ Add file", false)}</span>}
      </div>
      <p className="muted mb-3 text-[13px]">The PO exactly as the buyer sent it. Only the orders team and Accounts can open it; factories and buyers never see it.</p>

      {docs.length > 0 ? (
        <ul className="po-docs">
          {docs.map((d) => (
            <li key={d.key}>
              <span className={`po-doc-ext ${d.ext === "pdf" ? "pdf" : ""}`} aria-hidden>{d.ext.toUpperCase().slice(0, 4)}</span>
              <div className="min-w-0 grow">
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="po-doc-name" title={d.name}>{d.name}</a>
                  : <span className="po-doc-name muted" title="The file is missing from storage">{d.name}</span>}
                <small>{[d.from, d.size ? size(d.size) : ""].filter(Boolean).join(" · ")}</small>
              </div>
              <div className="po-doc-acts">
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="btn sm">Open</a>}
                {d.download && <a href={d.download} className="btn sm" aria-label={`Download ${d.name}`}>Download</a>}
                {canEdit && d.id && (
                  <button type="button" className="btn sm ghost" disabled={pending} onClick={() => remove(d)} aria-label={`Take ${d.name} off`}>
                    {busy === d.key ? "…" : "Remove"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="po-empty">
          <div className="grow">
            <b>No PO file on this order yet</b>
            <span>{canEdit ? "Add the buyer's PO (PDF, Excel or photos of the pages) so anyone can check rates, sizes and terms in one tap."
              : "The orders team adds it."}</span>
          </div>
          {canEdit && picker("Add the PO file", true)}
        </div>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
