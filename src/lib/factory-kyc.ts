// A factory's full details and papers, collected when it is added so a PO never waits on them later.
// The database decides what is missing (factory_gaps() in 0135); this file holds the shared checks the forms run
// first, so a mistake shows under its own box at once, and the words both screens use.

// Indian states and union territories with their GST state codes (the first two digits of a GSTIN).
export const STATES: { name: string; code: string }[] = [
  { name: "Andaman and Nicobar Islands", code: "35" }, { name: "Andhra Pradesh", code: "37" }, { name: "Arunachal Pradesh", code: "12" },
  { name: "Assam", code: "18" }, { name: "Bihar", code: "10" }, { name: "Chandigarh", code: "04" }, { name: "Chhattisgarh", code: "22" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "26" }, { name: "Delhi", code: "07" }, { name: "Goa", code: "30" },
  { name: "Gujarat", code: "24" }, { name: "Haryana", code: "06" }, { name: "Himachal Pradesh", code: "02" },
  { name: "Jammu and Kashmir", code: "01" }, { name: "Jharkhand", code: "20" }, { name: "Karnataka", code: "29" },
  { name: "Kerala", code: "32" }, { name: "Ladakh", code: "38" }, { name: "Lakshadweep", code: "31" }, { name: "Madhya Pradesh", code: "23" },
  { name: "Maharashtra", code: "27" }, { name: "Manipur", code: "14" }, { name: "Meghalaya", code: "17" }, { name: "Mizoram", code: "15" },
  { name: "Nagaland", code: "13" }, { name: "Odisha", code: "21" }, { name: "Puducherry", code: "34" }, { name: "Punjab", code: "03" },
  { name: "Rajasthan", code: "08" }, { name: "Sikkim", code: "11" }, { name: "Tamil Nadu", code: "33" }, { name: "Telangana", code: "36" },
  { name: "Tripura", code: "16" }, { name: "Uttar Pradesh", code: "09" }, { name: "Uttarakhand", code: "05" }, { name: "West Bengal", code: "19" },
];
export const stateOfCode = (code: string) => STATES.find((s) => s.code === code)?.name ?? null;

// The papers a factory gives us. `need`: asked before its first PO. GST certificate is not asked of a factory
// without GST (it gives the reason instead).
export const DOC_KINDS = [
  { kind: "gst", label: "GST certificate", hi: "GST सर्टिफिकेट", need: true, expires: false },
  { kind: "pan", label: "PAN card", hi: "PAN कार्ड", need: true, expires: false },
  { kind: "cheque", label: "Cancelled cheque", hi: "कैंसल चेक", need: true, expires: false },
  { kind: "agreement", label: "Signed vendor agreement", hi: "साइन किया हुआ वेंडर एग्रीमेंट", need: true, expires: false },
  { kind: "udyam", label: "Udyam (MSME) certificate", hi: "उद्यम (MSME) सर्टिफिकेट", need: false, expires: false },
  { kind: "licence", label: "Factory licence", hi: "फैक्ट्री लाइसेंस", need: false, expires: true },
] as const;
export type DocKind = (typeof DOC_KINDS)[number]["kind"];

export const clean = (s: string) => s.replace(/\s+/g, "").toUpperCase();

// The 15th character of a GSTIN is a check digit over the first 14 (base 36, weights 1 and 2).
export function gstinChecksumOk(g: string): boolean {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = chars.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const PIN_RE = /^[1-9][0-9]{5}$/;

export type Kyc = {
  legal_name: string; gstin: string; no_gst_reason: string; pan: string; udyam_no: string;
  address: string; city: string; state: string; pin: string;
  contact_name: string; phone: string; whatsapp: string; email: string;
  bank_holder: string; bank_account: string; bank_ifsc: string; bank_name: string; pay_days: string;
};
export type KycField = keyof Kyc;

// What is wrong with what was typed (not what is missing: a half-filled profile saves, and the meter says what's left).
export function checkKyc(k: Partial<Kyc>): { field: KycField; error: string } | null {
  const g = clean(k.gstin ?? "");
  if (g) {
    if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(g)) return { field: "gstin", error: "A GSTIN has 15 letters and numbers, like 08ABCDE1234F1Z5." };
    if (!stateOfCode(g.slice(0, 2))) return { field: "gstin", error: `A GSTIN starts with a state code; ${g.slice(0, 2)} isn't one.` };
    if (!gstinChecksumOk(g)) return { field: "gstin", error: "That GSTIN has a typo: its last letter doesn't match. Copy it again from the GST certificate." };
    if (k.state && stateOfCode(g.slice(0, 2)) !== k.state) return { field: "gstin", error: `This GSTIN is from ${stateOfCode(g.slice(0, 2))}, but the state says ${k.state}. Check either.` };
  }
  const pan = clean(k.pan ?? "");
  if (pan && !PAN_RE.test(pan)) return { field: "pan", error: "A PAN has 10 letters and numbers, like ABCDE1234F." };
  if (pan && g && g.slice(2, 12) !== pan) return { field: "pan", error: `The PAN doesn't match the GSTIN, whose PAN is ${g.slice(2, 12)}.` };
  const u = clean(k.udyam_no ?? "");
  if (u && !UDYAM_RE.test(u)) return { field: "udyam_no", error: "A Udyam number looks like UDYAM-RJ-17-0012345." };
  if (k.pin && !PIN_RE.test(k.pin.trim())) return { field: "pin", error: "A PIN code has 6 digits, like 302022." };
  if (k.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k.email.trim())) return { field: "email", error: "That email doesn't look right. It looks like name@factory.com." };
  for (const f of ["phone", "whatsapp"] as const) {
    const d = (k[f] ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    if ((k[f] ?? "").trim() && !/^[6-9]\d{9}$/.test(d)) return { field: f, error: "Enter one mobile number with 10 digits, like 98290 12345." };
  }
  const acct = (k.bank_account ?? "").replace(/\s+/g, "");
  if (acct && !/^[0-9]{9,18}$/.test(acct)) return { field: "bank_account", error: "A bank account number has 9 to 18 digits." };
  const ifsc = clean(k.bank_ifsc ?? "");
  if (ifsc && !IFSC_RE.test(ifsc)) return { field: "bank_ifsc", error: "An IFSC has 11 letters and numbers, like SBIN0001234 (the fifth is a zero)." };
  if (k.pay_days && !/^\d{1,3}$/.test(k.pay_days.trim())) return { field: "pay_days", error: "Payment terms are a number of days, like 60." };
  if (k.pay_days && Number(k.pay_days) > 180) return { field: "pay_days", error: "Payment terms over 180 days? Check the number." };
  if (!g && (k.no_gst_reason ?? "").trim() && (k.no_gst_reason ?? "").trim().length < 5) return { field: "no_gst_reason", error: "Say in a few words why it has no GST." };
  return null;
}

// Shows only the last 4 digits of a bank account to people without the Money switch.
export const maskAccount = (a: string | null) => (a ? `•••• ${a.slice(-4)}` : "");

// The missing items, as the database names them, in the order a person fills them.
export type Gaps = { factory_id: string; missing: string[]; total: number };
export const readyWords = (g: Gaps | undefined) =>
  !g ? "" : g.missing.length === 0 ? "Ready for POs" : `${g.missing.length} of ${g.total} missing`;
