"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { ChequeStatus } from "@/lib/payments";
import { isFinance } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

type Result = { ok?: string; error?: string; id?: string };
const NOT_ALLOWED = "Only Accounts and the owner can change payments.";

async function call(fn: string, args: Record<string, unknown>) {
  if (!isFinance((await getMe())?.role)) return { error: NOT_ALLOWED, data: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message, data: null };
  revalidatePath("/", "layout");
  return { data, error: undefined };
}

export type InvoiceInput = {
  id: string | null; invoice_no: string; buyer_id: string; invoice_date: string; amount: string; due_date: string; so_id: string; notes: string;
};
export async function saveInvoice(input: InvoiceInput): Promise<Result> {
  const r = await call("save_invoice", { p: input });
  if (r.error) return { error: r.error };
  return { id: r.data as string, ok: `Invoice ${input.invoice_no.trim()} saved` };
}

export async function deleteInvoice(id: string): Promise<Result> {
  const r = await call("delete_invoice", { p_id: id });
  return r.error ? { error: r.error } : { ok: "Invoice deleted" };
}

export type CreditNoteInput = { id: string | null; credit_note_no: string; invoice_id: string; note_date: string; amount: string; notes: string };
export async function saveCreditNote(input: CreditNoteInput): Promise<Result> {
  const r = await call("save_credit_note", { p: input });
  return r.error ? { error: r.error } : { id: r.data as string, ok: `Credit note ${input.credit_note_no.trim()} saved` };
}

export async function deleteCreditNote(id: string): Promise<Result> {
  const r = await call("delete_credit_note", { p_id: id });
  return r.error ? { error: r.error } : { ok: "Credit note deleted" };
}

export type ChequeInput = {
  id: string | null; buyer_id: string; cheque_no: string; bank: string; cheque_date: string; amount: string; received_on: string; notes: string;
  allocations: { invoice_id: string; amount: string }[];
};
export async function saveCheque(input: ChequeInput): Promise<Result> {
  const r = await call("save_cheque", { p: input });
  return r.error ? { error: r.error } : { id: r.data as string, ok: `Cheque ${input.cheque_no.trim()} saved` };
}

export async function deleteCheque(id: string): Promise<Result> {
  const r = await call("delete_cheque", { p_id: id });
  return r.error ? { error: r.error } : { ok: "Cheque deleted" };
}

const DONE: Record<ChequeStatus, string> = {
  in_hand: "back in hand", deposited: "deposited", cleared: "cleared", bounced: "bounced", cancelled: "cancelled",
};
export async function setChequeStatus(ids: string[], status: ChequeStatus, on: string, note: string): Promise<Result> {
  if (!ids.length) return { error: "Choose at least one cheque." };
  const r = await call("set_cheque_status", { p_ids: ids, p_status: status, p_on: on || null, p_note: note || null });
  if (r.error) return { error: r.error };
  const n = r.data as number;
  return { ok: n === 1 ? `1 cheque marked ${DONE[status]}` : `${n} cheques marked ${DONE[status]}` };
}

export async function setCreditDays(buyerId: string, days: string): Promise<Result> {
  const v = days.trim() === "" ? null : Number(days);
  if (v !== null && (!Number.isInteger(v) || v < 0 || v > 365)) return { error: "Credit days must be a whole number from 0 to 365." };
  const r = await call("set_buyer_credit_days", { p_buyer: buyerId, p_days: v });
  return r.error ? { error: r.error } : { ok: v === null ? "Credit days cleared" : `Credit days set to ${v}` };
}
