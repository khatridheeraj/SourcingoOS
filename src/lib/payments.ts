// Money owed by buyers: invoices, credit notes and the cheques that pay them.
// Pure sums only, so the same numbers show on every screen.

export type ChequeStatus = "in_hand" | "deposited" | "cleared" | "bounced" | "cancelled";
export const CHEQUE_LABEL: Record<ChequeStatus, string> = {
  in_hand: "In hand", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Cancelled",
};
export const CHEQUE_TONE: Record<ChequeStatus, string> = { in_hand: "info", deposited: "warn", cleared: "ok", bounced: "bad", cancelled: "" };
// Statuses in which a cheque still pays its invoices.
export const LIVE: ChequeStatus[] = ["in_hand", "deposited", "cleared"];
// The next steps Accounts can take. The owner may correct anything.
export const NEXT_STEPS: Record<ChequeStatus, ChequeStatus[]> = {
  in_hand: ["deposited", "cleared", "cancelled"],
  deposited: ["cleared", "bounced", "in_hand"],
  cleared: [],
  bounced: [],
  cancelled: [],
};
// Banks honour a cheque for three months from its date.
export const CHEQUE_VALID_DAYS = 90;
// A cheque rounded to the rupee still settles its invoice.
export const SLACK = 1;

export type Invoice = {
  id: string; invoice_no: string; buyer_id: string; invoice_date: string; amount: number; due_date: string | null;
  order_id: string | null; notes: string | null; cancelled_at: string | null;
};
export type CreditNote = { id: string; credit_note_no: string; invoice_id: string; note_date: string; amount: number; notes: string | null; cancelled_at: string | null };
export type Allocation = { id: string; cheque_id: string; invoice_id: string; amount: number };
export type Cheque = {
  id: string; buyer_id: string; cheque_no: string; bank: string | null; cheque_date: string; amount: number; status: ChequeStatus;
  received_on: string | null; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; notes: string | null;
};
export type PayBuyer = { id: string; code: string; realName: string | null; credit_days: number | null };

export type InvoiceState = "cancelled" | "paid" | "covered" | "part" | "open";
export const INVOICE_LABEL: Record<InvoiceState, string> = {
  cancelled: "Cancelled", paid: "Paid", covered: "Cheque received", part: "Part covered", open: "No cheque yet",
};

export type InvoiceRow = Invoice & {
  credit: number; net: number; covered: number; received: number; uncovered: number; outstanding: number;
  due: string | null; state: InvoiceState; overdue: boolean; cheques: { cheque: Cheque; amount: number }[];
};
export type ChequeRow = Cheque & { allocated: number; invoices: { invoice: Invoice; amount: number }[]; expires: string; stale: boolean };

const n = (v: unknown) => Number(v ?? 0) || 0;
export const addDays = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type Books = ReturnType<typeof makeBooks>;
export function makeBooks(raw: { invoices: Invoice[]; creditNotes: CreditNote[]; cheques: Cheque[]; allocations: Allocation[]; buyers: PayBuyer[]; today: string }) {
  const t = raw.today;
  const buyerById = new Map(raw.buyers.map((b) => [b.id, b]));
  const chequeById = new Map(raw.cheques.map((c) => [c.id, c]));
  const invoiceById = new Map(raw.invoices.map((i) => [i.id, i]));
  const creditNotes = raw.creditNotes.filter((c) => !c.cancelled_at);

  const dueOf = (i: Invoice) => {
    if (i.due_date) return i.due_date;
    const d = buyerById.get(i.buyer_id)?.credit_days;
    return d == null ? null : addDays(i.invoice_date, d);
  };

  const invoices: InvoiceRow[] = raw.invoices.map((i) => {
    const credit = creditNotes.filter((c) => c.invoice_id === i.id).reduce((a, c) => a + n(c.amount), 0);
    const net = n(i.amount) - credit;
    const cheques = raw.allocations
      .filter((a) => a.invoice_id === i.id)
      .map((a) => ({ cheque: chequeById.get(a.cheque_id)!, amount: n(a.amount) }))
      .filter((x) => x.cheque)
      .sort((a, z) => a.cheque.cheque_date.localeCompare(z.cheque.cheque_date));
    const live = cheques.filter((x) => LIVE.includes(x.cheque.status));
    const covered = live.reduce((a, x) => a + x.amount, 0);
    const received = live.filter((x) => x.cheque.status === "cleared").reduce((a, x) => a + x.amount, 0);
    const cancelled = !!i.cancelled_at;
    const uncovered = cancelled ? 0 : Math.max(0, net - covered);
    const outstanding = cancelled ? 0 : Math.max(0, net - received);
    const state: InvoiceState = cancelled ? "cancelled" : outstanding <= SLACK ? "paid" : uncovered <= SLACK ? "covered" : covered > 0 ? "part" : "open";
    const due = dueOf(i);
    return {
      ...i, credit, net, covered, received, cheques, due, state,
      uncovered: uncovered <= SLACK ? 0 : uncovered,
      outstanding: outstanding <= SLACK ? 0 : outstanding,
      overdue: (state === "open" || state === "part" || state === "covered") && !!due && due < t,
    };
  });
  const invoiceRowById = new Map(invoices.map((i) => [i.id, i]));

  const cheques: ChequeRow[] = raw.cheques.map((c) => {
    const invs = raw.allocations
      .filter((a) => a.cheque_id === c.id)
      .map((a) => ({ invoice: invoiceById.get(a.invoice_id)!, amount: n(a.amount) }))
      .filter((x) => x.invoice);
    const expires = addDays(c.cheque_date, CHEQUE_VALID_DAYS);
    return { ...c, allocated: invs.reduce((a, x) => a + x.amount, 0), invoices: invs, expires, stale: c.status === "in_hand" && expires < t };
  });

  // An in-hand cheque can go to the bank on or after its date.
  const toDeposit = cheques.filter((c) => c.status === "in_hand" && c.cheque_date <= t && !c.stale);
  const awaitingClear = cheques.filter((c) => c.status === "deposited");

  return { ...raw, creditNotes, buyerById, chequeById, invoiceRowById, invoices, cheques, toDeposit, awaitingClear };
}

// Per-buyer totals, largest amount to collect first.
export function buyerTotals(b: Books) {
  const m = new Map<string, { buyer_id: string; outstanding: number; uncovered: number; overdue: number; held: number; open: number }>();
  const row = (id: string) => {
    let r = m.get(id);
    if (!r) m.set(id, (r = { buyer_id: id, outstanding: 0, uncovered: 0, overdue: 0, held: 0, open: 0 }));
    return r;
  };
  for (const i of b.invoices) {
    if (i.state === "paid" || i.state === "cancelled") continue;
    const r = row(i.buyer_id);
    r.outstanding += i.outstanding;
    r.uncovered += i.uncovered;
    if (i.overdue) r.overdue += i.outstanding;
    r.open++;
  }
  for (const c of b.cheques) if (c.status === "in_hand" || c.status === "deposited") row(c.buyer_id).held += n(c.amount);
  return [...m.values()].sort((a, z) => z.outstanding - a.outstanding);
}

export type Todo = { sev: "bad" | "warn" | "info"; title: string; detail: string; href: string; key: string };

// The day's payment jobs, most urgent first.
export function paymentTodos(b: Books, code: (id: string) => string, money: (v: number) => string, day: (d: string) => string): Todo[] {
  const t = b.today;
  const out: Todo[] = [];
  for (const c of b.cheques) {
    const who = `${code(c.buyer_id)} · ${money(c.amount)}`;
    if (c.status === "bounced" && c.invoices.some((x) => (b.invoiceRowById.get(x.invoice.id)?.uncovered ?? 0) > 0)) {
      out.push({ sev: "bad", title: `Cheque ${c.cheque_no} bounced`, detail: `${who}. Ask the buyer for a new cheque.`, href: `/payments/cheques/${c.id}`, key: c.bounced_on ?? "" });
    } else if (c.status === "in_hand" && c.stale) {
      out.push({ sev: "bad", title: `Cheque ${c.cheque_no} has expired`, detail: `${who}, dated ${day(c.cheque_date)}. Banks stop honouring a cheque after 3 months. Ask for a fresh one.`, href: `/payments/cheques/${c.id}`, key: c.expires });
    } else if (c.status === "in_hand" && c.cheque_date <= t) {
      const left = daysBetween(t, c.expires);
      out.push({ sev: left <= 10 ? "bad" : "warn", title: `Deposit cheque ${c.cheque_no}`, detail: `${who}, dated ${day(c.cheque_date)}${left <= 10 ? `. Expires in ${left} days` : ""}`, href: `/payments/cheques/${c.id}`, key: c.cheque_date });
    }
  }
  // Clearing takes a few days. Past that, someone should check the bank statement.
  const unconfirmed = b.awaitingClear.filter((c) => !c.deposited_on || c.deposited_on <= addDays(t, -3));
  if (unconfirmed.length) {
    out.push({
      sev: "warn", title: `Check ${unconfirmed.length} deposited ${unconfirmed.length === 1 ? "cheque" : "cheques"} against the bank statement`,
      detail: `${money(unconfirmed.reduce((a, c) => a + n(c.amount), 0))} deposited 3 or more days ago. Mark each cleared or bounced.`,
      href: "/payments?tab=cheques&status=deposited", key: "0",
    });
  }
  for (const i of b.invoices) {
    if (i.uncovered > 0 && i.overdue) {
      out.push({ sev: "bad", title: `Overdue: invoice ${i.invoice_no}`, detail: `${code(i.buyer_id)} · due ${day(i.due!)} · ${money(i.uncovered)} has no cheque`, href: `/payments/invoices/${i.id}`, key: i.due ?? "" });
    }
  }
  const noTerms = new Set(b.invoices.filter((i) => !i.due && (i.state === "open" || i.state === "part")).map((i) => i.buyer_id));
  for (const id of noTerms) {
    out.push({ sev: "info", title: `Set credit days for ${code(id)}`, detail: "So the app knows when its invoices fall due.", href: "/payments?tab=buyers", key: "9" });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, z) => rank[a.sev] - rank[z.sev] || a.key.localeCompare(z.key));
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
