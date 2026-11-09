import { latinDigits } from "./digits.ts";

// The checks on a factory PO's printed details and its email, shared by the form (so each message shows under its
// own box at once) and the save (which runs them again before anything is written, so a bad box never leaves the
// other boxes half saved).

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const GSTIN = /^[0-9]{2}[A-Z0-9]{13}$/;

export const GSTIN_MSG = "That GSTIN doesn't look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5.";
export const MOBILE_MSG = "That mobile number doesn't look right. Enter one number with 10 digits, like 98290 12345.";
export const EMAIL_MSG = "That email doesn't look right. It looks like name@factory.com.";

export const cleanGstin = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export const gstinOk = (s: string) => { const g = cleanGstin(s); return !g || GSTIN.test(g); };
export const emailOk = (s: string) => { const e = s.trim(); return !e || EMAIL.test(e); };

// A mobile is 10 digits, maybe with +91, 0 or 0091 in front, spaces or dashes; Hindi digits count too.
export function mobileOk(s: string): boolean {
  const t = latinDigits(s).trim();
  if (!t) return true;
  if (/[^\d\s+\-().]/.test(t)) return false;
  const d = t.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 14;
}

// Addresses as people paste them: "a@x.com, b@y.com", "a@x.com; b@y.com" (Outlook), one per line, a trailing comma,
// or "Ramesh Kumar <ramesh@factory.com>" copied from Gmail. Returns the clean addresses and the first one that
// still doesn't look like an email.
export function emailList(s: string): { emails: string[]; bad: string | null } {
  const emails: string[] = [];
  let bad: string | null = null;
  for (const part of s.split(/[,;\n]+/)) {
    const p = part.trim();
    if (!p) continue;
    const inAngle = p.match(/<([^<>]+)>/);
    const e = (inAngle ? inAngle[1] : p).trim().replace(/^mailto:/i, "").toLowerCase();
    if (EMAIL.test(e)) { if (!emails.includes(e)) emails.push(e); }
    else if (bad === null) bad = p;
  }
  return { emails, bad };
}

export type PoDetailsField =
  | "factory.gstin" | "factory.email" | "factory.phone"
  | "company.gstin" | "company.email" | "company.phone";

type Contact = { gstin: string; email: string; phone: string };

export function checkPoDetails(factory: Contact, company?: Contact): { field: PoDetailsField; error: string } | null {
  if (!gstinOk(factory.gstin)) return { field: "factory.gstin", error: GSTIN_MSG };
  if (!mobileOk(factory.phone)) return { field: "factory.phone", error: MOBILE_MSG };
  if (!emailOk(factory.email)) return { field: "factory.email", error: EMAIL_MSG };
  if (company) {
    if (!gstinOk(company.gstin)) return { field: "company.gstin", error: GSTIN_MSG };
    if (!mobileOk(company.phone)) return { field: "company.phone", error: MOBILE_MSG };
    if (!emailOk(company.email)) return { field: "company.email", error: "That email doesn't look right. It looks like name@company.com." };
  }
  return null;
}

// The "Email PO to factory" boxes: one address to send to, any number to copy.
export function checkPoMail(to: string, cc: string): { field: "to" | "cc"; error: string } | { to: string; cc: string } {
  const t = emailList(to);
  if (!to.trim()) return { field: "to", error: "Enter the factory's email address." };
  if (t.bad !== null || t.emails.length !== 1) {
    return { field: "to", error: t.emails.length > 1 && t.bad === null ? "Send to one address here; put the others in CC." : EMAIL_MSG };
  }
  const c = emailList(cc);
  if (c.bad !== null) return { field: "cc", error: `"${c.bad}" doesn't look like an email. Put a comma between addresses.` };
  return { to: t.emails[0], cc: c.emails.filter((e) => e !== t.emails[0]).join(", ") };
}
