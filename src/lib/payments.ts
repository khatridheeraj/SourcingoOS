// Money owed by buyers: invoices, credit notes and the cheques that pay them.
// Pure sums only, so the same numbers show on every screen.

export type ChequeStatus = "in_hand" | "deposited" | "cleared" | "bounced" | "cancelled" | "paid_other";
export const CHEQUE_LABEL: Record<ChequeStatus, string> = {
  in_hand: "In hand", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Cancelled", paid_other: "Paid another way",
};
export const CHEQUE_TONE: Record<ChequeStatus, string> = { in_hand: "info", deposited: "warn", cleared: "ok", bounced: "bad", cancelled: "", paid_other: "ok" };
// Statuses in which a cheque still pays its invoices.
export const LIVE: ChequeStatus[] = ["in_hand", "deposited", "cleared"];
// The next steps Accounts can take. The owner may correct anything.
export const NEXT_STEPS: Record<ChequeStatus, ChequeStatus[]> = {
  in_hand: ["deposited", "cleared", "paid_other", "cancelled"],
  deposited: ["cleared", "bounced", "paid_other", "in_hand"],
  cleared: [],
  bounced: [],
  cancelled: [],
  paid_other: [],
};
// Banks honour a cheque for three months from its date.
export const CHEQUE_VALID_DAYS = 90;
// A cheque rounded to the rupee still settles its invoice.
export const SLACK = 1;
// After a bounce, the legal notice must reach the buyer within 30 days of the bank's return memo (NI Act s.138).
export const NOTICE_DAYS = 30;

export type Invoice = {
  id: string; invoice_no: string; buyer_id: string; invoice_date: string; amount: number; due_date: string | null;
  order_id: string | null; notes: string | null; cancelled_at: string | null;
};
export type CreditNote = { id: string; credit_note_no: string; invoice_id: string; note_date: string; amount: number; notes: string | null; cancelled_at: string | null };
export type Allocation = { id: string; cheque_id: string; invoice_id: string; amount: number };
export type Cheque = {
  id: string; buyer_id: string; cheque_no: string; bank: string | null; cheque_date: string; amount: number; status: ChequeStatus;
  received_on: string | null; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; notes: string | null;
  paid_other_on?: string | null; notice_sent_on?: string | null;
};
export type PayBuyer = { id: string; code: string; realName: string | null; credit_days: number | null; ledger?: string | null };
// A receipt read from Tally (never written there). bills are the invoices it is set against.
export type TallyReceipt = { party: string | null; vdate: string; number: string | null; narration: string | null; amount: number | null; bills: { name: string; amount: number }[] };
export type ReceiptLine = { date: string; number: string | null; amount: number };

export type InvoiceState = "cancelled" | "paid" | "covered" | "part" | "open";
export const INVOICE_LABEL: Record<InvoiceState, string> = {
  cancelled: "Cancelled", paid: "Paid", covered: "Cheque received", part: "Part covered", open: "No cheque yet",
};

export type InvoiceRow = Invoice & {
  credit: number; net: number; covered: number; received: number; uncovered: number; outstanding: number;
  // What Tally's receipts set against this invoice, for its buyer's ledger.
  tallyPaid: number; tallyReceipts: ReceiptLine[];
  due: string | null; state: InvoiceState; overdue: boolean; cheques: { cheque: Cheque; amount: number }[];
};
export type ChequeRow = Cheque & { allocated: number; invoices: { invoice: Invoice; amount: number }[]; expires: string; stale: boolean };

const n = (v: unknown) => Number(v ?? 0) || 0;
// Money to the paisa, so sums like 74999.9 - 25000.3 don't show (or pre-fill) as 49999.59999999999.
export const paise = (v: number) => Math.round(v * 100) / 100;
export const addDays = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type Books = ReturnType<typeof makeBooks>;
export function makeBooks(raw: { invoices: Invoice[]; creditNotes: CreditNote[]; cheques: Cheque[]; allocations: Allocation[]; buyers: PayBuyer[]; today: string; receipts?: TallyReceipt[] }) {
  const t = raw.today;
  const buyerById = new Map(raw.buyers.map((b) => [b.id, b]));
  const chequeById = new Map(raw.cheques.map((c) => [c.id, c]));
  const invoiceById = new Map(raw.invoices.map((i) => [i.id, i]));
  const creditNotes = raw.creditNotes.filter((c) => !c.cancelled_at);
  // Tally receipts by ledger and bill, so an invoice paid by NEFT or RTGS shows as paid.
  const billKey = (party: string, bill: string) => `${party}\u0000${bill.trim().toLowerCase()}`;
  const byBill = new Map<string, ReceiptLine[]>();
  for (const r of raw.receipts ?? []) {
    if (!r.party) continue;
    for (const x of r.bills ?? []) {
      if (!x?.name || !n(x.amount)) continue;
      const k = billKey(r.party, x.name);
      byBill.set(k, [...(byBill.get(k) ?? []), { date: r.vdate, number: r.number, amount: n(x.amount) }]);
    }
  }

  const dueOf = (i: Invoice) => {
    if (i.due_date) return i.due_date;
    const d = buyerById.get(i.buyer_id)?.credit_days;
    return d == null ? null : addDays(i.invoice_date, d);
  };

  const invoices: InvoiceRow[] = raw.invoices.map((i) => {
    const credit = paise(creditNotes.filter((c) => c.invoice_id === i.id).reduce((a, c) => a + n(c.amount), 0));
    const net = paise(n(i.amount) - credit);
    const cheques = raw.allocations
      .filter((a) => a.invoice_id === i.id)
      .map((a) => ({ cheque: chequeById.get(a.cheque_id)!, amount: n(a.amount) }))
      .filter((x) => x.cheque)
      .sort((a, z) => a.cheque.cheque_date.localeCompare(z.cheque.cheque_date));
    // An expired cheque still in hand can't be banked, so it no longer pays the invoice.
    const live = cheques.filter((x) => LIVE.includes(x.cheque.status) && !(x.cheque.status === "in_hand" && addDays(x.cheque.cheque_date, CHEQUE_VALID_DAYS) < t));
    const covered = paise(live.reduce((a, x) => a + x.amount, 0));
    const ledger = buyerById.get(i.buyer_id)?.ledger;
    const tallyReceipts = (ledger ? byBill.get(billKey(ledger, i.invoice_no)) ?? [] : []).sort((a, z) => a.date.localeCompare(z.date));
    const tallyPaid = paise(tallyReceipts.reduce((a, r) => a + r.amount, 0));
    // A cleared cheque is in Tally as a receipt too, so take the larger, not the sum.
    const received = Math.max(paise(live.filter((x) => x.cheque.status === "cleared").reduce((a, x) => a + x.amount, 0)), tallyPaid);
    const cancelled = !!i.cancelled_at;
    const uncovered = cancelled ? 0 : Math.max(0, paise(net - Math.max(covered, received)));
    const outstanding = cancelled ? 0 : Math.max(0, paise(net - received));
    const state: InvoiceState = cancelled ? "cancelled" : outstanding <= SLACK ? "paid" : uncovered <= SLACK ? "covered" : covered > 0 || received > 0 ? "part" : "open";
    const due = dueOf(i);
    return {
      ...i, credit, net, covered, received, tallyPaid, tallyReceipts, cheques, due, state,
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
    return { ...c, allocated: paise(invs.reduce((a, x) => a + x.amount, 0)), invoices: invs, expires, stale: c.status === "in_hand" && expires < t };
  });

  // An in-hand cheque can go to the bank on or after its date.
  const toDeposit = cheques.filter((c) => c.status === "in_hand" && c.cheque_date <= t && !c.stale);
  const awaitingClear = cheques.filter((c) => c.status === "deposited");

  // allCreditNotes keeps the cancelled ones too, so the Tally check can say "cancelled in Payments".
  return { ...raw, allCreditNotes: raw.creditNotes, creditNotes, buyerById, chequeById, invoiceRowById, invoices, cheques, toDeposit, awaitingClear };
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
  for (const c of b.cheques) if ((c.status === "in_hand" && !c.stale) || c.status === "deposited") row(c.buyer_id).held += n(c.amount);
  return [...m.values()].sort((a, z) => z.outstanding - a.outstanding);
}

export type Todo = { sev: "bad" | "warn" | "info"; title: string; detail: string; href: string; key: string };

// The day's payment jobs, most urgent first.
export function paymentTodos(b: Books, buyer: (id: string) => string, money: (v: number) => string, day: (d: string) => string, advice?: Map<string, Advice>): Todo[] {
  const t = b.today;
  const out: Todo[] = [];
  for (const c of b.cheques) {
    const who = `${buyer(c.buyer_id)} · ${money(c.amount)}`;
    if (c.status === "bounced" && c.invoices.some((x) => (b.invoiceRowById.get(x.invoice.id)?.uncovered ?? 0) > 0)) {
      const k = noticeClock(c, t);
      const detail = !k ? `${who}. Ask the buyer for a new cheque.`
        : k.stage === "notice" ? (k.left < 0 ? `${who}. The 30 days for a legal notice ended on ${day(k.by)}. Talk to your lawyer and ask the buyer for payment.`
          : `${who}. Send the buyer a legal notice by ${day(k.by)} (${k.left} ${k.left === 1 ? "day" : "days"} left) to keep the right to a cheque-bounce case, and ask for payment.`)
        : `${who}. Notice sent ${day(c.notice_sent_on!)}. If not paid by ${day(k.payBy)}, the case must be filed by ${day(k.fileBy)}.`;
      const sev = !k || k.stage === "notice" || k.left <= 15 ? "bad" : "warn";
      out.push({ sev, title: k?.stage === "notice" && k.left >= 0 ? `Cheque ${c.cheque_no} bounced: notice due ${day(k.by)}` : `Cheque ${c.cheque_no} bounced`, detail, href: `/payments/cheques/${c.id}`, key: c.bounced_on ?? "" });
    } else if (c.status === "in_hand" && c.stale) {
      out.push({ sev: "bad", title: `Cheque ${c.cheque_no} has expired`, detail: `${who}, dated ${day(c.cheque_date)}. Banks stop honouring a cheque after 3 months. Ask for a fresh one.`, href: `/payments/cheques/${c.id}`, key: c.expires });
    } else if (c.status === "in_hand" && c.cheque_date <= t) {
      const left = daysBetween(t, c.expires);
      out.push({ sev: left <= 10 ? "bad" : "warn", title: `Deposit cheque ${c.cheque_no}`, detail: `${who}, dated ${day(c.cheque_date)}${left <= 10 ? `. Expires in ${left} days` : ""}`, href: `/payments/cheques/${c.id}`, key: c.cheque_date });
    }
  }
  // Cheques Tally already shows settled can be marked in one go.
  const settled = b.cheques.filter((c) => { const a = advice?.get(c.id); return a?.kind === "cleared" || a?.kind === "paid_other"; });
  if (settled.length) {
    out.push({
      sev: "warn", title: `Tally shows ${settled.length} ${settled.length === 1 ? "cheque" : "cheques"} settled`,
      detail: `${money(settled.reduce((a, c) => a + n(c.amount), 0))}. Check the list and mark them in one tap.`, href: "/payments#tally-settle", key: "0",
    });
  }
  // Clearing takes a few days. Past that, someone should check the bank statement.
  const unconfirmed = b.awaitingClear.filter((c) => !settled.includes(c) && (!c.deposited_on || c.deposited_on <= addDays(t, -3)));
  if (unconfirmed.length) {
    out.push({
      sev: "warn", title: `Check ${unconfirmed.length} deposited ${unconfirmed.length === 1 ? "cheque" : "cheques"} against the bank statement`,
      detail: `${money(unconfirmed.reduce((a, c) => a + n(c.amount), 0))} deposited 3 or more days ago.${advice ? " Tally doesn't show them paid yet." : ""} Mark each cleared or bounced.`,
      href: "/payments?tab=cheques&status=deposited", key: "0",
    });
  }
  for (const i of b.invoices) {
    if (i.uncovered > 0 && i.overdue) {
      out.push({ sev: "bad", title: `Overdue: invoice ${i.invoice_no}`, detail: `${buyer(i.buyer_id)} · due ${day(i.due!)} · ${money(i.uncovered)} has no cheque`, href: `/payments/invoices/${i.id}`, key: i.due ?? "" });
    }
  }
  const noTerms = new Set(b.invoices.filter((i) => !i.due && (i.state === "open" || i.state === "part")).map((i) => i.buyer_id));
  for (const id of noTerms) {
    out.push({ sev: "info", title: `Set credit days for ${buyer(id)}`, detail: "So the app knows when its invoices fall due.", href: "/payments?tab=buyers", key: "9" });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, z) => rank[a.sev] - rank[z.sev] || a.key.localeCompare(z.key));
}

// What Tally shows about each cheque still in hand or deposited, so Accounts can settle them in one go.
//   cleared: a receipt for the buyer names the cheque number and is for its amount.
//   paid_other: no receipt names it, but Tally shows every invoice it pays as fully paid (usually by NEFT or RTGS).
//   part: Tally shows some of its invoices paid. none: Tally shows nothing paid yet.
export type Advice =
  | { kind: "cleared"; on: string; receipt: string }
  | { kind: "paid_other"; on: string; receipts: ReceiptLine[] }
  | { kind: "part"; paid: number; left: number }
  | { kind: "none" };
const digits = (s: string | null | undefined) => (String(s ?? "").match(/\d+/g) ?? []).map((d) => d.replace(/^0+/, "")).filter(Boolean);

export function tallyAdvice(b: Books, receipts: TallyReceipt[]): Map<string, Advice> {
  const out = new Map<string, Advice>();
  const used = new Set<TallyReceipt>();
  for (const c of b.cheques) {
    if (c.status !== "in_hand" && c.status !== "deposited") continue;
    const ledger = b.buyerById.get(c.buyer_id)?.ledger;
    const no = c.cheque_no.replace(/\D/g, "").replace(/^0+/, "");
    const hit = ledger && no ? receipts.find((r) => !used.has(r) && r.party === ledger && Math.abs(n(r.amount) - n(c.amount)) <= SLACK
      && (digits(r.number).includes(no) || digits(r.narration).includes(no))) : undefined;
    if (hit) {
      used.add(hit);
      out.set(c.id, { kind: "cleared", on: hit.vdate, receipt: hit.number ?? "" });
      continue;
    }
    const rows = c.invoices.map((x) => b.invoiceRowById.get(x.invoice.id)).filter((x): x is InvoiceRow => !!x && x.state !== "cancelled");
    if (!rows.length) { out.set(c.id, { kind: "none" }); continue; }
    const paid = paise(rows.reduce((a, i) => a + Math.min(i.tallyPaid, i.net), 0));
    const net = paise(rows.reduce((a, i) => a + i.net, 0));
    if (rows.every((i) => i.tallyPaid >= i.net - SLACK)) {
      const all = rows.flatMap((i) => i.tallyReceipts).sort((a, z) => a.date.localeCompare(z.date));
      out.set(c.id, { kind: "paid_other", on: all[all.length - 1]?.date ?? b.today, receipts: all });
    } else out.set(c.id, paid > SLACK ? { kind: "part", paid, left: paise(net - paid) } : { kind: "none" });
  }
  return out;
}

// What each buyer still owes, by how late it is. "Not due" includes invoices with no due date yet.
export const AGE_BUCKETS = [
  { key: "notDue", label: "Not due" }, { key: "d30", label: "1-30 days" }, { key: "d60", label: "31-60 days" },
  { key: "d90", label: "61-90 days" }, { key: "d90plus", label: "Over 90 days" },
] as const;
export type AgeKey = (typeof AGE_BUCKETS)[number]["key"];
export function ageing(b: Books) {
  const rows = new Map<string, Record<AgeKey, number> & { buyer_id: string; total: number; oldest: number }>();
  for (const i of b.invoices) {
    if (i.outstanding <= 0 || i.state === "cancelled") continue;
    let r = rows.get(i.buyer_id);
    if (!r) rows.set(i.buyer_id, (r = { buyer_id: i.buyer_id, total: 0, oldest: 0, notDue: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }));
    const late = i.due ? daysBetween(i.due, b.today) : 0;
    const k: AgeKey = late <= 0 ? "notDue" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "d90plus";
    r[k] = paise(r[k] + i.outstanding);
    r.total = paise(r.total + i.outstanding);
    r.oldest = Math.max(r.oldest, late);
  }
  return [...rows.values()].sort((a, z) => z.d90plus + z.d90 - (a.d90plus + a.d90) || z.total - a.total);
}

// The bounced-cheque clock: notice within 30 days of the bounce, then 15 days for the buyer to pay, then a month to file.
export function noticeClock(c: Cheque, today: string) {
  if (c.status !== "bounced" || !c.bounced_on) return null;
  if (!c.notice_sent_on) {
    const by = addDays(c.bounced_on, NOTICE_DAYS);
    return { stage: "notice" as const, by, left: daysBetween(today, by) };
  }
  const payBy = addDays(c.notice_sent_on, 15);
  const fileBy = addDays(payBy, 30);
  return { stage: "sent" as const, payBy, fileBy, left: daysBetween(today, fileBy) };
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
