"use client";

import { useActionState, useState, useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { addBuyer, saveBuyer, saveCompany, saveFactory, saveTemplate, setFactoryActive, type FormState, type TemplateInput } from "./actions";

export type Factory = {
  id: string; name: string; city: string | null; contact: string | null; address: string | null; active: boolean; orders: number;
  phone: string | null; email: string | null; gstin: string | null; state: string | null; pan: string | null; bank_name: string | null;
  bank_account: string | null; bank_ifsc: string | null; default_payment_terms: string | null; categories: string[];
  capacity_per_month: number | null; notes: string | null;
};
export type Buyer = {
  id: string; code: string; realName: string | null; terms: string | null; address: string | null; orders: number; gstin: string | null; state: string | null;
  billing_address: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; notes: string | null;
};
export type Company = {
  legal_name: string; trade_name: string; address: string | null; gstin: string | null; pan: string | null; phone: string | null; email: string | null;
  website: string | null; bank_name: string | null; bank_account: string | null; bank_ifsc: string | null; po_terms: string | null; so_terms: string | null;
};

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-bad" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-ok">{state.ok}</p>;
  return null;
}

function F({ label, name, v, placeholder, required, maxLength, type = "text", wide, area }: {
  label: string; name: string; v?: string | number | null; placeholder?: string; required?: boolean; maxLength?: number; type?: string; wide?: boolean; area?: boolean;
}) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <span>{label}{required && <i> *</i>}</span>
      {area ? (
        <textarea name={name} defaultValue={v ?? ""} placeholder={placeholder} className="inp" rows={4} maxLength={maxLength} />
      ) : (
        <input name={name} type={type} defaultValue={v ?? ""} placeholder={placeholder} required={required} maxLength={maxLength} className="inp" />
      )}
    </label>
  );
}

const STATES = "Andhra Pradesh,Assam,Bihar,Chhattisgarh,Delhi,Goa,Gujarat,Haryana,Himachal Pradesh,Jammu and Kashmir,Jharkhand,Karnataka,Kerala,Madhya Pradesh,Maharashtra,Odisha,Punjab,Rajasthan,Tamil Nadu,Telangana,Uttar Pradesh,Uttarakhand,West Bengal".split(",");
function StateField({ v }: { v?: string | null }) {
  return (
    <label className="field"><span>State</span>
      <input name="state" list="in-states" defaultValue={v ?? ""} className="inp" placeholder="Rajasthan" />
      <datalist id="in-states">{STATES.map((s) => <option key={s} value={s} />)}</datalist>
    </label>
  );
}

function FactoryFields({ f }: { f?: Factory }) {
  return (
    <div className="fgrid">
      <F label="Factory name" name="name" v={f?.name} required />
      <F label="City" name="city" v={f?.city} placeholder="Sanganer, Jaipur" />
      <StateField v={f?.state} />
      <F label="Contact person" name="contact" v={f?.contact} />
      <F label="Phone" name="phone" v={f?.phone} type="tel" />
      <F label="Email" name="email" v={f?.email} type="email" />
      <F label="Address" name="address" v={f?.address} wide />
      <F label="GSTIN" name="gstin" v={f?.gstin} maxLength={15} placeholder="08ABCDE1234F1Z5" />
      <F label="PAN" name="pan" v={f?.pan} maxLength={10} />
      <F label="Payment terms" name="default_payment_terms" v={f?.default_payment_terms} placeholder="30 days after GRN" />
      <F label="Makes (comma separated)" name="categories" v={f?.categories.join(", ")} placeholder="Kurtas, Dresses, Home textiles" />
      <F label="Capacity (pcs per month)" name="capacity_per_month" v={f?.capacity_per_month} type="number" />
      <F label="Bank" name="bank_name" v={f?.bank_name} />
      <F label="Account number" name="bank_account" v={f?.bank_account} />
      <F label="IFSC" name="bank_ifsc" v={f?.bank_ifsc} maxLength={11} />
      <F label="Notes" name="notes" v={f?.notes} wide area maxLength={2000} />
    </div>
  );
}

export function AddFactory() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(saveFactory, {});
  if (!open) return <div><button type="button" className="btn primary" onClick={() => setOpen(true)}>+ Add factory</button>{state.ok && <Status state={state} />}</div>;
  return (
    <form key={state.nonce} action={action} className="panel stack">
      <h3 className="font-bold">Add a factory</h3>
      <FactoryFields />
      <div className="row">
        <button disabled={pending} className="btn primary">{pending ? "Adding…" : "Add factory"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
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
  const missing = [!f.gstin && "GSTIN", !f.phone && "phone", !f.default_payment_terms && "payment terms", !f.bank_account && "bank"].filter(Boolean);

  if (editing) {
    return (
      <form action={action} className="stack py-3">
        <input type="hidden" name="id" value={f.id} />
        <FactoryFields f={f} />
        <div className="row">
          <button disabled={pending} className="btn primary">{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="btn">Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-3 ${f.active ? "" : "opacity-60"}`}>
      <div className="min-w-48 flex-1">
        <b>{f.name}</b>
        {f.city && <span className="text-sm text-muted"> · {f.city}{f.state ? `, ${f.state}` : ""}</span>}
        {!f.active && <span className="chip ml-2">Inactive</span>}
        <div className="text-sm text-muted">{[f.contact, f.phone, f.categories.join(", ")].filter(Boolean).join(" · ")}</div>
        {canEdit && f.active && missing.length > 0 && <div className="text-xs text-warn">Missing {missing.join(", ")}</div>}
      </div>
      <span className="text-sm text-muted">{f.orders === 1 ? "1 order" : `${f.orders} orders`}</span>
      {canEdit && (
        <>
          <button onClick={() => setEditing(true)} className="btn sm">Edit</button>
          <button disabled={toggling} onClick={() => startToggle(async () => setToggleState(await setFactoryActive(f.id, !f.active)))} className="btn sm">
            {f.active ? "Deactivate" : "Reactivate"}
          </button>
        </>
      )}
      {(state.ok || toggleState.error || toggleState.ok) && <div className="w-full"><Status state={toggleState.error || toggleState.ok ? toggleState : state} /></div>}
    </div>
  );
}

export function AddBuyer() {
  const [state, action, pending] = useActionState<FormState, FormData>(addBuyer, {});
  return (
    <form key={state.nonce} action={action} className="panel stack">
      <h3 className="font-bold">Add a buyer</h3>
      <p className="text-xs text-muted">Everyone else sees only the code. The real name stays in your private registry.</p>
      <div className="fgrid">
        <F label="Real buyer name" name="real_name" placeholder="Brand Pvt Ltd" required />
        <F label="Initials for the code (optional)" name="initials" placeholder="BP" maxLength={5} />
        <F label="Default payment terms" name="payment_terms" placeholder="45 days" />
        <F label="Default delivery address" name="address" />
      </div>
      <div className="row">
        <button disabled={pending} className="btn primary">{pending ? "Adding…" : "Add buyer"}</button>
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
      <form action={action} className="stack py-3">
        <input type="hidden" name="id" value={b.id} />
        <b className="code">{b.code}</b>
        <div className="fgrid">
          <F label="Real buyer name" name="real_name" v={b.realName} required />
          <F label="Default payment terms" name="payment_terms" v={b.terms} />
          <F label="GSTIN" name="gstin" v={b.gstin} maxLength={15} />
          <StateField v={b.state} />
          <F label="Contact person" name="contact_name" v={b.contact_name} />
          <F label="Contact email" name="contact_email" v={b.contact_email} type="email" />
          <F label="Contact phone" name="contact_phone" v={b.contact_phone} type="tel" />
          <F label="Default delivery address" name="address" v={b.address} wide />
          <F label="Billing address (for invoices)" name="billing_address" v={b.billing_address} wide />
          <F label="Notes" name="notes" v={b.notes} wide area maxLength={2000} />
        </div>
        <div className="row">
          <button disabled={pending} className="btn primary">{pending ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="btn">Cancel</button>
          <Status state={state} />
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <div className="min-w-48 flex-1">
        <b className="code">{b.code}</b>
        {isOwner && <span className="text-sm"> · {b.realName ?? <i className="text-muted">no real name saved</i>}</span>}
        <div className="text-sm text-muted">
          Terms: {b.terms || "not set"}
          {isOwner && b.contact_name ? ` · ${b.contact_name}` : ""}
          {isOwner && b.state ? ` · ${b.state}` : ""}
        </div>
      </div>
      <span className="text-sm text-muted">{b.orders === 1 ? "1 order" : `${b.orders} orders`}</span>
      {isOwner && <button onClick={() => setEditing(true)} className="btn sm">Edit</button>}
      {state.ok && <div className="w-full"><Status state={state} /></div>}
    </div>
  );
}

export function CompanyForm({ c, canEdit }: { c: Company; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCompany, {});
  return (
    <form action={action} className="panel stack">
      <p className="text-[13px] text-muted">Printed on factory POs, sales orders, GRNs and delivery challans.{!canEdit && " Only the owner can change it."}</p>
      <fieldset disabled={!canEdit} className="stack">
        <div className="fgrid">
          <F label="Legal name" name="legal_name" v={c.legal_name} required />
          <F label="Trade name" name="trade_name" v={c.trade_name} required />
          <F label="GSTIN" name="gstin" v={c.gstin} maxLength={15} />
          <F label="PAN" name="pan" v={c.pan} maxLength={10} />
          <F label="Phone" name="phone" v={c.phone} type="tel" />
          <F label="Email" name="email" v={c.email} type="email" />
          <F label="Website" name="website" v={c.website} />
          <F label="Address" name="address" v={c.address} wide />
          <F label="Bank" name="bank_name" v={c.bank_name} />
          <F label="Account number" name="bank_account" v={c.bank_account} />
          <F label="IFSC" name="bank_ifsc" v={c.bank_ifsc} maxLength={11} />
          <F label="Terms printed on every factory PO" name="po_terms" v={c.po_terms} wide area />
          <F label="Terms printed on sales orders" name="so_terms" v={c.so_terms} wide area />
        </div>
        {canEdit && (
          <div className="row">
            <button disabled={pending} className="btn primary">{pending ? "Saving…" : "Save company details"}</button>
            <Status state={state} />
          </div>
        )}
      </fieldset>
    </form>
  );
}

export function TemplateEditor({ t, canEdit }: { t?: TemplateInput; canEdit: boolean }) {
  const { toast } = useFeedback();
  const blank: TemplateInput = { name: "", order_type: "garment", steps: [{ name: "", days: 0 }], is_default: false, active: true };
  const [v, setV] = useState<TemplateInput>(t ?? blank);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const step = (i: number, patch: Partial<{ name: string; days: number }>) => setV({ ...v, steps: v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const days = v.steps.map((s) => s.days);
  const outOfOrder = days.some((d, i) => i > 0 && d > days[i - 1]);

  if (!open) {
    if (!t) return canEdit ? <div><button type="button" className="btn primary" onClick={() => setOpen(true)}>+ New template</button></div> : null;
    return (
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
        <div className="min-w-48 flex-1">
          <b>{t.name}</b> {t.is_default && <span className="chip info">Default for {t.order_type}</span>} {!t.active && <span className="chip">Hidden</span>}
          <div className="mt-1 text-xs text-muted">{t.steps.map((s) => `${s.name} (${s.days}d)`).join(" → ")}</div>
        </div>
        {canEdit && <button type="button" className="btn sm" onClick={() => setOpen(true)}>Edit</button>}
      </div>
    );
  }
  return (
    <form className="panel stack" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveTemplate(v);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (!r.error) { setOpen(false); if (!t) setV(blank); }
      });
    }}>
      <div className="fgrid">
        <label className="field"><span>Template name <i>*</i></span><input className="inp" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
        <label className="field"><span>For</span>
          <select className="inp" value={v.order_type} onChange={(e) => setV({ ...v, order_type: e.target.value as "garment" | "fabric" })}>
            <option value="garment">Garment orders</option><option value="fabric">Fabric orders</option>
          </select>
        </label>
        <label className="row text-sm"><input type="checkbox" checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} /> Default for new orders</label>
        <label className="row text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Show in lists</label>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="sub">Steps, in order · days before the factory delivery date</span>
        {v.steps.map((s, i) => (
          <div key={i} className="row">
            <span className="code w-6 text-right text-muted">{i + 1}</span>
            <input className="inp" style={{ maxWidth: 260 }} value={s.name} placeholder="Cutting" onChange={(e) => step(i, { name: e.target.value })} aria-label={`Step ${i + 1} name`} />
            <input className="inp" style={{ maxWidth: 90 }} type="number" min={0} max={365} value={s.days} onChange={(e) => step(i, { days: Number(e.target.value) })} aria-label={`Step ${i + 1} days before delivery`} />
            <span className="text-xs text-muted">days before</span>
            <button type="button" className="btn icon" aria-label="Remove step" disabled={v.steps.length === 1} onClick={() => setV({ ...v, steps: v.steps.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <div><button type="button" className="btn sm" onClick={() => setV({ ...v, steps: [...v.steps, { name: "", days: 0 }] })}>+ Step</button></div>
        {outOfOrder && <p className="text-xs text-bad">A later step can&apos;t have more days than the one above it. List steps in the order they happen.</p>}
      </div>
      <div className="row">
        <button className="btn primary" disabled={pending || outOfOrder}>{pending ? "Saving…" : "Save template"}</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setV(t ?? blank); }}>Cancel</button>
      </div>
    </form>
  );
}
