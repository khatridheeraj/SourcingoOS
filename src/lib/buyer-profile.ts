// A buyer's details and papers: what is complete, what is missing, and what each paper we issue still needs.
// The one place that decides it (docs/DESIGN.md): the buyer's record, the buyer list, the order's dispatch area,
// the export papers and the buyer's own page all read it from here. Pure, so the screens and the tests agree.

export type Contact = { name?: string; role?: string; phone?: string; whatsapp?: string; email?: string };

export type BuyerProfile = {
  legal_name: string | null; brand_name: string | null; billing_address: string | null; country: string | null;
  more_addresses: string | null; gstin: string | null; pan: string | null; tax_id: string | null; eori: string | null;
  contacts: Contact[]; payment_terms: string | null; deposit_pct: number | null; credit_limit: number | null;
  incoterm: string | null; port: string | null; consignee: string | null; notify_party: string | null;
  bank_holder: string | null; bank_name: string | null; bank_account: string | null; bank_code: string | null;
  asked_at: string | null; buyer_filled_at: string | null; updated_at: string | null;
};

// Kept on the buyer itself (other screens already read them): main ship-to address, currency, credit days.
export type BuyerBasics = { delivery_address: string | null; currency: string | null; credit_days: number | null };

export type DocKind = "gst" | "registration" | "pan" | "agreement" | "artwork" | "other";
export type BuyerDoc = { id: string; kind: DocKind; path: string; file_name: string; by_buyer: boolean; added_at: string };

export const DOC_LABEL: Record<DocKind, string> = {
  gst: "GST certificate", registration: "Company registration", pan: "PAN card", agreement: "Sourcingo buyer agreement, signed",
  artwork: "Logo and label artwork", other: "Other paper",
};

export const EMPTY_PROFILE: BuyerProfile = {
  legal_name: null, brand_name: null, billing_address: null, country: null, more_addresses: null, gstin: null, pan: null,
  tax_id: null, eori: null, contacts: [], payment_terms: null, deposit_pct: null, credit_limit: null, incoterm: null,
  port: null, consignee: null, notify_party: null, bank_holder: null, bank_name: null, bank_account: null, bank_code: null,
  asked_at: null, buyer_filled_at: null, updated_at: null,
};

// Reads a row from the database (or the buyer's own copy) into a full profile.
export function toProfile(row: unknown): BuyerProfile {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const out = { ...EMPTY_PROFILE } as Record<string, unknown>;
  for (const k of Object.keys(EMPTY_PROFILE)) if (k in r && r[k] != null) out[k] = r[k];
  out.contacts = Array.isArray(r.contacts) ? r.contacts : [];
  for (const k of ["deposit_pct", "credit_limit"]) out[k] = r[k] == null ? null : Number(r[k]);
  return out as BuyerProfile;
}

const has = (s: string | null | undefined) => !!s && s.trim() !== "";

// India unless another country is written. Every buyer so far is Indian.
export const isIndian = (p: Pick<BuyerProfile, "country">) => !has(p.country) || /^(india|in|bharat)$/i.test(p.country!.trim());

// EORI is asked of buyers in the EU and the UK, who need it to clear goods.
const EORI_COUNTRIES = /^(uk|united kingdom|great britain|england|scotland|wales|northern ireland|germany|france|italy|spain|netherlands|belgium|austria|ireland|portugal|denmark|sweden|finland|poland|czech|czechia|greece|hungary|romania|bulgaria|croatia|slovakia|slovenia|estonia|latvia|lithuania|luxembourg|malta|cyprus)$/i;
export const needsEori = (p: Pick<BuyerProfile, "country">) => has(p.country) && EORI_COUNTRIES.test(p.country!.trim());

// A contact the team can reach: a name with a mobile and an email.
export const reachable = (c: Contact) => has(c.name) && has(c.phone) && has(c.email);

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// What each paper we issue needs. "orders" is the whole list for Ready for orders.
export type Use = "invoice" | "export" | "ship";

export type Item = {
  key: string; label: string; done: boolean;
  // Needed before the buyer is Ready for orders; the rest help but never hold anything back.
  required: boolean;
  // The papers that can't go out without it.
  uses: Use[];
  // A paper to upload rather than a box to fill.
  doc?: DocKind;
  // Who usually has it: the buyer (ask them) or us (agreed terms).
  from: "buyer" | "us";
};

export function profileItems(p: BuyerProfile, b: BuyerBasics, docs: BuyerDoc[]): Item[] {
  const india = isIndian(p);
  const hasDoc = (k: DocKind) => docs.some((d) => d.kind === k);
  const items: Item[] = [
    { key: "legal_name", label: india ? "Legal name, as on the GST certificate" : "Legal company name", done: has(p.legal_name), required: true, uses: ["invoice", "export"], from: "buyer" },
    { key: "billing_address", label: "Billing address", done: has(p.billing_address), required: true, uses: ["invoice", "export"], from: "buyer" },
    { key: "delivery_address", label: "Shipping address", done: has(b.delivery_address), required: true, uses: ["ship", "export"], from: "buyer" },
    { key: "contact", label: "A contact with mobile and email", done: p.contacts.some(reachable), required: true, uses: ["ship"], from: "buyer" },
  ];
  if (india) {
    items.push(
      { key: "gstin", label: "GSTIN", done: has(p.gstin), required: true, uses: ["invoice"], from: "buyer" },
      { key: "pan", label: "PAN", done: has(p.pan), required: true, uses: ["invoice"], from: "buyer" },
    );
  } else {
    items.push(
      { key: "country", label: "Country", done: has(p.country), required: true, uses: ["invoice", "export"], from: "buyer" },
      { key: "tax_id", label: "Tax or VAT number", done: has(p.tax_id), required: true, uses: ["invoice", "export"], from: "buyer" },
    );
    if (needsEori(p)) items.push({ key: "eori", label: "EORI number", done: has(p.eori), required: true, uses: ["export"], from: "buyer" });
    items.push(
      { key: "incoterm", label: "Incoterm they buy on", done: has(p.incoterm), required: true, uses: ["export"], from: "us" },
      { key: "port", label: "Port or airport of arrival", done: has(p.port), required: true, uses: ["export"], from: "buyer" },
      { key: "consignee", label: "Consignee for the export papers", done: has(p.consignee), required: true, uses: ["export"], from: "buyer" },
      { key: "notify_party", label: "Notify party", done: has(p.notify_party), required: true, uses: ["export"], from: "buyer" },
    );
  }
  items.push(
    { key: "terms", label: "Payment terms", done: has(p.payment_terms) || b.credit_days != null, required: true, uses: ["invoice"], from: "us" },
    india
      ? { key: "doc_gst", label: DOC_LABEL.gst, done: hasDoc("gst"), required: true, uses: [], doc: "gst", from: "buyer" }
      : { key: "doc_registration", label: DOC_LABEL.registration, done: hasDoc("registration"), required: true, uses: [], doc: "registration", from: "buyer" },
  );
  if (india) items.push({ key: "doc_pan", label: DOC_LABEL.pan, done: hasDoc("pan"), required: true, uses: [], doc: "pan", from: "buyer" });
  items.push(
    { key: "doc_agreement", label: DOC_LABEL.agreement, done: hasDoc("agreement"), required: true, uses: [], doc: "agreement", from: "buyer" },
    // Helpful, never holding anything back.
    { key: "whatsapp", label: "WhatsApp number", done: p.contacts.some((c) => has(c.whatsapp) || has(c.phone)), required: false, uses: [], from: "buyer" },
    { key: "deposit", label: "Deposit or credit limit", done: p.deposit_pct != null || p.credit_limit != null, required: false, uses: [], from: "us" },
    { key: "bank", label: "Bank account for refunds", done: has(p.bank_account) && has(p.bank_code), required: false, uses: [], from: "buyer" },
    { key: "doc_artwork", label: DOC_LABEL.artwork, done: hasDoc("artwork"), required: false, uses: [], doc: "artwork", from: "buyer" },
  );
  return items;
}

export type Score = { done: number; total: number; pct: number; ready: boolean; missing: Item[]; optional: Item[] };

// How complete the buyer is. Ready for orders once every required item is in.
export function profileScore(p: BuyerProfile, b: BuyerBasics, docs: BuyerDoc[]): Score {
  const items = profileItems(p, b, docs);
  const req = items.filter((i) => i.required);
  const done = items.filter((i) => i.done).length;
  return {
    done, total: items.length, pct: Math.round((done / items.length) * 100),
    ready: req.every((i) => i.done), missing: req.filter((i) => !i.done), optional: items.filter((i) => !i.required && !i.done),
  };
}

// What one paper we issue is still waiting for, as short lines to show above it.
export function gapsFor(use: Use, p: BuyerProfile, b: BuyerBasics, docs: BuyerDoc[]): string[] {
  return profileItems(p, b, docs).filter((i) => !i.done && i.uses.includes(use)).map((i) => `Buyer: ${i.label}`);
}

// The first thing wrong with what was typed, or null. Blank boxes are fine: the meter says what is missing.
export function profileProblem(p: Partial<BuyerProfile> & { delivery_address?: string | null }): string | null {
  const g = (p.gstin ?? "").replace(/\s/g, "").toUpperCase();
  if (g && !GSTIN_RE.test(g)) return "The GSTIN should be 15 letters and numbers, like 08ABCDE1234F1Z5.";
  const pan = (p.pan ?? "").replace(/\s/g, "").toUpperCase();
  if (pan && !PAN_RE.test(pan)) return "The PAN should be 10 letters and numbers, like ABCDE1234F.";
  if (g && pan && g.slice(2, 12) !== pan) return "The PAN doesn't match the GSTIN (its 3rd to 12th characters). Check both.";
  for (const c of p.contacts ?? []) {
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return `"${c.email}" is not an email address.`;
    if (c.phone && c.phone.replace(/\D/g, "").length < 10) return `Write ${c.name || "the contact"}'s mobile with all its digits.`;
    if (c.whatsapp && c.whatsapp.replace(/\D/g, "").length < 10) return `Write ${c.name || "the contact"}'s WhatsApp number with all its digits.`;
  }
  if (p.deposit_pct != null && !(p.deposit_pct >= 0 && p.deposit_pct <= 100)) return "The deposit is a percentage from 0 to 100.";
  if (p.credit_limit != null && !(p.credit_limit >= 0)) return "The credit limit is an amount in rupees, like 500000.";
  return null;
}

// The message the team sends with the buyer's link, asking for what is missing.
export function askMessage(buyer: string, missing: Item[], url: string): string {
  const list = missing.filter((i) => i.from === "buyer").map((i) => `• ${i.label}`).join("\n");
  return `Hello ${buyer} team,\nTo invoice and ship your orders without delays, we need a few details and papers from you. Please fill them in and upload them on your Sourcingo page (no password needed):\n\n${list || "• Please check your company details"}\n\n${url}\n\nThank you.`;
}

// Which papers to list for a buyer, needed ones first.
export function paperKinds(country: string | null): { kind: DocKind; needed: boolean }[] {
  const india = isIndian({ country });
  return [
    ...(india ? [{ kind: "gst" as const, needed: true }, { kind: "pan" as const, needed: true }] : [{ kind: "registration" as const, needed: true }]),
    { kind: "agreement", needed: true }, { kind: "artwork", needed: false },
    ...(india ? [{ kind: "registration" as const, needed: false }] : []), { kind: "other", needed: false },
  ];
}
