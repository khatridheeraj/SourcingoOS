"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import "./factory-bits.css";
import { Ring } from "@/components/order-ui";
import { FactoryDetailsForm, type TeamExtras } from "@/components/factory-details-form";
import { FactoryPapers, type PaperInput, type PaperRow } from "@/components/factory-papers";
import type { Kyc } from "@/lib/factory-kyc";
import { day } from "@/lib/format";

type Result = Promise<{ error?: string; field?: string }>;
type Lang = "en" | "hi";

const HI_MISSING: Record<string, string> = {
  "Legal name": "कानूनी नाम", GSTIN: "GSTIN", PAN: "PAN", Address: "पता", State: "राज्य", "PIN code": "पिन कोड", "Contact person": "संपर्क व्यक्ति",
  Mobile: "मोबाइल", Email: "ईमेल", "Bank account and IFSC": "बैंक खाता और IFSC", "Payment terms": "पेमेंट की शर्तें", "GST certificate": "GST सर्टिफिकेट",
  "PAN card": "PAN कार्ड", "Cancelled cheque": "कैंसल चेक", "Signed vendor agreement": "साइन किया हुआ एग्रीमेंट",
};

const FACTORY_EN = {
  title: "Your details and papers", missingSub: "Sourcingo can send you POs once these are in.", readySub: "Sourcingo has everything it needs for your POs and payments.",
};

const W = {
  en: {
    title: "Details and papers", ready: "Ready for POs", readySub: "Everything a PO and a payment need is here.",
    missing: (n: number) => `${n} missing`, missingSub: "A PO can't be sent for approval until these are in.",
    fill: "Fill in details", edit: "Edit details", papers: "Papers", show: "See details and papers",
    bankMoved: (d: string) => `The factory changed its bank details on ${d}. Confirm them by phone before the next payment, then save them here.`,
    legal: "Legal name", gstin: "GSTIN", noGst: "No GST", pan: "PAN", udyam: "Udyam", address: "Address", contact: "Contact", mobile: "Mobile",
    whatsapp: "WhatsApp", email: "Email", bank: "Bank", terms: "Payment terms", days: (n: string) => `${n} days from goods received`, none: "Not given",
  },
  hi: {
    title: "आपकी जानकारी और कागज़", ready: "PO के लिए तैयार", readySub: "PO और पेमेंट के लिए सब कुछ मिल गया है।",
    missing: (n: number) => `${n} बाकी`, missingSub: "Sourcingo आपको PO तभी भेज सकता है जब ये सब मिल जाएँ।",
    fill: "जानकारी भरें", edit: "जानकारी बदलें", papers: "कागज़", show: "जानकारी और कागज़ देखें",
    bankMoved: () => "",
    legal: "कानूनी नाम", gstin: "GSTIN", noGst: "GST नहीं", pan: "PAN", udyam: "उद्यम", address: "पता", contact: "संपर्क", mobile: "मोबाइल",
    whatsapp: "WhatsApp", email: "ईमेल", bank: "बैंक", terms: "पेमेंट", days: (n: string) => `माल मिलने से ${n} दिन`, none: "नहीं दिया",
  },
} as const;

// A factory's details and papers in one place, with how complete they are and what is still missing: on the team's
// factory page and in the factory's own panel. What is missing comes from factory_gaps() in the database.
export function FactoryKycCard({ details, extras, gaps, papers, folder, mode, lang = "en", canEdit, today, maskedAccount, bankChangedAt, ask, openAtStart, actions }: {
  details: Kyc; extras?: TeamExtras; gaps: { missing: string[]; total: number }; papers: PaperRow[]; folder: string;
  mode: "team" | "factory"; lang?: Lang; canEdit: boolean; today: string; maskedAccount?: string; bankChangedAt?: string | null;
  ask?: React.ReactNode; openAtStart?: boolean;
  actions: { save: (k: Partial<Kyc>, x?: TeamExtras) => Result; savePaper: (p: PaperInput) => Promise<{ error?: string }>; checkPaper?: (id: string, ok: boolean, note: string) => Promise<{ error?: string }> };
}) {
  const w = mode === "team" ? W.en : lang === "hi" ? W.hi : { ...W.en, ...FACTORY_EN };
  const router = useRouter();
  const [editing, setEditing] = useState(!!openAtStart);
  // Payment terms are agreed with Sourcingo, so the factory isn't asked for them.
  const missing = mode === "factory" ? gaps.missing.filter((m) => m !== "Payment terms") : gaps.missing;
  const total = mode === "factory" ? gaps.total - 1 : gaps.total;
  const done = total - missing.length;
  const ready = missing.length === 0;
  const noGst = !details.gstin && !!details.no_gst_reason;
  const facts: [string, string][] = [
    [w.legal, details.legal_name], [w.gstin, details.gstin || (noGst ? `${w.noGst}: ${details.no_gst_reason}` : "")], [w.pan, details.pan],
    [w.udyam, details.udyam_no], [w.address, details.address ? [details.address, details.city, details.state, details.pin].filter(Boolean).join(", ") : ""],
    [w.contact, details.contact_name], [w.mobile, details.phone], [w.whatsapp, details.whatsapp || details.phone], [w.email, details.email],
    [w.bank, [details.bank_holder, details.bank_account || maskedAccount, details.bank_ifsc, details.bank_name].filter(Boolean).join(" · ")],
    ...(mode === "team" ? [[w.terms, details.pay_days ? w.days(details.pay_days) : ""] as [string, string]] : []),
  ];

  const factsList = (
    <dl className="kyc-facts">
      {facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
  const papersList = (
    <div>
      <span className="eyebrow">{w.papers}</span>
      <FactoryPapers rows={papers} folder={folder} mode={mode} lang={lang} canEdit={canEdit} noGst={noGst} today={today}
        actions={{ save: actions.savePaper, check: actions.checkPaper }} />
    </div>
  );

  return (
    <section className="panel stack" id="details" aria-labelledby="kyc-h">
      <div className="kyc-head">
        <Ring done={done} total={total} size={52}><span className="num">{done}/{total}</span></Ring>
        <div className="grow min-w-0">
          <div className="row gap-2">
            <h2 id="kyc-h" className="font-bold">{w.title}</h2>
            {ready ? <span className="chip ok">{w.ready}</span> : <span className="chip warn">{w.missing(missing.length)}</span>}
          </div>
          <p className="muted text-[13px]">{ready ? w.readySub : w.missingSub}</p>
        </div>
      </div>
      {!ready && (
        <ul className="kyc-missing" aria-label="Missing">
          {missing.map((m) => <li key={m}>{mode === "factory" && lang === "hi" ? HI_MISSING[m] ?? m : m}</li>)}
        </ul>
      )}
      {mode === "team" && bankChangedAt && <div className="warnbox" role="status">{w.bankMoved(day(bankChangedAt.slice(0, 10)))}</div>}
      {canEdit && !editing && (
        <div className="row kyc-acts">
          <button type="button" className={`btn ${!ready && missing.some((m) => !/certificate|card|cheque|agreement/.test(m)) ? "primary" : ""}`} onClick={() => setEditing(true)}>
            {ready ? w.edit : w.fill}
          </button>
          {!ready && ask}
        </div>
      )}
      {editing ? (
        <FactoryDetailsForm initial={details} extras={extras} mode={mode} lang={lang} maskedAccount={maskedAccount}
          onSave={actions.save} onDone={() => { setEditing(false); router.refresh(); }} />
      ) : ready ? (
        <details className="kyc-more">
          <summary>{w.show}</summary>
          <div className="stack mt-3">{factsList}{papersList}</div>
        </details>
      ) : <>{factsList}{papersList}</>}
    </section>
  );
}
