// Where Tally and the app's Payments differ. Pure sums only, so the page and the
// tests agree. Tally is read, never written: these lists are for people to act on.
import { type Books, SLACK } from "@/lib/payments";

export type TallyLedger = { name: string; parent: string | null; balance: number; gstin: string | null };
export type TallyVoucher = {
  guid: string; vtype: string; kind: string; number: string | null; vdate: string; party: string | null; amount: number | null;
  reference: string | null; bills: { name: string; amount: number }[];
};
export type TallyItem = { name: string; parent: string | null; unit: string | null; qty: number; value: number };
export type Linked = { id: string; ledger: string | null };

export type Missing = { v: TallyVoucher; buyerId: string | null };
export type Differs = { v: TallyVoucher; id: string; appNo: string; appAmount: number; appBuyer: string; tallyBuyer: string | null };

const key = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const n = (v: unknown) => Number(v ?? 0) || 0;

export function compareWithTally(raw: {
  books: Books; vouchers: TallyVoucher[]; ledgers: TallyLedger[]; buyers: Linked[]; factories: Linked[]; from: string | null; to: string | null;
}) {
  const { books: b, vouchers } = raw;
  const buyerByLedger = new Map<string, string>();
  for (const x of raw.buyers) if (x.ledger) buyerByLedger.set(x.ledger, x.id);
  const ledgerOfBuyer = new Map(raw.buyers.map((x) => [x.id, x.ledger]));
  const ledgerByName = new Map(raw.ledgers.map((l) => [l.name, l]));
  const inRange = (d: string) => (!raw.from || d >= raw.from) && (!raw.to || d <= raw.to);
  const buyerOf = (v: TallyVoucher) => (v.party ? buyerByLedger.get(v.party) ?? null : null);

  const sales = vouchers.filter((v) => v.kind === "sales");
  const notes = vouchers.filter((v) => v.kind === "credit_note");
  const invByNo = new Map(b.invoices.map((i) => [key(i.invoice_no), i]));
  const cnByNo = new Map(b.creditNotes.map((c) => [key(c.credit_note_no), c]));
  const tallySalesNos = new Set(sales.map((v) => key(v.number)));
  const tallyNoteNos = new Set(notes.map((v) => key(v.number)));

  const onlyInTally: Missing[] = [];
  const differs: Differs[] = [];
  for (const v of [...sales, ...notes]) {
    const app = v.kind === "sales" ? invByNo.get(key(v.number)) : cnByNo.get(key(v.number));
    if (!v.number || !app) {
      onlyInTally.push({ v, buyerId: buyerOf(v) });
      continue;
    }
    const appBuyer = "buyer_id" in app ? app.buyer_id : b.invoiceRowById.get(app.invoice_id)?.buyer_id ?? "";
    const tallyBuyer = buyerOf(v);
    const cancelled = "cancelled_at" in app && !!app.cancelled_at;
    if (cancelled || Math.abs(n(v.amount) - n(app.amount)) > SLACK || (tallyBuyer && tallyBuyer !== appBuyer)) {
      differs.push({ v, id: "invoice_no" in app ? app.id : app.invoice_id, appNo: "invoice_no" in app ? app.invoice_no : app.credit_note_no,
                     appAmount: cancelled ? 0 : n(app.amount), appBuyer, tallyBuyer });
    }
  }
  // Only what Tally was read for can be missing from it.
  const onlyInApp = [
    ...b.invoices.filter((i) => !i.cancelled_at && inRange(i.invoice_date) && !tallySalesNos.has(key(i.invoice_no)))
      .map((i) => ({ kind: "invoice" as const, id: i.id, no: i.invoice_no, date: i.invoice_date, amount: n(i.amount), buyerId: i.buyer_id })),
    ...b.creditNotes.filter((c) => inRange(c.note_date) && !tallyNoteNos.has(key(c.credit_note_no)))
      .map((c) => ({ kind: "credit_note" as const, id: c.invoice_id, no: c.credit_note_no, date: c.note_date, amount: n(c.amount),
                     buyerId: b.invoiceRowById.get(c.invoice_id)?.buyer_id ?? "" })),
  ].sort((a, z) => a.date.localeCompare(z.date));

  // A cleared cheque should be a receipt in Tally for the same buyer and amount.
  // Each pairs with at most one receipt, nearest date first.
  const receipts = vouchers.filter((v) => v.kind === "receipt" && buyerOf(v));
  const cleared = b.cheques.filter((c) => c.status === "cleared");
  const used = new Set<string>();
  const receiptsNoCheque: Missing[] = [];
  const dist = (a: string, z: string) => Math.abs(Date.parse(a) - Date.parse(z));
  for (const v of [...receipts].sort((a, z) => a.vdate.localeCompare(z.vdate))) {
    const match = cleared
      .filter((c) => !used.has(c.id) && c.buyer_id === buyerOf(v) && Math.abs(n(c.amount) - n(v.amount)) <= SLACK)
      .sort((a, z) => dist(a.cleared_on ?? a.cheque_date, v.vdate) - dist(z.cleared_on ?? z.cheque_date, v.vdate))[0];
    if (match) used.add(match.id);
    else receiptsNoCheque.push({ v, buyerId: buyerOf(v) });
  }
  const chequesNoReceipt = cleared.filter((c) => !used.has(c.id) && inRange(c.cleared_on ?? c.cheque_date));

  // Parties on sales, credit notes and receipts that aren't linked to a buyer.
  const unlinked = [...new Set(vouchers.filter((v) => ["sales", "credit_note", "receipt"].includes(v.kind) && v.party && !buyerByLedger.has(v.party))
    .map((v) => v.party!))].sort();

  // What each buyer owes: Tally's ledger balance beside the app's unpaid invoices.
  const owed = new Map<string, number>();
  for (const i of b.invoices) owed.set(i.buyer_id, (owed.get(i.buyer_id) ?? 0) + i.outstanding);
  const balances = [...b.buyerById.values()].map((x) => {
    const ledger = ledgerOfBuyer.get(x.id) ?? null;
    const l = ledger ? ledgerByName.get(ledger) : undefined;
    const app = owed.get(x.id) ?? 0;
    return { buyerId: x.id, ledger, found: !!l, tally: l ? n(l.balance) : null, app, diff: l ? n(l.balance) - app : null };
  }).sort((a, z) => Math.abs(z.diff ?? 0) - Math.abs(a.diff ?? 0));

  const factories = raw.factories.map((f) => {
    const l = f.ledger ? ledgerByName.get(f.ledger) : undefined;
    // A credit balance is what we owe the factory.
    return { factoryId: f.id, ledger: f.ledger, found: !!l, weOwe: l ? -n(l.balance) : null };
  });

  return { onlyInTally, differs, onlyInApp, receiptsNoCheque, chequesNoReceipt, unlinked, balances, factories };
}
