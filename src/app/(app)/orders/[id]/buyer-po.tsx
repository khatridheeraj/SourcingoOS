"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { PO_ACCEPT, poFileProblem, uploadPoFiles } from "@/lib/po-upload";
import { removeOrderPoFile } from "../actions";

// One file of the buyer's PO. Files that came with the email (or from Buyer POs) can't be taken off here.
export type PoDoc = { key: string; id: string | null; name: string; ext: string; size: number; url: string | null; download: string | null; from: string };

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
    // Every file is checked before any is sent, so one wrong file doesn't leave the others half added.
    const problem = files.map(poFileProblem).find(Boolean);
    setError(problem ?? "");
    if (problem) return;
    setBusy("up");
    start(async () => {
      const res = await uploadPoFiles(companyId, orderId, files);
      setBusy("");
      if (res.error) return setError(res.error);
      toast(res.count === 1 ? "PO added to the order" : `${res.count} PO files added`);
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
      <input ref={input} type="file" multiple accept={PO_ACCEPT} className="sr-only" disabled={pending}
        onChange={(e) => upload(e.target.files)} aria-label="Buyer's PO file" />
    </label>
  );

  return (
    <section className="panel scroll-mt-20" id="details-po" aria-labelledby="bpo-h">
      <div className="row mb-1">
        <h2 id="bpo-h" className="font-bold text-base">Buyer&apos;s PO</h2>
        {docs.length > 0 && <span className="chip ok">{docs.length === 1 ? "On file" : `${docs.length} files`}</span>}
        {canEdit && docs.length > 0 && <span className="ml-auto">{picker("+ Add file", false)}</span>}
        {docs.length > 0 && <Link href={`/orders/${orderId}/po`} className="btn sm" title="A clean PO made from this order, to print or send">Make PO PDF</Link>}
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
            <span>{canEdit ? "Add the buyer's PO: the PDF, Excel, or a photo or screenshot of it from WhatsApp. Factory POs are locked only once it's here. Make PO PDF prints a clean copy of this order for the buyer to confirm."
              : "The orders team adds it."}</span>
          </div>
          <div className="po-empty-acts">
            {canEdit && picker("Add the PO file", true)}
            <Link href={`/orders/${orderId}/po`} className="btn">Make PO PDF</Link>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold text-bad" role="alert">{error}</p>}
    </section>
  );
}
