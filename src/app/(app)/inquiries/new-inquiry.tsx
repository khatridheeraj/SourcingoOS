"use client";

import { useActionState } from "react";
import { inputCls, labelCls, primaryBtn } from "@/components/ui";
import { createInquiry, type FormState } from "./actions";

export type Option = { id: string; label: string };

export function NewInquiry({ buyers, merchandisers, isOwner }: { buyers: Option[]; merchandisers: Option[]; isOwner: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createInquiry, {});
  const req = <i className="not-italic text-bad">*</i>;

  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelCls}>
          <span>Buyer code {req}</span>
          <select name="buyer_id" required className={inputCls} defaultValue="">
            <option value="" disabled>Select buyer…</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {!buyers.length && (
            <small className="font-normal text-warn">{isOwner ? "Add a buyer in Buyers & factories first." : "Ask the owner to add the buyer first."}</small>
          )}
        </label>
        <label className={labelCls}><span>Contact person {req}</span><input name="contact_person" required className={inputCls} /></label>
        <label className={labelCls}><span>Email {req}</span><input name="contact_email" type="email" required placeholder="name@brand.com" className={inputCls} /></label>
        <label className={labelCls}><span>Product type {req}</span><input name="product_type" required placeholder="Satin co-ord set, kurta…" className={inputCls} /></label>
        <label className={labelCls}>
          Estimated quantity
          <span className="flex gap-2">
            <input name="est_qty" type="number" min="0" step="any" placeholder="5000" className={inputCls} />
            <select name="unit" className={`${inputCls} w-24`} aria-label="Unit"><option value="pcs">pcs</option><option value="m">meters</option></select>
          </span>
        </label>
        <label className={labelCls}>Estimated budget (₹)<input name="budget_inr" type="number" min="0" step="any" className={inputCls} /></label>
        <label className={labelCls}>
          Assign merchandiser
          <select name="merchandiser_id" className={inputCls} defaultValue="">
            <option value="">Unassigned</option>
            {merchandisers.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className={labelCls}>First follow-up<input name="next_follow_up" type="date" className={inputCls} /></label>
      </div>
      <label className={labelCls}>
        Notes
        <textarea name="notes" rows={2} placeholder="What the buyer asked for, target price, sample needs" className={inputCls} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primaryBtn}>{pending ? "Logging…" : "Log inquiry"}</button>
        {state.error && <p className="text-sm text-bad">{state.error}</p>}
        {state.ok && <p className="text-sm text-muted">{state.ok}</p>}
      </div>
    </form>
  );
}
