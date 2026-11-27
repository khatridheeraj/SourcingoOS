"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SITE_COUNTRIES } from "@/lib/site";
import { askCosting, joinAsFactory, type SiteFormState } from "./actions";

function Field({ name, label, optional, hint, children }: { name: string; label: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="site-field">
      <label htmlFor={`f-${name}`}>{label}{optional ? <small>optional</small> : null}</label>
      {children}
      {hint ? <span className="site-field-hint" id={`f-${name}-hint`}>{hint}</span> : null}
    </div>
  );
}

// Bots fill every field; people never see this one.
const Trap = () => (
  <div className="site-trap" aria-hidden>
    <label htmlFor="f-website">Leave this empty</label>
    <input id="f-website" name="website" tabIndex={-1} autoComplete="off" />
  </div>
);

const Done = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="site-form site-done" role="status">
    <div><span className="site-done-icon">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden><path d="M7 13.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span></div>
    <h2>{title}</h2>
    {children}
  </div>
);

export function CostingForm({ product = "" }: { product?: string }) {
  const [state, action, pending] = useActionState<SiteFormState, FormData>(askCosting, {});
  if (state.ok) {
    return (
      <Done title="Thank you. We have your request.">
        {state.no ? <p>Your reference is <span className="num">{state.no}</span>. A merchandiser will reply by email, usually within a working day.</p>
          : <p>A merchandiser will reply by email, usually within a working day.</p>}
        <p><Link href="/how-it-works" className="site-arrow">While you wait: how an order moves →</Link></p>
      </Done>
    );
  }
  const v = state.values ?? {};
  return (
    <form action={action} className="site-form" noValidate={false}>
      <Trap />
      <fieldset>
        <legend>About you</legend>
        <div className="site-row-2">
          <Field name="name" label="Your name"><input id="f-name" name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={v.name} /></Field>
          <Field name="company" label="Company or brand" optional><input id="f-company" name="company" maxLength={120} autoComplete="organization" defaultValue={v.company} /></Field>
        </div>
        <div className="site-row-2">
          <Field name="email" label="Email"><input id="f-email" name="email" type="email" required maxLength={200} autoComplete="email" inputMode="email" defaultValue={v.email} /></Field>
          <Field name="phone" label="Phone or WhatsApp" optional><input id="f-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={v.phone} /></Field>
        </div>
        <Field name="country" label="Country">
          <input id="f-country" name="country" list="site-countries" maxLength={60} autoComplete="country-name" defaultValue={v.country} required />
          <datalist id="site-countries">{SITE_COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </fieldset>
      <fieldset>
        <legend>What you would like made</legend>
        <Field name="product" label="Product" hint="For example: cotton block-print kaftan, 3 colourways, sizes XS to XL.">
          <input id="f-product" name="product" required minLength={3} maxLength={200} aria-describedby="f-product-hint" defaultValue={v.product ?? product} />
        </Field>
        <div className="site-row-2">
          <Field name="qty" label="Quantity" optional>
            <div className="site-qty">
              <input id="f-qty" name="qty" inputMode="numeric" maxLength={12} placeholder="e.g. 600" defaultValue={v.qty} />
              <select name="unit" aria-label="Unit" defaultValue={v.unit ?? "pcs"}><option value="pcs">pieces</option><option value="m">metres</option></select>
            </div>
          </Field>
          <Field name="target" label="Target price" optional><input id="f-target" name="target" maxLength={80} placeholder="e.g. USD 8 a piece" defaultValue={v.target} /></Field>
        </div>
        <div className="site-row-2">
          <Field name="when" label="Needed by" optional><input id="f-when" name="when" maxLength={80} placeholder="e.g. mid March" defaultValue={v.when} /></Field>
          <Field name="link" label="Link to photos or tech pack" optional><input id="f-link" name="link" type="url" maxLength={300} placeholder="https://" defaultValue={v.link} /></Field>
        </div>
        <Field name="message" label="Anything else" optional>
          <textarea id="f-message" name="message" maxLength={2000} placeholder="Fabric, trims, labels, packing, or a sample you can send us." defaultValue={v.message} />
        </Field>
      </fieldset>
      {state.error ? <p className="site-form-error" role="alert">{state.error}</p> : null}
      <div className="site-form-foot">
        <p>We use these details only to reply to you. <Link href="/privacy" className="site-arrow" style={{ fontSize: 13.5 }}>Privacy</Link></p>
        <button className="site-btn site-btn-lg" disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
      </div>
    </form>
  );
}

export function JoinForm() {
  const [state, action, pending] = useActionState<SiteFormState, FormData>(joinAsFactory, {});
  if (state.ok) {
    return (
      <Done title="Thank you. We have your details.">
        <p>Our team reads every request. If your work fits our buyers, we will call you to talk about your unit. धन्यवाद.</p>
      </Done>
    );
  }
  const v = state.values ?? {};
  return (
    <form action={action} className="site-form">
      <Trap />
      <fieldset>
        <legend>Your factory</legend>
        <div className="site-row-2">
          <Field name="name" label="Factory name"><input id="f-name" name="name" required minLength={2} maxLength={120} autoComplete="organization" defaultValue={v.name} /></Field>
          <Field name="city" label="City"><input id="f-city" name="city" required minLength={2} maxLength={60} placeholder="e.g. Sanganer" defaultValue={v.city} /></Field>
        </div>
        <Field name="makes" label="What you make" hint="For example: kurtas, co-ord sets, block-print fabric.">
          <input id="f-makes" name="makes" required minLength={2} maxLength={300} aria-describedby="f-makes-hint" defaultValue={v.makes} />
        </Field>
        <div className="site-row-2">
          <Field name="pieces_month" label="Pieces a month" optional><input id="f-pieces_month" name="pieces_month" inputMode="numeric" maxLength={10} defaultValue={v.pieces_month} /></Field>
          <Field name="people" label="People working" optional><input id="f-people" name="people" inputMode="numeric" maxLength={7} defaultValue={v.people} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Who to call</legend>
        <div className="site-row-2">
          <Field name="contact_name" label="Your name"><input id="f-contact_name" name="contact_name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={v.contact_name} /></Field>
          <Field name="phone" label="Mobile"><input id="f-phone" name="phone" type="tel" required maxLength={30} autoComplete="tel" defaultValue={v.phone} /></Field>
        </div>
        <Field name="email" label="Email" optional><input id="f-email" name="email" type="email" maxLength={200} autoComplete="email" defaultValue={v.email} /></Field>
        <Field name="message" label="Anything else" optional><textarea id="f-message" name="message" maxLength={2000} defaultValue={v.message} /></Field>
      </fieldset>
      {state.error ? <p className="site-form-error" role="alert">{state.error}</p> : null}
      <div className="site-form-foot">
        <p>Our team reads every request and calls back the factories that fit our buyers.</p>
        <button className="site-btn site-btn-lg" disabled={pending}>{pending ? "Sending…" : "Ask to join"}</button>
      </div>
    </form>
  );
}
