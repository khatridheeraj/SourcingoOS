"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadPhotos } from "@/lib/photos";
import { INQUIRY_SOURCES } from "@/lib/inquiries";
import { inquiryProblem, type InquiryField } from "@/lib/inquiry-input";
import { todayIST } from "@/lib/format";
import { toast } from "@/components/toast";
import { createInquiry, setInquiryPhotos, updateInquiry, type InquiryInput } from "./actions";

type Option = { id: string; label: string };
const NEW_BUYER = "__new";

// Logs a new inquiry (with reference photos) or changes an open one.
export function InquiryForm({ id, companyId, initial, buyers, team }: {
  id?: string;
  companyId: string;
  initial: InquiryInput;
  buyers: Option[];
  team: Option[];
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [newBuyer, setNewBuyer] = useState(!initial.buyer_id && !!initial.prospect);
  const [files, setFiles] = useState<File[]>([]);
  // A message for one box shows under it, marked and focused; one with no box (a dropped save) shows by the buttons.
  const [bad, setBad] = useState<{ field?: InquiryField; msg: string } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const today = todayIST();
  const set = (k: keyof InquiryInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV({ ...v, [k]: e.target.value });
    setBad((x) => (x?.field === k ? null : x));
  };
  const at = (k: InquiryField) => ({ name: k, "aria-invalid": bad?.field === k || undefined });
  const err = (k: InquiryField) => bad?.field === k ? <small className="text-bad" role="alert">{bad.msg}</small> : null;
  function fail(msg: string, field?: InquiryField) {
    setBad({ field, msg });
    const el = field && formRef.current?.elements.namedItem(field);
    if (el instanceof HTMLElement) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center" }); }
  }

  function pickBuyer(e: React.ChangeEvent<HTMLSelectElement>) {
    const isNew = e.target.value === NEW_BUYER;
    setNewBuyer(isNew);
    setV({ ...v, buyer_id: isNew ? "" : e.target.value, prospect: isNew ? v.prospect : "" });
    setBad((x) => (x?.field === "buyer_id" ? null : x));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = { ...v, prospect: newBuyer ? v.prospect : "" };
    const wrong = inquiryProblem(input, { newBuyer, today: id ? undefined : today });
    if (wrong) return fail(wrong.error, wrong.field);
    setBad(null);
    start(async () => {
      if (id) {
        const res = await updateInquiry(id, input);
        if (res.error) return fail(res.error, res.field);
        toast("Inquiry saved");
        router.replace(`/inquiries/${id}`);
        return;
      }
      const res = await createInquiry(input);
      if (res.error || !res.id) return fail(res.error ?? "The inquiry didn't save. Try again.", res.field);
      if (files.length) {
        try {
          const paths = await uploadPhotos(`${companyId}/inquiries/${res.id}`, files);
          const saved = await setInquiryPhotos(res.id, paths);
          if (saved.error) toast(`Inquiry logged, but the photos didn't save: ${saved.error}`, "bad");
        } catch (err) {
          toast(`Inquiry logged, but the photos didn't upload: ${err instanceof Error ? err.message : "try again"}`, "bad");
        }
      }
      toast("Inquiry logged");
      router.replace(`/inquiries/${res.id}`);
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="stack" noValidate>
      <div className="panel">
        <h2>Who is asking</h2>
        <div className="fgrid">
          <label className="field">
            <span>Buyer <i>*</i></span>
            <select className="inp" value={newBuyer ? NEW_BUYER : v.buyer_id} onChange={pickBuyer} required {...at("buyer_id")}>
              <option value="">Pick a buyer</option>
              {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value={NEW_BUYER}>A new buyer, not in the list</option>
            </select>
            {err("buyer_id")}
          </label>
          {newBuyer && (
            <label className="field">
              <span>New buyer&apos;s name <i>*</i></span>
              <input className="inp" value={v.prospect} onChange={set("prospect")} required maxLength={120} placeholder="Brand or company name" {...at("prospect")} />
              {err("prospect")}
            </label>
          )}
          <label className="field">
            <span>Contact person</span>
            <input className="inp" value={v.contact_name} onChange={set("contact_name")} maxLength={120} placeholder="Who sent it" />
          </label>
          <label className="field">
            <span>Phone or email</span>
            <input className="inp" value={v.contact} onChange={set("contact")} maxLength={200} inputMode="email" placeholder="name@brand.com or +91…" />
          </label>
          <label className="field">
            <span>Came by</span>
            <select className="inp" value={v.source} onChange={set("source")}>
              {INQUIRY_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <h2>What they want</h2>
        <label className="field">
          <span>Product <i>*</i></span>
          <input className="inp" value={v.product} onChange={set("product")} required maxLength={200} placeholder="Satin co-ord set, cotton kurta, printed cambric…" {...at("product")} />
          {err("product")}
        </label>
        <div className="fgrid mt-3">
          <label className="field">
            <span>Quantity</span>
            <div className="row !flex-nowrap gap-2">
              <input className="inp" inputMode="numeric" value={v.est_qty} onChange={set("est_qty")} placeholder="1200" aria-label="Estimated quantity" {...at("est_qty")} />
              <select className="inp !w-24" value={v.unit} onChange={set("unit")} aria-label="Unit">
                <option value="pcs">pcs</option>
                <option value="m">metres</option>
              </select>
            </div>
            {err("est_qty")}
          </label>
          <label className="field">
            <span>Buyer&apos;s target price ₹ (per {v.unit === "m" ? "metre" : "piece"})</span>
            <input className="inp" inputMode="decimal" value={v.target_price} onChange={set("target_price")} placeholder="Leave blank if not given" {...at("target_price")} />
            {err("target_price")}
          </label>
          <label className="field">
            <span>Merchandiser</span>
            <select className="inp" value={v.merchandiser_id} onChange={set("merchandiser_id")}>
              <option value="">Not assigned</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Follow up on</span>
            <input className="inp" type="date" value={v.next_follow_up} onChange={set("next_follow_up")} min={id ? undefined : today} {...at("next_follow_up")} />
            {err("next_follow_up")}
          </label>
        </div>
        <label className="field mt-3">
          <span>Notes</span>
          <textarea className="inp" rows={3} value={v.notes} onChange={set("notes")} maxLength={4000}
            placeholder="What the buyer asked for: fabric, sizes, sample needs, delivery date" />
        </label>
        {!id && (
          <label className="field mt-3">
            <span>Reference photos (mood board, tech pack page, sample)</span>
            <input className="inp" type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 12))} />
            {files.length > 0 && <small className="muted">{files.length} {files.length === 1 ? "photo" : "photos"} will be added</small>}
          </label>
        )}
      </div>

      <div className="sticky-actions">
        <div className="grow" />
        {bad && !bad.field && <span className="text-[13px] font-semibold text-bad" role="alert">{bad.msg}</span>}
        <button type="button" className="btn" disabled={pending} onClick={() => router.back()}>Cancel</button>
        <button className="btn primary" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Log inquiry"}</button>
      </div>
    </form>
  );
}
