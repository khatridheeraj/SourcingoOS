"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import type { Sample } from "@/lib/model";
import { addSampleNote, deleteSample, type FormState } from "../actions";
import { type Option, SampleForm } from "../sample-form";

// Sample details: read them, or switch to the form to correct them.
export function Details({ s, canEdit, view, ...opts }: {
  s: Sample; canEdit: boolean; view: React.ReactNode; buyers: Option[]; vendors: Option[]; people: Option[]; today: string; meId: string; isOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const done = useCallback(() => setEditing(false), []);
  return (
    <section className="panel">
      <div className="row mb-3">
        <h3 className="grow font-bold" style={{ fontSize: 15 }}>Details</h3>
        {canEdit && !editing && <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {editing ? <SampleForm sample={s} {...opts} onDone={done} /> : view}
    </section>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSampleNote, {});
  return (
    <form key={state.nonce} action={action} className="row">
      <input type="hidden" name="id" value={id} />
      <input name="note" required maxLength={1000} placeholder="Add an update: vendor says Friday, buyer called…" aria-label="Update" className="inp" style={{ flex: 1, minWidth: 200 }} />
      <button disabled={pending} className="btn">{pending ? "Adding…" : "Add"}</button>
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}

export function DeleteSample({ id }: { id: string }) {
  const { confirm, toast } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn danger" disabled={pending} onClick={async () => {
      if (!(await confirm(`Delete ${id} with its photos and history? This can't be undone. To keep the record, cancel it instead.`, "Delete", true))) return;
      start(async () => {
        const r = await deleteSample(id);
        if (r?.error) toast(r.error, "bad");
        else router.push("/samples");
      });
    }}>Delete</button>
  );
}
