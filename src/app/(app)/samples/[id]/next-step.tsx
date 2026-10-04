"use client";

import { startTransition, useActionState, useEffect } from "react";
import { useFeedback } from "@/components/feedback";
import { addDays, fmtDay, SAMPLE_LABEL, type Sample, type SampleStatus } from "@/lib/model";
import { type FormState, moveSample } from "../actions";
import type { Option } from "../sample-form";

const BACK: Partial<Record<SampleStatus, SampleStatus>> = { with_vendor: "received", ready: "with_vendor", dispatched: "ready", approved: "dispatched", changes: "dispatched", rejected: "dispatched" };

function useMove() {
  const [state, action, pending] = useActionState<FormState, FormData>(moveSample, {});
  const { toast } = useFeedback();
  useEffect(() => {
    if (state.ok) toast(state.ok);
  }, [state, toast]);
  return { state, action, pending };
}

function Note({ placeholder }: { placeholder: string }) {
  return (
    <label className="field">
      <span>Note (optional)</span>
      <input name="note" maxLength={1000} placeholder={placeholder} className="inp" />
    </label>
  );
}

// The one thing to do next, with only the details that step needs.
export function NextStep({ s, vendors, today, vendorName }: { s: Sample; vendors: Option[]; today: string; vendorName: string }) {
  const { state, action, pending } = useMove();
  const vendorDefault = s.due_date ? [addDays(s.due_date, -2), addDays(s.due_date, -1), s.due_date].find((d) => d >= today) ?? "" : "";
  const newRound = s.status === "changes" || s.status === "rejected";
  const hidden = <input type="hidden" name="id" value={s.id} />;
  const err = state.error && <p className="text-sm text-bad" role="alert">{state.error}</p>;

  let body: React.ReactNode = null;
  if (s.status === "received" || newRound) {
    body = (
      <form key={`${s.status}-${s.round}`} action={action} className="stack">
        {hidden}
        <input type="hidden" name="to" value="with_vendor" />
        <h3 className="font-bold">{newRound ? `Start round ${s.round + 1}: give it back to a vendor` : "Give it to a vendor"}</h3>
        {newRound && s.feedback && <p className="warnbox"><b>Buyer said:</b> {s.feedback}</p>}
        <div className="fgrid">
          <label className="field">
            <span>Vendor <i>*</i></span>
            <select name="factory_id" required defaultValue={s.factory_id ?? ""} className="inp">
              <option value="" disabled>Select vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Given on</span><input name="issued_on" type="date" max={today} defaultValue={today} className="inp" /></label>
          {newRound && (
            <label className="field"><span>New buyer due date <i>*</i></span><input name="due_date" type="date" required min={today} className="inp" /></label>
          )}
          <label className="field">
            <span>Vendor to return it by</span>
            <input name="vendor_due" type="date" min={today} defaultValue={newRound ? "" : vendorDefault} className="inp" />
          </label>
        </div>
        <Note placeholder="What to make, trims, print options" />
        <div className="row"><button disabled={pending} className="btn primary">{pending ? "Saving…" : "Give to vendor"}</button>{err}</div>
      </form>
    );
  } else if (s.status === "with_vendor") {
    body = (
      <form action={action} className="stack">
        {hidden}
        <input type="hidden" name="to" value="ready" />
        <h3 className="font-bold">Back from {vendorName}?</h3>
        <p className="text-sm text-muted">
          With them since {fmtDay(s.issued_on)}{s.vendor_due ? `, promised back by ${fmtDay(s.vendor_due)}` : ""}. Check it, then mark it ready to send.
        </p>
        <div className="fgrid">
          <label className="field"><span>Back on</span><input name="ready_on" type="date" max={today} defaultValue={today} className="inp" /></label>
          <Note placeholder="Checked measurements, minor fix done" />
        </div>
        <div className="row"><button disabled={pending} className="btn primary">{pending ? "Saving…" : "Mark ready to send"}</button>{err}</div>
      </form>
    );
  } else if (s.status === "ready") {
    body = (
      <form action={action} className="stack">
        {hidden}
        <input type="hidden" name="to" value="dispatched" />
        <h3 className="font-bold">Send it to the buyer</h3>
        <div className="fgrid">
          <label className="field"><span>Sent on</span><input name="dispatched_on" type="date" max={today} defaultValue={today} className="inp" /></label>
          <label className="field"><span>Courier</span><input name="courier" maxLength={100} placeholder="DTDC, Blue Dart, by hand" className="inp" /></label>
          <label className="field"><span>Tracking / AWB</span><input name="tracking" maxLength={100} className="inp" /></label>
        </div>
        <Note placeholder="Sent with the fabric swatch card" />
        <div className="row"><button disabled={pending} className="btn primary">{pending ? "Saving…" : "Mark sent to buyer"}</button>{err}</div>
      </form>
    );
  } else if (s.status === "dispatched") {
    body = (
      <form action={action} className="stack">
        {hidden}
        <h3 className="font-bold">What did the buyer say?</h3>
        <label className="field">
          <span>Their feedback</span>
          <textarea name="feedback" rows={2} maxLength={2000} placeholder="Approved for bulk / shorten sleeve by 1 inch / use a softer fabric" className="inp" />
        </label>
        <div className="row">
          <button disabled={pending} name="to" value="approved" className="btn primary">Approved</button>
          <button disabled={pending} name="to" value="changes" className="btn">Changes asked</button>
          <button disabled={pending} name="to" value="rejected" className="btn danger">Rejected</button>
          {err}
        </div>
      </form>
    );
  } else if (s.status === "approved") {
    body = <p className="okbox">Approved by the buyer{s.feedback ? `: ${s.feedback}` : "."} Nothing more to do on this sample.</p>;
  } else if (s.status === "cancelled") {
    body = (
      <form action={action} className="row">
        {hidden}
        <input type="hidden" name="to" value="received" />
        <span className="grow text-sm text-muted">This sample is cancelled.</span>
        <button disabled={pending} className="btn sm">Reopen</button>
        {err}
      </form>
    );
  }

  return (
    <section className="panel stack">
      {body}
      <div className="row text-sm">
        {BACK[s.status] && <BackButton id={s.id} to={BACK[s.status]!} />}
        {s.status !== "cancelled" && s.status !== "approved" && <CancelSample id={s.id} />}
      </div>
    </section>
  );
}

function BackButton({ id, to }: { id: string; to: SampleStatus }) {
  const { state, action, pending } = useMove();
  const { confirm } = useFeedback();
  const back = async () => {
    if (!(await confirm(`Move it back to "${SAMPLE_LABEL[to]}"? The date of the later step is cleared.`, "Move back"))) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("to", to);
    startTransition(() => action(fd));
  };
  return (
    <span>
      <button type="button" disabled={pending} className="link text-muted" onClick={back}>↶ Undo: back to {SAMPLE_LABEL[to]}</button>
      {state.error && <span className="ml-2 text-bad">{state.error}</span>}
    </span>
  );
}

function CancelSample({ id }: { id: string }) {
  const { state, action, pending } = useMove();
  return (
    <details className="ml-auto">
      <summary>Cancel this sample</summary>
      <form action={action} className="row mt-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="to" value="cancelled" />
        <input name="note" required maxLength={1000} placeholder="Why? e.g. buyer dropped the style" className="inp" style={{ minWidth: 220 }} />
        <button disabled={pending} className="btn sm danger">Cancel sample</button>
        {state.error && <span className="text-bad">{state.error}</span>}
      </form>
    </details>
  );
}
