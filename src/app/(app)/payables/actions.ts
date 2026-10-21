"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "../payments/load";

type Result = { ok?: string; error?: string };

async function call(fn: string, args: Record<string, unknown>): Promise<{ error?: string }> {
  if (!isFinance((await getMe())?.role)) return { error: "Only Accounts and the owner can change bills to pay." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath("/payables");
  revalidatePath("/today");
  return {};
}

// Payment days, MSME size and Udyam number for one supplier (its ledger in Tally). Blank days means the usual 60.
export async function saveTerms(ledger: string, days: string, msme: string, udyam: string): Promise<Result> {
  const d = days.trim();
  if (d && !/^\d{1,3}$/.test(d)) return { error: "Payment days must be a whole number." };
  const r = await call("save_supplier_terms", { p_ledger: ledger, p_days: d ? Number(d) : null, p_msme: msme || null, p_udyam: udyam.trim() || null });
  return r.error ? r : { ok: "Terms saved. Due dates are updated." };
}

export async function saveBillNote(ledger: string, bill: string, hold: boolean, note: string): Promise<Result> {
  const r = await call("save_bill_note", { p_ledger: ledger, p_bill: bill, p_hold: hold, p_note: note });
  return r.error ? r : { ok: hold ? `Bill ${bill} is on hold` : note.trim() ? `Note saved on ${bill}` : `Bill ${bill} released` };
}
