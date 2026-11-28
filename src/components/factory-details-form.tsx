"use client";

import { useRef, useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";
import { checkKyc, clean, type Kyc, type KycField, STATES, stateOfCode } from "@/lib/factory-kyc";

type Lang = "en" | "hi";
export type TeamExtras = { name: string; notes: string; active: boolean };
type Result = Promise<{ error?: string; field?: string }>;

const W = {
  en: {
    business: "Business", place: "Address", contact: "Contact", bank: "Bank and payment",
    name: "Factory name", legal_name: "Legal name (as on GST)", gstin: "GSTIN", noGst: "No GST", no_gst_reason: "Why no GST?",
    noGstHint: "Allowed for small units under the GST limit. Say why, like “Turnover under ₹40 lakh”.",
    pan: "PAN", udyam_no: "Udyam (MSME) number", address: "Factory address", city: "City", state: "State", pin: "PIN code",
    contact_name: "Contact person", phone: "Mobile", whatsapp: "WhatsApp", sameAsMobile: "Leave empty if same as mobile", email: "Email",
    bank_holder: "Account holder", bank_account: "Account number", bank_ifsc: "IFSC", bank_name: "Bank and branch", pay_days: "Payment terms (days from goods received)",
    pick: "Pick", notes: "Notes", active: "Active (shows when entering orders)", save: "Save details", saving: "Saving…", cancel: "Cancel",
    saved: "Details saved.", fromGst: (s: string) => `State and PAN filled from the GSTIN (${s}).`, keep: (a: string) => `Saved, ends ${a}. Type to replace.`,
    needName: "Enter the factory's name.",
  },
  hi: {
    business: "व्यापार", place: "पता", contact: "संपर्क", bank: "बैंक",
    name: "फैक्ट्री का नाम", legal_name: "कानूनी नाम (GST पर जैसा)", gstin: "GSTIN", noGst: "GST नहीं है", no_gst_reason: "GST क्यों नहीं?",
    noGstHint: "GST सीमा से छोटी यूनिट के लिए ठीक है। कारण लिखें, जैसे “टर्नओवर 40 लाख से कम”।",
    pan: "PAN", udyam_no: "उद्यम (MSME) नंबर", address: "फैक्ट्री का पता", city: "शहर", state: "राज्य", pin: "पिन कोड",
    contact_name: "संपर्क व्यक्ति", phone: "मोबाइल", whatsapp: "WhatsApp", sameAsMobile: "मोबाइल जैसा हो तो खाली छोड़ें", email: "ईमेल",
    bank_holder: "खाताधारक का नाम", bank_account: "खाता नंबर", bank_ifsc: "IFSC", bank_name: "बैंक और ब्रांच", pay_days: "पेमेंट (दिन)",
    pick: "चुनें", notes: "", active: "", save: "जानकारी भेजें", saving: "भेज रहे हैं…", cancel: "रद्द करें",
    saved: "जानकारी सेव हुई।", fromGst: (s: string) => `राज्य और PAN, GSTIN से भरे गए (${s})।`, keep: (a: string) => `सेव है, आखिरी अंक ${a}। बदलने के लिए लिखें।`,
    needName: "",
  },
} as const;

// A factory's full details. The team uses it to add a factory and to correct one; the factory fills its own from its
// panel (no name, no payment terms: those are agreed with Sourcingo). Only the boxes that changed are sent, so a
// bank account the person can't see in full is never overwritten by accident.
export function FactoryDetailsForm({ initial, extras, mode, lang = "en", maskedAccount, submitLabel, onSave, onDone }: {
  initial: Kyc; extras?: TeamExtras; mode: "team" | "factory"; lang?: Lang; maskedAccount?: string; submitLabel?: string;
  onSave: (changed: Partial<Kyc>, extras?: TeamExtras) => Result; onDone?: () => void;
}) {
  const w = W[mode === "team" ? "en" : lang];
  const [k, setK] = useState<Kyc>(initial);
  const [x, setX] = useState<TeamExtras | undefined>(extras);
  const [noGst, setNoGst] = useState(!initial.gstin && !!initial.no_gst_reason);
  const [bad, setBad] = useState<{ field?: string; msg: string } | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  const set = (f: KycField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    let v = e.target.value;
    if (["gstin", "pan", "bank_ifsc", "udyam_no"].includes(f)) v = v.toUpperCase();
    setK((old) => {
      const next = { ...old, [f]: v };
      // A full, valid GSTIN gives the state and the PAN.
      const g = clean(f === "gstin" ? v : old.gstin);
      if (f === "gstin" && g.length === 15 && stateOfCode(g.slice(0, 2))) {
        if (!old.state) next.state = stateOfCode(g.slice(0, 2))!;
        if (!old.pan) next.pan = g.slice(2, 12);
      }
      return next;
    });
    setBad((b) => (b?.field === f ? null : b));
  };
  const point = (field?: string) => {
    const el = field && form.current?.elements.namedItem(field);
    if (el instanceof HTMLElement) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center" }); }
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (x && !x.name.trim()) { setBad({ field: "name", msg: w.needName }); return point("name"); }
    const now: Kyc = { ...k, gstin: noGst ? "" : k.gstin, no_gst_reason: noGst ? k.no_gst_reason : "" };
    const wrong = checkKyc(now);
    if (wrong) { setBad({ field: wrong.field, msg: wrong.error }); return point(wrong.field); }
    const changed: Partial<Kyc> = {};
    for (const f of Object.keys(now) as KycField[]) if (now[f].trim() !== initial[f].trim()) changed[f] = now[f].trim();
    start(async () => {
      const r = await onSave(changed, x);
      if (r.error) { setBad({ field: r.field, msg: r.error }); return point(r.field); }
      toast(w.saved);
      onDone?.();
    });
  }

  const at = (f: string) => ({ name: f, id: `fd-${f}`, "aria-invalid": bad?.field === f || undefined });
  const err = (f: string) => (bad?.field === f ? <small className="text-bad" role="alert">{bad.msg}</small> : null);
  const box = (f: KycField, opts: { type?: string; inputMode?: "numeric" | "tel" | "email" | "text"; ph?: string; max?: number; code?: boolean; wide?: boolean; hint?: string } = {}) => (
    <label className={`field ${opts.wide ? "sm:col-span-2" : ""}`}>
      <span>{w[f as keyof typeof w] as string}</span>
      <input className={`inp ${opts.code ? "code" : ""}`} type={opts.type ?? "text"} inputMode={opts.inputMode} maxLength={opts.max ?? 120}
        placeholder={opts.ph} value={k[f]} onChange={set(f)} autoCapitalize={opts.code ? "characters" : undefined} {...at(f)} />
      {err(f) ?? (opts.hint ? <small className="muted">{opts.hint}</small> : null)}
    </label>
  );

  return (
    <form ref={form} onSubmit={submit} className="stack" noValidate>
      <fieldset className="kyc-set">
        <legend>{w.business}</legend>
        <div className="fgrid">
          {x && (
            <label className="field"><span>{w.name} <i>*</i></span>
              <input className="inp" value={x.name} maxLength={120} autoFocus={!initial.legal_name} {...at("name")}
                onChange={(e) => { setX({ ...x, name: e.target.value }); setBad((b) => (b?.field === "name" ? null : b)); }} />{err("name")}
            </label>
          )}
          {box("legal_name", { max: 200, ph: "Like Kkora Fashions LLP" })}
          {!noGst ? box("gstin", { code: true, max: 24, ph: "08ABCDE1234F1Z5" }) : (
            <label className="field"><span>{w.no_gst_reason}</span>
              <input className="inp" maxLength={200} value={k.no_gst_reason} onChange={set("no_gst_reason")} {...at("no_gst_reason")} />
              {err("no_gst_reason") ?? <small className="muted">{w.noGstHint}</small>}
            </label>
          )}
          {box("pan", { code: true, max: 12, ph: "ABCDE1234F" })}
          {box("udyam_no", { code: true, max: 24, ph: "UDYAM-RJ-17-0012345" })}
        </div>
        <label className="row mt-2 text-[13px]"><input type="checkbox" checked={noGst} onChange={(e) => setNoGst(e.target.checked)} /> {w.noGst}</label>
      </fieldset>

      <fieldset className="kyc-set">
        <legend>{w.place}</legend>
        <div className="fgrid">
          <label className="field sm:col-span-2"><span>{w.address}</span>
            <textarea className="inp" rows={2} maxLength={500} value={k.address} onChange={set("address")} placeholder="Plot, street, area" {...at("address")} />{err("address")}
          </label>
          {box("city", { max: 60 })}
          <label className="field"><span>{w.state}</span>
            <select className="inp" value={k.state} onChange={set("state")} {...at("state")}>
              <option value="">{w.pick}</option>
              {STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
            </select>{err("state")}
          </label>
          {box("pin", { inputMode: "numeric", max: 6, ph: "302022" })}
        </div>
      </fieldset>

      <fieldset className="kyc-set">
        <legend>{w.contact}</legend>
        <div className="fgrid">
          {box("contact_name")}
          {box("phone", { type: "tel", inputMode: "tel", max: 20, ph: "98290 12345" })}
          {box("whatsapp", { type: "tel", inputMode: "tel", max: 20, hint: w.sameAsMobile })}
          {box("email", { type: "email", inputMode: "email", ph: "orders@factory.com" })}
        </div>
      </fieldset>

      <fieldset className="kyc-set">
        <legend>{w.bank}</legend>
        <div className="fgrid">
          {box("bank_holder")}
          {box("bank_account", { inputMode: "numeric", max: 24, ph: maskedAccount ? w.keep(maskedAccount.slice(-4)) : undefined })}
          {box("bank_ifsc", { code: true, max: 11, ph: "SBIN0001234" })}
          {box("bank_name", { ph: "Like SBI, Sanganer" })}
          {mode === "team" && box("pay_days", { inputMode: "numeric", max: 3, ph: "60" })}
        </div>
      </fieldset>

      {x && (
        <>
          <div className="fgrid">
            <label className="field sm:col-span-2"><span>{w.notes}</span><input className="inp" value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} /></label>
          </div>
          <label className="row text-[13px]"><input type="checkbox" checked={x.active} onChange={(e) => setX({ ...x, active: e.target.checked })} /> {w.active}</label>
        </>
      )}
      {bad && !bad.field && <div className="errbox" role="alert">{bad.msg}</div>}
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? w.saving : submitLabel ?? w.save}</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>{w.cancel}</button>}
      </div>
    </form>
  );
}
