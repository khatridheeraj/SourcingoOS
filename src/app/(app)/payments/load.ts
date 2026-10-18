import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { buyerName, loadBuyers } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { type Allocation, type Cheque, type CreditNote, type Invoice, makeBooks, type TallyReceipt, tallyAdvice } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export const isFinance = (role: string | null | undefined) => role === "owner" || role === "accounts";

// Everything the payment screens need, for the company the signed-in person is working in.
// Sends anyone who isn't the owner or Accounts back to Orders.
export async function loadBooks() {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const [inv, cn, chq, alloc, terms, buyers, ledgers, rcpt] = await Promise.all([
    fetchAll((a, z) => supabase.from("invoices").select("id, invoice_no, buyer_id, invoice_date, amount, due_date, order_id, notes, cancelled_at").eq("company_id", companyId).order("invoice_date").order("created_at").order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("credit_notes").select("id, credit_note_no, invoice_id, note_date, amount, notes, cancelled_at").eq("company_id", companyId).order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("cheques").select("id, buyer_id, cheque_no, bank, cheque_date, amount, status, received_on, deposited_on, cleared_on, bounced_on, notes, paid_other_on, notice_sent_on").eq("company_id", companyId).order("cheque_date").order("created_at").order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("cheque_allocations").select("id, cheque_id, invoice_id, amount").eq("company_id", companyId).is("removed_at", null).order("id").range(a, z)),
    supabase.from("buyers").select("id, credit_days").eq("company_id", companyId),
    loadBuyers(),
    supabase.rpc("buyer_ledgers"),
    // Tally's receipts, read only: an invoice paid by NEFT or RTGS counts as paid, and cheques can be settled from them.
    fetchAll((a, z) => supabase.from("tally_vouchers").select("party, vdate, number, narration, amount, bills").eq("company_id", companyId).is("gone_at", null).eq("kind", "receipt").order("vdate").order("guid").range(a, z)),
  ]);
  const ledgerOf = new Map(((ledgers.data ?? []) as { id: string; tally_ledger: string | null }[]).map((x) => [x.id, x.tally_ledger]));
  const receipts = (rcpt.data ?? []) as TallyReceipt[];
  const days = new Map((terms.data ?? []).map((b) => [b.id as string, b.credit_days as number | null]));
  const error = inv.error ?? cn.error ?? chq.error ?? alloc.error ?? terms.error ?? ledgers.error ?? rcpt.error;
  const books = makeBooks({
    invoices: (inv.data ?? []) as Invoice[],
    creditNotes: (cn.data ?? []) as CreditNote[],
    cheques: (chq.data ?? []) as Cheque[],
    allocations: (alloc.data ?? []) as Allocation[],
    buyers: buyers.map((b) => ({ id: b.id, code: b.code, realName: b.realName, credit_days: days.get(b.id) ?? null, ledger: ledgerOf.get(b.id) ?? null })),
    today: todayIST(),
    receipts,
  });
  const advice = tallyAdvice(books, receipts);
  const owner = me?.role === "owner";
  const buyerLabel = (id: string) => {
    const b = books.buyerById.get(id);
    return b ? buyerName(b) : "";
  };
  return { me: me!, owner, books, buyers, buyerLabel, advice, error };
}
