"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { INCOTERMS } from "@/lib/export-docs";
import { DOC_LABEL, isIndian, needsEori, profileProblem, type BuyerBasics, type BuyerDoc, type BuyerProfile, type Contact, type DocKind } from "@/lib/buyer-profile";
import { uploadAttachments } from "@/lib/photos";

// The form a buyer's details are typed into: by the team on the buyer's record (with our terms), and by the buyer on
// its own page (without them). Blank boxes are fine; the meter above says what is still missing.

type Text = Record<string, string>;
export type SaveFn = (p: Record<string, unknown>) => Promise<{ error?: string }>;

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "AUD", "CAD"];

function start(p: BuyerProfile, b: BuyerBasics): Text {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    legal_name: s(p.legal_name), brand_name: s(p.brand_name), billing_address: s(p.billing_address), country: s(p.country) || "India",
    delivery_address: s(b.delivery_address), more_addresses: s(p.more_addresses), gstin: s(p.gstin), pan: s(p.pan), tax_id: s(p.tax_id),
    eori: s(p.eori), payment_terms: s(p.payment_terms), deposit_pct: s(p.deposit_pct), credit_limit: s(p.credit_limit),
    credit_days: s(b.credit_days), currency: s(b.currency) || "INR", incoterm: s(p.incoterm), port: s(p.port), consignee: s(p.consignee),
    notify_party: s(p.notify_party), bank_holder: s(p.bank_holder), bank_name: s(p.bank_name), bank_account: s(p.bank_account), bank_code: s(p.bank_code),
  };
}

export function BuyerProfileForm({ profile, basics, team, save, missing, onDone }: {
  profile: BuyerProfile; basics: BuyerBasics; team: boolean; save: SaveFn;
  // Keys still missing, so their boxes are marked.
  missing: string[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<Text>(() => start(profile, basics));
  const [contacts, setContacts] = useState<Contact[]>(() => (profile.contacts.length ? profile.contacts : [{}]));
  const [sameShip, setSameShip] = useState(() => !basics.delivery_address || basics.delivery_address === profile.billing_address);
  const [error, setError] = useState("");
  const [pending, go] = useTransition();
  const india = isIndian({ country: v.country });
  const eori = needsEori({ country: v.country });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  // Missing boxes are listed above the form, not painted red: red only ever means late (docs/DESIGN.md).
  const miss = (k: string) => (missing.includes(k) ? { "data-missing": "" } : {});
  const setC = (i: number, k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setContacts(contacts.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const out: Text = { ...v, delivery_address: sameShip ? v.billing_address : v.delivery_address };
    if (!team) for (const k of ["payment_terms", "deposit_pct", "credit_limit", "credit_days", "currency"]) delete out[k];
    if (india) { out.tax_id = ""; out.eori = ""; } else { out.gstin = ""; out.pan = ""; }
    if (!eori) out.eori = "";
    const cs = contacts.filter((c) => Object.values(c).some((x) => x && String(x).trim()));
    const bad = profileProblem({ gstin: out.gstin, pan: out.pan, contacts: cs,
      deposit_pct: out.deposit_pct ? Number(out.deposit_pct) : null, credit_limit: out.credit_limit ? Number(out.credit_limit.replace(/[,\s]/g, "")) : null });
    if (bad) { setError(bad); return; }
    go(async () => {
      const r = await save({ ...out, contacts: cs });
      if (r.error) { setError(r.error); return; }
      toast("Details saved.");
      router.refresh();
      onDone?.();
    });
  }

  const box = (k: string, label: string, opts: { hint?: string; ph?: string; code?: boolean; area?: boolean; type?: string } = {}) => (
    <label className="field">
      <span>{label}{missing.includes(k) && <b className="text-warn font-normal"> · to add</b>}</span>
      {opts.area
        ? <textarea className="inp" rows={3} value={v[k]} onChange={set(k)} placeholder={opts.ph} {...miss(k)} />
        : <input className={`inp${opts.code ? " code" : ""}`} value={v[k]} onChange={set(k)} placeholder={opts.ph} inputMode={opts.type === "num" ? "decimal" : undefined} {...miss(k)} />}
      {opts.hint && <small>{opts.hint}</small>}
    </label>
  );

  return (
    <form onSubmit={submit} className="stack gap-6">
      <fieldset className="stack">
        <legend className="font-semibold text-[14px] mb-2">Company</legend>
        <div className="fgrid">
          {box("legal_name", india ? "Legal name, as on GST" : "Legal company name", { hint: "Exactly as it should print on the invoice." })}
          {box("brand_name", "Brand or trade name")}
          <label className="field"><span>Country</span>
            <input className="inp" value={v.country} onChange={set("country")} list="bp-countries" {...miss("country")} />
            <datalist id="bp-countries">{["India", "United States", "United Kingdom", "United Arab Emirates", "Germany", "France", "Australia", "Canada"].map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend className="font-semibold text-[14px] mb-2">Tax numbers</legend>
        <div className="fgrid">
          {india ? (
            <>
              {box("gstin", "GSTIN", { code: true, hint: "15 letters and numbers." })}
              {box("pan", "PAN", { code: true, hint: "Filled from the GSTIN if left blank." })}
            </>
          ) : (
            <>
              {box("tax_id", "Tax or VAT number", { code: true, hint: "VAT, EIN or the company's tax number." })}
              {eori && box("eori", "EORI number", { code: true, hint: "Needed to clear goods into the EU or UK." })}
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend className="font-semibold text-[14px] mb-2">Addresses</legend>
        {box("billing_address", "Billing address", { area: true, hint: "As it should print on the invoice, with PIN or postcode." })}
        <label className="row text-[13px]"><input type="checkbox" checked={sameShip} onChange={(e) => setSameShip(e.target.checked)} /> Goods go to the billing address</label>
        {!sameShip && box("delivery_address", "Shipping address", { area: true, hint: "Where goods are delivered. Printed on the challan and export papers." })}
        {box("more_addresses", "Other shipping addresses", { area: true, hint: "Warehouses or stores goods sometimes go to. One per line." })}
      </fieldset>

      <fieldset className="stack">
        <legend className="font-semibold text-[14px] mb-2">People</legend>
        {contacts.map((c, i) => (
          <div key={i} className="fgrid p-3 rounded-lg border border-[var(--line)]">
            <label className="field"><span>Name</span><input className="inp" value={c.name ?? ""} onChange={setC(i, "name")} /></label>
            <label className="field"><span>Role</span><input className="inp" value={c.role ?? ""} onChange={setC(i, "role")} placeholder="Sourcing, Accounts, Owner" /></label>
            <label className="field"><span>Mobile</span><input className="inp" type="tel" value={c.phone ?? ""} onChange={setC(i, "phone")} placeholder="+91 98290 12345" /></label>
            <label className="field"><span>WhatsApp</span><input className="inp" type="tel" value={c.whatsapp ?? ""} onChange={setC(i, "whatsapp")} placeholder="If not the mobile" /></label>
            <label className="field"><span>Email</span><input className="inp" type="email" value={c.email ?? ""} onChange={setC(i, "email")} /></label>
            {contacts.length > 1 && <div className="field justify-end"><button type="button" className="btn sm ghost" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>Remove</button></div>}
          </div>
        ))}
        {contacts.length < 12 && <div><button type="button" className="btn sm" onClick={() => setContacts([...contacts, {}])}>Add another person</button></div>}
      </fieldset>

      {team && (
        <fieldset className="stack">
          <legend className="font-semibold text-[14px] mb-2">Our terms</legend>
          <div className="fgrid">
            {box("payment_terms", "Payment terms", { ph: "45 days from GRN" })}
            {box("credit_days", "Credit days", { type: "num", ph: "45" })}
            <label className="field"><span>Currency</span>
              <select className="inp" value={v.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            {box("deposit_pct", "Deposit before production, %", { type: "num", ph: "30" })}
            {box("credit_limit", "Credit limit, Rs", { type: "num", ph: "500000" })}
            <label className="field"><span>Incoterm</span>
              <select className="inp" value={v.incoterm} onChange={set("incoterm")} {...miss("incoterm")}><option value="">Not set</option>{INCOTERMS.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
          </div>
          <small className="muted">Only the team sees these. The buyer never sees credit limit, deposit or these notes.</small>
        </fieldset>
      )}

      {india ? (
        <details open={!!(v.port || v.consignee || v.notify_party)}>
          <summary className="font-semibold text-[14px] cursor-pointer">Export papers (only for goods leaving India)</summary>
          <ExportBoxes box={box} team={team} v={v} set={set} miss={miss} />
        </details>
      ) : (
        <fieldset className="stack">
          <legend className="font-semibold text-[14px] mb-2">Export papers</legend>
          <ExportBoxes box={box} team={team} v={v} set={set} miss={miss} />
        </fieldset>
      )}

      <details open={!!(v.bank_account || v.bank_holder)}>
        <summary className="font-semibold text-[14px] cursor-pointer">Bank account for refunds</summary>
        <div className="fgrid mt-3">
          {box("bank_holder", "Account name")}
          {box("bank_name", "Bank")}
          {box("bank_account", "Account number", { code: true })}
          {box("bank_code", india ? "IFSC" : "SWIFT or IBAN code", { code: true })}
        </div>
      </details>

      {error && <div className="errbox" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary w-full sm:w-auto" disabled={pending}>{pending ? "Saving…" : "Save details"}</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

function ExportBoxes({ box, team, v, set, miss }: {
  box: (k: string, label: string, opts?: { hint?: string; ph?: string; area?: boolean }) => React.ReactNode; team: boolean; v: Text;
  set: (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => void; miss: (k: string) => object;
}) {
  return (
    <div className="stack mt-3">
      <div className="fgrid">
        {!team && (
          <label className="field"><span>Incoterm you buy on</span>
            <select className="inp" value={v.incoterm} onChange={set("incoterm")} {...miss("incoterm")}><option value="">Not sure</option>{INCOTERMS.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        )}
        {box("port", "Port or airport of arrival", { ph: "Jebel Ali, Dubai" })}
      </div>
      {box("consignee", "Consignee", { area: true, hint: "Who the goods are shipped to on the papers, with address. Often the buyer itself." })}
      {box("notify_party", "Notify party", { area: true, hint: "Who the shipping line tells when goods arrive: often the buyer's customs agent. Write \"Same as consignee\" if so." })}
    </div>
  );
}

// The buyer's papers: one line per kind, each with its files and an upload button.
export function BuyerPapers({ folder, docs, urls, kinds, add, remove, removable }: {
  folder: string; docs: BuyerDoc[]; urls: Record<string, string>; kinds: { kind: DocKind; needed: boolean }[];
  add: (kind: DocKind, path: string, name: string) => Promise<{ error?: string }>;
  remove?: (id: string) => Promise<{ error?: string }>;
  // Which files a Remove button shows on: all of them (the team), or only those the buyer sent (the buyer).
  removable: "all" | "buyer" | "none";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function upload(kind: DocKind, files: FileList | null) {
    if (!files?.length) return;
    setError("");
    setBusy(kind);
    try {
      const list = [...files];
      const paths = await uploadAttachments(folder, list);
      for (let i = 0; i < paths.length; i++) {
        const r = await add(kind, paths[i], list[i].name);
        if (r.error) throw new Error(r.error);
      }
      toast(`${DOC_LABEL[kind]} added.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file didn't upload. Try again.");
    } finally {
      setBusy(null);
    }
  }
  async function drop(d: BuyerDoc) {
    if (!remove) return;
    setBusy(d.id);
    const r = await remove(d.id);
    setBusy(null);
    if (r.error) setError(r.error);
    else { toast("Taken off."); router.refresh(); }
  }

  return (
    <div className="stack">
      <ul className="flex flex-col divide-y divide-[var(--line)]" data-photos>
        {kinds.map(({ kind, needed }) => {
          const mine = docs.filter((d) => d.kind === kind);
          return (
            <li key={kind} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex-1 min-w-[180px]">
                <b className="text-[14px] font-medium">{DOC_LABEL[kind]}</b>
                {mine.length === 0 && needed && <span className="text-warn text-[12.5px] ml-2">Needed</span>}
                {mine.map((d) => (
                  <div key={d.id} className="text-[13px] mt-1 flex items-center gap-2 min-w-0">
                    {urls[d.path]
                      ? <a className="link truncate" href={urls[d.path]} target={/\.(jpe?g|png|webp)$/i.test(d.path) ? undefined : "_blank"} rel="noreferrer" data-caption={`${DOC_LABEL[kind]} · ${d.file_name}`}>{d.file_name}</a>
                      : <span className="truncate">{d.file_name}</span>}
                    {d.by_buyer && <span className="muted shrink-0">from buyer</span>}
                    {remove && (removable === "all" || (removable === "buyer" && d.by_buyer)) && <button type="button" className="btn sm ghost shrink-0" disabled={busy === d.id} onClick={() => drop(d)}>Remove</button>}
                  </div>
                ))}
              </div>
              <label className={`btn sm ${busy === kind ? "opacity-50 pointer-events-none" : ""}`}>
                {busy === kind ? "Uploading…" : mine.length ? "Add another" : "Upload"}
                <input type="file" className="sr-only" accept="image/*,.pdf,.doc,.docx" multiple onChange={(e) => { upload(kind, e.target.files); e.target.value = ""; }} />
              </label>
            </li>
          );
        })}
      </ul>
      {error && <div className="errbox" role="alert">{error}</div>}
      <small className="muted">A photo from the phone or a PDF. Each file opens here on the page.</small>
    </div>
  );
}
