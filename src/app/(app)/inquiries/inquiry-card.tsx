"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Attachments } from "@/components/attachments";
import { inputCls, labelCls, secondaryBtn } from "@/components/ui";
import { CATEGORIES_FOR, type FileItem } from "@/lib/file-kinds";
import { fmtDate, fmtDateTime, fmtINR, fmtNum } from "@/lib/format";
import { addFollowUp, updateInquiry, type FormState } from "./actions";
import type { Option } from "./new-inquiry";

export type Inquiry = {
  id: string;
  buyerLabel: string;
  contact_person: string;
  contact_email: string;
  product_type: string;
  est_qty: number | null;
  unit: string;
  budget_inr: number | null;
  merchandiser_id: string | null;
  status: "new" | "quoted" | "converted" | "lost";
  next_follow_up: string | null;
  notes: string | null;
  created_at: string;
  so_id: string | null;
  followups: { id: string; note: string; created_at: string; by: string }[];
};

export const STATUS: Record<Inquiry["status"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-accent-soft text-accent" },
  quoted: { label: "Quoted", cls: "bg-warn-soft text-warn" },
  converted: { label: "Converted", cls: "bg-ok-soft text-ok" },
  lost: { label: "Lost", cls: "bg-line text-muted" },
};

export function InquiryCard({ inq, merchandisers, today, files }: { inq: Inquiry; merchandisers: Option[]; today: string; files: FileItem[] }) {
  const [saveState, setSaveState] = useState<FormState>({});
  const [saving, startSave] = useTransition();
  const [noteState, noteAction, notePending] = useActionState<FormState, FormData>(addFollowUp, {});
  const open = inq.status === "new" || inq.status === "quoted";
  const due = open && !!inq.next_follow_up && inq.next_follow_up <= today;
  const save = (field: "status" | "merchandiser_id" | "next_follow_up", value: string) =>
    startSave(async () => setSaveState(await updateInquiry(inq.id, field, value)));

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-1 text-base font-bold">{inq.product_type}</h3>
        <span className={`rounded-full px-2 text-xs font-bold ${STATUS[inq.status].cls}`}>{STATUS[inq.status].label}</span>
        {due && <span className="rounded-full bg-bad px-2 text-xs font-bold text-white">Follow-up due</span>}
        <span className="ml-auto" />
        {open && !inq.so_id && <Link href={`/orders/new?inquiry=${inq.id}`} className="btn sm primary">Create sales order</Link>}
        {inq.so_id && <Link href={`/orders/${inq.so_id}`} className="btn sm">Open {inq.so_id}</Link>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span className="font-mono">{inq.id}</span>
        <span>Buyer <b className="font-mono text-foreground">{inq.buyerLabel}</b></span>
        <span>Contact <b className="text-foreground">{inq.contact_person}</b> · <a href={`mailto:${inq.contact_email}`} className="text-accent">{inq.contact_email}</a></span>
        {inq.est_qty !== null && <span>Qty <b className="text-foreground">{fmtNum(inq.est_qty)} {inq.unit}</b></span>}
        {inq.budget_inr !== null && <span>Budget <b className="text-foreground">{fmtINR(inq.budget_inr)}</b></span>}
        <span>Logged {fmtDate(inq.created_at)}</span>
      </div>
      {inq.notes && <p className="whitespace-pre-line text-sm">{inq.notes}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          Status
          {inq.status === "converted" ? (
            <span className="py-2 text-sm text-foreground">Converted to {inq.so_id ? <Link className="link" href={`/orders/${inq.so_id}`}>{inq.so_id}</Link> : "a sales order"}</span>
          ) : (
            <select defaultValue={inq.status} disabled={saving} onChange={(e) => save("status", e.target.value)} className={inputCls}>
              <option value="new">New</option>
              <option value="quoted">Quoted</option>
              <option value="lost">Lost</option>
            </select>
          )}
        </label>
        <label className={labelCls}>
          Merchandiser
          <select defaultValue={inq.merchandiser_id ?? ""} disabled={saving} onChange={(e) => save("merchandiser_id", e.target.value)} className={inputCls}>
            <option value="">Unassigned</option>
            {merchandisers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className={labelCls}>
          Next follow-up
          <input type="date" defaultValue={inq.next_follow_up ?? ""} disabled={saving} onChange={(e) => save("next_follow_up", e.target.value)} className={inputCls} />
        </label>
      </div>
      {saveState.error && <p className="text-sm text-bad">{saveState.error}</p>}

      <Attachments target="inquiry" id={inq.id} files={files} upload={CATEGORIES_FOR.inquiry} canDeleteAll title="Reference images & files"
        empty="No images yet. Add the buyer's references, sketches or spec sheets." />

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-muted">Follow-up history ({inq.followups.length})</summary>
        <div className="mt-3 flex flex-col gap-3">
          <form key={noteState.nonce} action={noteAction} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <input type="hidden" name="inquiry_id" value={inq.id} />
            <label className={labelCls}>What happened<input name="note" required placeholder="Sent quote at ₹240/pc, buyer replies Friday" className={inputCls} /></label>
            <label className={labelCls}>Next follow-up<input name="next_follow_up" type="date" className={inputCls} /></label>
            <button disabled={notePending} className={secondaryBtn}>{notePending ? "Adding…" : "Add note"}</button>
          </form>
          {noteState.error && <p className="text-bad">{noteState.error}</p>}
          {inq.followups.length ? (
            <ul className="flex flex-col gap-2">
              {inq.followups.map((f) => (
                <li key={f.id} className="border-l-2 border-line pl-3">
                  <time className="block text-xs text-muted">{fmtDateTime(f.created_at)} · {f.by}</time>
                  {f.note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No notes yet.</p>
          )}
        </div>
      </details>
    </article>
  );
}
