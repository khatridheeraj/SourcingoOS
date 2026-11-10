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
  // The Udyam box only shows for micro, small or medium: a number left in it after choosing "Not registered" or
  // "Not known yet" is dropped, not refused with a message about a box that is no longer on screen.
  const u = msme && msme !== "none" ? udyamText(udyam) : "";
  const r = await call("save_supplier_terms", { p_ledger: ledger, p_days: d ? Number(d) : null, p_msme: msme || null, p_udyam: u || null });
  return r.error ? r : { ok: "Terms saved. Due dates are updated." };
}

// "UDYAM RJ 17 0012345", "udyam/rj/17/0012345" or "UDYAM-RJ-17-0012345": the certificate's number however it was
// typed or pasted, written the one way the database checks. Anything else is passed on for the database to refuse.
function udyamText(s: string): string {
  const t = s.trim().toUpperCase();
  const m = t.replace(/[^A-Z0-9]/g, "").match(/^UDYAM([A-Z]{2})(\d{2})(\d{7})$/);
  return m ? `UDYAM-${m[1]}-${m[2]}-${m[3]}` : t;
}

export async function saveBillNote(ledger: string, bill: string, hold: boolean, note: string): Promise<Result> {
  const r = await call("save_bill_note", { p_ledger: ledger, p_bill: bill, p_hold: hold, p_note: note });
  return r.error ? r : { ok: hold ? `Bill ${bill} is on hold` : note.trim() ? `Note saved on ${bill}` : `Bill ${bill} released` };
}

export type ClaimInput = { ledger: string; bill: string | null; orderId: string | null; date: string; reason: string; pieces: string; amount: string; note: string };

// Raises a factory claim (a debit note to send the factory). The amount is what was typed, or pieces times the rate.
export async function raiseClaim(c: ClaimInput): Promise<Result> {
  const pieces = c.pieces.trim();
  if (pieces && !/^\d{1,8}$/.test(pieces)) return { error: "Pieces must be a whole number." };
  const amount = Number(c.amount.replace(/[^\d.]/g, ""));
  if (!c.amount.trim() || !Number.isFinite(amount) || amount <= 0) return { error: "Write the amount to claim." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return { error: "Pick the claim date." };
  if (!isFinance((await getMe())?.role)) return { error: "Only Accounts and the owner can raise factory claims." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_factory_claim", {
    p_ledger: c.ledger, p_bill: c.bill, p_order: c.orderId, p_date: c.date, p_reason: c.reason,
    p_pieces: pieces ? Number(pieces) : null, p_amount: Math.round(amount * 100) / 100, p_note: c.note,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/payables");
  revalidatePath("/today");
  return { ok: String(data) };
}

export async function cancelClaim(id: string, reason: string): Promise<Result> {
  const r = await call("cancel_factory_claim", { p_id: id, p_reason: reason });
  return r.error ? r : { ok: "Claim cancelled." };
}
