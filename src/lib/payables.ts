// Bills to pay: every supplier bill booked in Tally with money left on it, and when it falls due.
// The database works out what is left (payables() in 0056); this decides how each bill reads and adds them up.
import { daysBetween } from "./format";

export type Payable = {
  ledger: string; factory_id: string | null; factory: string | null;
  // No bill: money Tally says is owed from before the bills it was first read for.
  bill: string | null; bill_date: string | null; amount: number | null;
  settled: number; on_account: number; open: number; last_paid: string | null;
  days: number; msme: Msme | null; udyam_no: string | null; agreed_due: string | null; due_on: string | null;
  hold: boolean; note: string | null; order_id: string | null; order_no: string | null;
};
export type Msme = "micro" | "small" | "medium" | "none";

export const DEFAULT_DAYS = 60;
// Micro and small enterprises must be paid within 45 days of accepting the goods (MSMED Act, section 15).
export const MSME_DAYS = 45;
export const MSME_LABEL: Record<Msme, string> = { micro: "Micro", small: "Small", medium: "Medium", none: "Not registered" };
export const isMsme45 = (m: Msme | null | undefined) => m === "micro" || m === "small";

export const supplierName = (p: { factory: string | null; ledger: string }) => p.factory ?? tidyLedger(p.ledger);
// "SHREE JI ARTS ( PURCHASE )" reads "Shree Ji Arts".
export function tidyLedger(name: string) {
  const bare = name.replace(/\(\s*purchases?\s*\)/i, "").replace(/\s+/g, " ").trim();
  return bare.toLowerCase().replace(/(^|[\s(./&-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Llp|Pvt|Ltd)\b/g, (w) => (w === "Llp" ? "LLP" : w));
}

export type Due = { key: "hold" | "overdue" | "week" | "month" | "later" | "older"; text: string; tone: "bad" | "warn" | "info" | "" ; left: number | null };
// How a bill stands today: how late, or how long until it falls due.
export function dueOf(p: Payable, today: string): Due {
  if (!p.due_on) return { key: "older", text: "Older balance", tone: "", left: null };
  const left = daysBetween(today, p.due_on);
  if (p.hold) return { key: "hold", text: "On hold", tone: "info", left };
  if (left < 0) return { key: "overdue", text: `${-left} ${left === -1 ? "day" : "days"} late`, tone: "bad", left };
  if (left === 0) return { key: "week", text: "Due today", tone: "warn", left };
  if (left <= 7) return { key: "week", text: `Due in ${left} ${left === 1 ? "day" : "days"}`, tone: "warn", left };
  return { key: left <= 30 ? "month" : "later", text: `Due in ${left} days`, tone: "", left };
}

export const GROUPS: { key: Due["key"]; title: string; hint: string }[] = [
  { key: "overdue", title: "Overdue", hint: "Past the due date. Pay these first." },
  { key: "week", title: "Due in 7 days", hint: "Falls due this week." },
  { key: "month", title: "Due in 30 days", hint: "Plan these into next month's payments." },
  { key: "later", title: "Later", hint: "Not due for a month or more." },
  { key: "hold", title: "On hold", hint: "Held back on purpose, with the reason." },
  { key: "older", title: "Older balances", hint: "Owed in Tally from before the bills it was first read for. Check them in Tally." },
];

export type Totals = { owed: number; overdue: number; week: number; month: number; overdueBills: number; weekBills: number; msmeLate: number; msmeLateAmount: number };
export function totals(list: Payable[], today: string): Totals {
  const t: Totals = { owed: 0, overdue: 0, week: 0, month: 0, overdueBills: 0, weekBills: 0, msmeLate: 0, msmeLateAmount: 0 };
  for (const p of list) {
    const d = dueOf(p, today);
    t.owed += p.open;
    if (d.key === "overdue") { t.overdue += p.open; t.overdueBills++; }
    if (d.key === "week") { t.week += p.open; t.weekBills++; }
    if (d.key === "overdue" || d.key === "week" || d.key === "month") t.month += p.open;
    // The legal limit is passed whether or not the bill is held.
    if (isMsme45(p.msme) && p.due_on && p.due_on < today) { t.msmeLate++; t.msmeLateAmount += p.open; }
  }
  return t;
}

export type Supplier = {
  ledger: string; name: string; factoryId: string | null; days: number; msme: Msme | null; udyam: string | null;
  bills: Payable[]; owed: number; overdue: number; nextDue: string | null; worst: Due;
};
export function bySupplier(list: Payable[], today: string): Supplier[] {
  const map = new Map<string, Supplier>();
  for (const p of list) {
    let s = map.get(p.ledger);
    if (!s) {
      s = { ledger: p.ledger, name: supplierName(p), factoryId: p.factory_id, days: p.days, msme: p.msme, udyam: p.udyam_no, bills: [], owed: 0, overdue: 0, nextDue: null, worst: dueOf(p, today) };
      map.set(p.ledger, s);
    }
    const d = dueOf(p, today);
    s.bills.push(p);
    s.owed += p.open;
    if (d.key === "overdue") s.overdue += p.open;
    if (p.due_on && !p.hold && (!s.nextDue || p.due_on < s.nextDue)) s.nextDue = p.due_on;
    const rank = (x: Due) => ["overdue", "week", "month", "later", "hold", "older"].indexOf(x.key);
    if (rank(d) < rank(s.worst) || (rank(d) === rank(s.worst) && d.left != null && s.worst.left != null && d.left < s.worst.left)) s.worst = d;
  }
  return [...map.values()].sort((a, z) => z.overdue - a.overdue || z.owed - a.owed);
}

// Lakh and crore, as the team says amounts.
export const lakh = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`);
