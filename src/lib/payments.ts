// Receivables: invoices, credit notes and cheques. Pure functions only, like
// model.ts, so the same sums run on the server and in the browser.
import { addDays, type Alert, type Buyer, daysBetween, fmtDay, money, num } from "@/lib/model";

export type ChequeStatus = "in_hand" | "deposited" | "cleared" | "bounced" | "cancelled";
export const CHEQUE_LABEL: Record<ChequeStatus, string> = {
  in_hand: "In hand", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Cancelled",
};
// Statuses in which a cheque still pays its invoices.
export const LIVE: ChequeStatus[] = ["in_hand", "deposited", "cleared"];
// The next steps Accounts can take (the owner may correct anything).
export const NEXT_STEPS: Record<ChequeStatus, ChequeStatus[]> = {
  in_hand: ["deposited", "cleared", "cancelled"],
  deposited: ["cleared", "bounced", "in_hand"],
  cleared: [],
  bounced: [],
  cancelled: [],
};
// Banks honour a cheque for three months from its date.
export const CHEQUE_VALID_DAYS = 90;
// Rupee rounding on a cheque still settles the invoice.
export const SLACK = 1;

export type Invoice = {
  id: string; invoice_no: string; buyer_id: string; invoice_date: string; amount: number | null; due_date: string | null;
  so_id: string | null; dc_id: string | null; notes: string | null; created_at: string;
};
export type CreditNote = { id: string; credit_note_no: string; invoice_id: string; note_date: string; amount: number; notes: string | null };
export type Allocation = { id: string; cheque_id: string; invoice_id: string; amount: number };
export type Cheque = {
  id: string; buyer_id: string; cheque_no: string; bank: string | null; cheque_date: string; amount: number; status: ChequeStatus;
  received_on: string | null; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; notes: string | null;
  created_at: string;
};
export type PayBuyer = Buyer & { credit_days: number | null };

export type InvoiceState = "no_amount" | "paid" | "covered" | "part" | "open";
export const INVOICE_LABEL: Record<InvoiceState, string> = {
  no_amount: "Amount needed", paid: "Paid", covered: "Cheque received", part: "Part covered", open: "No cheque yet",
};

export type InvoiceRow = Invoice & {
  credit: number; net: number | null; covered: number; received: number; uncovered: number; outstanding: number;
  due: string | null; state: InvoiceState; overdue: boolean; cheques: { cheque: Cheque; amount: number }[];
};
export type ChequeRow = Cheque & { allocated: number; invoices: { invoice: Invoice; amount: number }[]; expires: string; stale: boolean };

export type Books = ReturnType<typeof makeBooks>;
export function makeBooks(raw: {
  invoices: Invoice[]; creditNotes: CreditNote[]; cheques: Cheque[]; allocations: Allocation[]; buyers: PayBuyer[]; today: string;
}) {
  const t = raw.today;
  const buyerById = new Map(raw.buyers.map((b) => [b.id, b]));
  const chequeById = new Map(raw.cheques.map((c) => [c.id, c]));
  const invoiceById = new Map(raw.invoices.map((i) => [i.id, i]));
  const creditFor = new Map<string, CreditNote[]>();
  for (const c of raw.creditNotes) creditFor.set(c.invoice_id, [...(creditFor.get(c.invoice_id) ?? []), c]);

  const dueOf = (i: Invoice) => {
    if (i.due_date) return i.due_date;
    const d = buyerById.get(i.buyer_id)?.credit_days;
    return d == null ? null : addDays(i.invoice_date, d);
  };

  const invoices: InvoiceRow[] = raw.invoices.map((i) => {
    const credit = (creditFor.get(i.id) ?? []).reduce((a, c) => a + num(c.amount), 0);
    const net = i.amount == null ? null : num(i.amount) - credit;
    const cheques = raw.allocations
      .filter((a) => a.invoice_id === i.id)
      .map((a) => ({ cheque: chequeById.get(a.cheque_id)!, amount: num(a.amount) }))
      .filter((x) => x.cheque)
      .sort((a, b) => a.cheque.cheque_date.localeCompare(b.cheque.cheque_date));
    const live = cheques.filter((x) => LIVE.includes(x.cheque.status));
    const covered = live.reduce((a, x) => a + x.amount, 0);
    const received = live.filter((x) => x.cheque.status === "cleared").reduce((a, x) => a + x.amount, 0);
    const uncovered = net == null ? 0 : Math.max(0, net - covered);
    const outstanding = net == null ? 0 : Math.max(0, net - received);
    const state: InvoiceState =
      net == null ? "no_amount" : outstanding <= SLACK ? "paid" : uncovered <= SLACK ? "covered" : covered > 0 ? "part" : "open";
    const due = dueOf(i);
    return { ...i, credit, net, covered, received, uncovered: uncovered <= SLACK ? 0 : uncovered, outstanding: outstanding <= SLACK ? 0 : outstanding, due, state, overdue: state !== "paid" && !!due && due < t, cheques };
  });
  const invoiceRowById = new Map(invoices.map((i) => [i.id, i]));

  const cheques: ChequeRow[] = raw.cheques.map((c) => {
    const invs = raw.allocations
      .filter((a) => a.cheque_id === c.id)
      .map((a) => ({ invoice: invoiceById.get(a.invoice_id)!, amount: num(a.amount) }))
      .filter((x) => x.invoice);
    const expires = addDays(c.cheque_date, CHEQUE_VALID_DAYS);
    return { ...c, allocated: invs.reduce((a, x) => a + x.amount, 0), invoices: invs, expires, stale: c.status === "in_hand" && expires < t };
  });

  // An in-hand cheque can go to the bank on or after its date.
  const toDeposit = cheques.filter((c) => c.status === "in_hand" && c.cheque_date <= t && !c.stale);
  const awaitingClear = cheques.filter((c) => c.status === "deposited");

  return { ...raw, buyerById, chequeById, invoiceRowById, invoices, cheques, toDeposit, awaitingClear, dueOf };
}

// Per-buyer totals for the summary table.
export function buyerTotals(b: Books) {
  const m = new Map<string, { buyer_id: string; outstanding: number; uncovered: number; overdue: number; inHand: number; open: number; next: string | null }>();
  const row = (id: string) => {
    let r = m.get(id);
    if (!r) m.set(id, (r = { buyer_id: id, outstanding: 0, uncovered: 0, overdue: 0, inHand: 0, open: 0, next: null }));
    return r;
  };
  for (const i of b.invoices) {
    if (i.state === "paid") continue;
    const r = row(i.buyer_id);
    r.outstanding += i.outstanding;
    r.uncovered += i.uncovered;
    if (i.overdue) r.overdue += i.outstanding;
    r.open++;
  }
  for (const c of b.cheques) {
    if (c.status !== "in_hand" && c.status !== "deposited") continue;
    const r = row(c.buyer_id);
    r.inHand += num(c.amount);
    if (c.status === "in_hand" && (!r.next || c.cheque_date < r.next)) r.next = c.cheque_date;
  }
  return [...m.values()].sort((a, z) => z.outstanding - a.outstanding);
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function paymentAlerts(b: Books, code: (id: string) => string): Alert[] {
  const t = b.today;
  const out: Alert[] = [];
  for (const c of b.cheques) {
    const who = `${code(c.buyer_id)} · ${money(c.amount)}`;
    if (c.status === "bounced") {
      const unpaid = c.invoices.filter((x) => (b.invoiceRowById.get(x.invoice.id)?.uncovered ?? 0) > 0);
      if (unpaid.length) {
        out.push({ sev: "bad", t: `Cheque ${c.cheque_no} bounced`, d: `${who} · ${unpaid.map((x) => x.invoice.invoice_no).join(", ")} need a new cheque`, href: `/payments/cheques/${c.id}`, k: c.bounced_on ?? "" });
      }
    } else if (c.status === "in_hand") {
      const left = daysBetween(t, c.expires);
      if (c.stale) {
        out.push({ sev: "bad", t: `Cheque ${c.cheque_no} has expired`, d: `${who} · dated ${fmtDay(c.cheque_date)}, banks stop honouring it after 3 months. Ask for a fresh cheque.`, href: `/payments/cheques/${c.id}`, k: c.expires });
      } else if (c.cheque_date <= t) {
        out.push({
          sev: left <= 10 ? "bad" : "warn",
          t: c.cheque_date === t ? `Deposit cheque ${c.cheque_no} today` : `Deposit cheque ${c.cheque_no}`,
          d: `${who} · dated ${fmtDay(c.cheque_date)}${left <= 10 ? ` · expires in ${plural(left, "day")}` : ""}`,
          href: `/payments/cheques/${c.id}`, k: c.cheque_date,
        });
      } else if (c.cheque_date <= addDays(t, 7)) {
        const n = daysBetween(t, c.cheque_date);
        out.push({ sev: "info", t: `Cheque ${c.cheque_no} can be deposited ${n === 1 ? "tomorrow" : `in ${n} days`}`, d: `${who} · dated ${fmtDay(c.cheque_date)}`, href: `/payments/cheques/${c.id}`, k: c.cheque_date });
      }
    }
  }
  // Bank clearing takes a few days; past that, someone should confirm it.
  const unconfirmed = b.awaitingClear.filter((c) => !c.deposited_on || c.deposited_on <= addDays(t, -3));
  if (unconfirmed.length) {
    const total = unconfirmed.reduce((a, c) => a + num(c.amount), 0);
    out.push({ sev: "warn", t: `Confirm ${plural(unconfirmed.length, "deposited cheque")} cleared`, d: `${money(total)} deposited 3 or more days ago. Check the bank statement, then mark them cleared or bounced.`, href: "/payments?tab=cheques&status=deposited", k: "1" });
  }
  for (const i of b.invoices) {
    const who = `${code(i.buyer_id)} · ${money(i.net ?? 0)}`;
    if (i.state === "no_amount") {
      out.push({ sev: "info", t: `Enter the amount of invoice ${i.invoice_no}`, d: `${code(i.buyer_id)} · ${i.dc_id ? `dispatched on ${i.dc_id}` : "invoice"} ${fmtDay(i.invoice_date)}`, href: `/payments/invoices/${i.id}`, k: i.invoice_date });
    } else if (i.uncovered > 0) {
      if (i.overdue) {
        out.push({ sev: "bad", t: `Overdue: invoice ${i.invoice_no}`, d: `${who} · due ${fmtDay(i.due)} · ${money(i.uncovered)} has no cheque`, href: `/payments/invoices/${i.id}`, k: i.due ?? "" });
      } else {
        out.push({ sev: "note", t: `No cheque yet for ${i.invoice_no}`, d: `${who}${i.due ? ` · due ${fmtDay(i.due)}` : ""}`, href: `/payments/invoices/${i.id}`, k: i.due ?? "9" });
      }
    }
  }
  const noTerms = new Set(b.invoices.filter((i) => !i.due && i.state !== "paid").map((i) => i.buyer_id));
  for (const id of noTerms) {
    out.push({ sev: "info", t: `Set credit days for ${code(id)}`, d: "So the app can work out when its invoices are due.", href: "/payments?tab=buyers" });
  }
  const rank = { bad: 0, warn: 1, info: 2, note: 3 };
  return out.sort((a, z) => rank[a.sev] - rank[z.sev] || (a.k ?? "").localeCompare(z.k ?? ""));
}

// Sidebar badge: cheques to take to the bank, bounced ones, overdue invoices.
export function paymentBadge(b: Books) {
  const bad = paymentAlerts(b, () => "").filter((a) => a.sev === "bad").length;
  const n = b.toDeposit.length + bad;
  return n ? { n, hot: bad > 0 } : null;
}

// Fill a cheque across invoices, oldest due first, without overpaying any.
export function autoSplit(amount: number, open: { id: string; left: number }[]) {
  let rest = amount;
  const out: Record<string, string> = {};
  for (const i of open) {
    if (rest <= 0) break;
    const take = Math.min(rest, i.left);
    if (take > 0) {
      out[i.id] = String(Math.round(take * 100) / 100);
      rest -= take;
    }
  }
  return out;
}
