"use client";

import { useActionState, useEffect, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { addDays, SAMPLE_TYPES, type Sample, sampleStep } from "@/lib/model";
import { createSample, type FormState, saveSample } from "./actions";

export type Option = { id: string; label: string };

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

// One form for logging a new sample and for correcting an existing one.
export function SampleForm({ sample, buyers, vendors, people, today, meId, isOwner, onDone }: {
  sample?: Sample; buyers: Option[]; vendors: Option[]; people: Option[]; today: string; meId: string; isOwner: boolean; onDone?: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(sample ? saveSample : createSample, {});
  const { toast } = useFeedback();
  const [received, setReceived] = useState(sample ? s(sample.received_on) : today);
  const [due, setDue] = useState(s(sample?.due_date));
  const [vendor, setVendor] = useState(s(sample?.factory_id));
  const step = sample ? sampleStep(sample.status) : 0;
  const req = <i>*</i>;

  useEffect(() => {
    if (state.ok) { toast(state.ok); onDone?.(); }
  }, [state, toast, onDone]);

  const quick = (n: number) => (
    <button key={n} type="button" className="btn sm" onClick={() => setDue(addDays(received || today, n))}>+{n} days</button>
  );

  return (
    <form action={action} className="stack">
      {sample && <input type="hidden" name="id" value={sample.id} />}
      <div className="fgrid">
        <label className="field">
          <span>Buyer {req}</span>
          <select name="buyer_id" required defaultValue={s(sample?.buyer_id)} className="inp">
            <option value="" disabled>Select buyer…</option>
            {buyers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {!buyers.length && <small>{isOwner ? "Add the buyer in Buyers & factories first." : "Ask the owner to add the buyer first."}</small>}
        </label>
        <label className="field">
          <span>What is it</span>
          <input name="description" defaultValue={s(sample?.description)} maxLength={200} placeholder="Printed kaftan, shirt collar…" className="inp" />
        </label>
        <label className="field">
          <span>Fabric</span>
          <input name="fabric" defaultValue={s(sample?.fabric)} maxLength={200} placeholder="60s cotton, 110×72 poplin…" className="inp" />
        </label>
        <label className="field">
          <span>Buyer&apos;s style / ref</span>
          <input name="buyer_ref" defaultValue={s(sample?.buyer_ref)} maxLength={100} className="inp" />
        </label>
        <label className="field">
          <span>Type</span>
          <select name="sample_type" defaultValue={sample?.sample_type ?? "development"} className="inp">
            {SAMPLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Pieces</span>
          <input name="qty" type="number" min="1" step="1" defaultValue={sample?.qty ?? 1} className="inp" />
        </label>
        <label className="field">
          <span>Received from buyer</span>
          <input name="received_on" type="date" max={today} value={received} onChange={(e) => setReceived(e.target.value)} className="inp" />
        </label>
        <label className="field">
          <span>Buyer needs it by {req}</span>
          <input name="due_date" type="date" required value={due} onChange={(e) => setDue(e.target.value)} className={`inp ${due && due < today && step < 3 ? "bad-input" : ""}`} />
          {!sample && <span className="row" style={{ gap: 4 }}>{[3, 5, 7, 10].map(quick)}</span>}
        </label>
        <label className="field">
          <span>Merchandiser</span>
          <select name="merchandiser_id" defaultValue={sample ? s(sample.merchandiser_id) : people.some((p) => p.id === meId) ? meId : ""} className="inp">
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {(!sample || step >= 1 || sample.factory_id) && (
        <div className="fgrid">
          <label className="field">
            <span>{sample ? "Vendor" : "Vendor (if already decided)"}</span>
            <select name="factory_id" value={vendor} onChange={(e) => setVendor(e.target.value)} className="inp">
              <option value="">{sample ? "None" : "Not yet — keep at Sourcingo"}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          {vendor && (!sample || step >= 1) && (
            <>
              <label className="field">
                <span>Given to vendor on</span>
                <input name="issued_on" type="date" max={today} defaultValue={sample ? s(sample.issued_on) : today} className="inp" />
              </label>
              <label className="field">
                <span>Vendor to return it by</span>
                <input key={sample ? "saved" : due} name="vendor_due" type="date" max={due || undefined} className="inp"
                  defaultValue={sample ? s(sample.vendor_due) : due ? [addDays(due, -2), addDays(due, -1), due].find((d) => d >= today) ?? "" : ""} />
                <small>Keep a day or two before the buyer&apos;s date.</small>
              </label>
            </>
          )}
          {sample && step >= 2 && (
            <label className="field">
              <span>Back from vendor on</span>
              <input name="ready_on" type="date" max={today} defaultValue={s(sample.ready_on)} className="inp" />
            </label>
          )}
          {sample && step >= 3 && (
            <>
              <label className="field">
                <span>Sent to buyer on</span>
                <input name="dispatched_on" type="date" max={today} defaultValue={s(sample.dispatched_on)} className="inp" />
              </label>
              <label className="field"><span>Courier</span><input name="courier" defaultValue={s(sample.courier)} maxLength={100} className="inp" /></label>
              <label className="field"><span>Tracking / AWB</span><input name="tracking" defaultValue={s(sample.tracking)} maxLength={100} className="inp" /></label>
            </>
          )}
        </div>
      )}
      {sample && step >= 4 && (
        <label className="field">
          <span>Buyer&apos;s feedback</span>
          <textarea name="feedback" rows={2} defaultValue={s(sample.feedback)} maxLength={2000} className="inp" />
        </label>
      )}
      <label className="field">
        <span>Remarks</span>
        <textarea name="remarks" rows={2} defaultValue={s(sample?.remarks)} maxLength={2000} placeholder="Print options to send, trims pending, special instructions" className="inp" />
      </label>
      <div className="row">
        <button disabled={pending} className="btn primary">{pending ? "Saving…" : sample ? "Save changes" : vendor ? "Log and give to vendor" : "Log sample"}</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancel</button>}
        {state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      </div>
    </form>
  );
}
