"use client";

import { useActionState, useState, useTransition } from "react";
import { inputCls, labelCls, primaryBtn, secondaryBtn } from "@/components/ui";
import { addBuyer, saveBuyer, saveFactory, setFactoryActive, type FormState } from "./actions";

export type Factory = { id: string; name: string; city: string | null; contact: string | null; address: string | null; active: boolean; orders: number };
export type Buyer = { id: string; code: string; realName: string | null; terms: string | null; address: string | null; orders: number };

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-bad">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-muted">{state.ok}</p>;
  return null;
}

function Field({ label, name, defaultValue, placeholder, required, maxLength }: {
  label: string; name: string; defaultValue?: string | null; placeholder?: string; required?: boolean; maxLength?: number;
}) {
  return (
    <label className={labelCls}>
      {label}
      <input name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} maxLength={maxLength} className={inputCls} />
    </label>
  );
}

function FactoryFields({ f }: { f?: Factory }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Factory name" name="name" defaultValue={f?.name} required />
      <Field label="City" name="city" defaultValue={f?.city} placeholder="Sanganer, Jaipur" />
      <Field label="Contact person & phone" name="contact" defaultValue={f?.contact} />
      <Field label="Address" name="address" defaultValue={f?.address} />
    </div>
  );
}

export function AddFactory() {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFactory, {});
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-sm font-bold">Add a factory</h3>
      <FactoryFields />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primaryBtn}>{pending ? "Adding…" : "Add factory"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function FactoryRow({ f, canEdit }: { f: Factory; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const next = await saveFactory(prev, form);
    if (!next.error) setEditing(false);
    return next;
  }, {});
  const [toggleState, setToggleState] = useState<FormState>({});
  const [toggling, startToggle] = useTransition();

  if (editing) {
    return (
      <form action={action} className="flex flex-col gap-3 py-3">
        <input type="hidden" name="id" value={f.id} />
        <FactoryFields f={f} />
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} className={primaryBtn}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className={secondaryBtn}>Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-3 ${f.active ? "" : "opacity-60"}`}>
      <div className="min-w-48 flex-1">
        <b>{f.name}</b>
        {f.city && <span className="text-sm text-muted"> · {f.city}</span>}
        {!f.active && <span className="ml-2 rounded-full bg-line px-2 text-xs font-semibold">Inactive</span>}
        {(f.contact || f.address) && <div className="text-sm text-muted">{[f.contact, f.address].filter(Boolean).join(" · ")}</div>}
      </div>
      <span className="text-sm text-muted">{f.orders === 1 ? "1 order" : `${f.orders} orders`}</span>
      {canEdit && (
        <>
          <button onClick={() => setEditing(true)} className={secondaryBtn}>Edit</button>
          <button
            disabled={toggling}
            onClick={() => startToggle(async () => setToggleState(await setFactoryActive(f.id, !f.active)))}
            className={secondaryBtn}
          >
            {f.active ? "Deactivate" : "Reactivate"}
          </button>
        </>
      )}
      {(state.ok || toggleState.error || toggleState.ok) && (
        <div className="w-full"><Status state={toggleState.error || toggleState.ok ? toggleState : state} /></div>
      )}
    </div>
  );
}

export function AddBuyer() {
  const [state, action, pending] = useActionState<FormState, FormData>(addBuyer, {});
  return (
    <form key={state.nonce} action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-sm font-bold">Add a buyer</h3>
      <p className="text-xs text-muted">Everyone else sees only the code. The real name stays in your private registry.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Real buyer name" name="real_name" placeholder="Brand Pvt Ltd" required />
        <Field label="Initials for the code (optional)" name="initials" placeholder="BP" maxLength={5} />
        <Field label="Default payment terms" name="payment_terms" placeholder="45 days" />
        <Field label="Default delivery address" name="address" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primaryBtn}>{pending ? "Adding…" : "Add buyer"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function BuyerRow({ b, isOwner }: { b: Buyer; isOwner: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const next = await saveBuyer(prev, form);
    if (!next.error) setEditing(false);
    return next;
  }, {});

  if (editing) {
    return (
      <form action={action} className="flex flex-col gap-3 py-3">
        <input type="hidden" name="id" value={b.id} />
        <b className="font-mono text-sm">{b.code}</b>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Real buyer name" name="real_name" defaultValue={b.realName} required />
          <Field label="Default payment terms" name="payment_terms" defaultValue={b.terms} />
          <div className="sm:col-span-2"><Field label="Default delivery address" name="address" defaultValue={b.address} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={pending} className={primaryBtn}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className={secondaryBtn}>Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <div className="min-w-48 flex-1">
        <b className="font-mono text-sm">{b.code}</b>
        {isOwner && <span className="text-sm"> · {b.realName ?? <i className="text-muted">no real name saved</i>}</span>}
        <div className="text-sm text-muted">
          Terms: {b.terms || "not set"}
          {b.address ? ` · ${b.address}` : ""}
        </div>
      </div>
      <span className="text-sm text-muted">{b.orders === 1 ? "1 order" : `${b.orders} orders`}</span>
      {isOwner && <button onClick={() => setEditing(true)} className={secondaryBtn}>Edit</button>}
      {state.ok && <div className="w-full"><Status state={state} /></div>}
    </div>
  );
}
