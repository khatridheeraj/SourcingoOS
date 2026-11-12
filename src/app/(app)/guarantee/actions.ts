"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ClaimInput } from "@/components/claim-form";

const done = () => { revalidatePath("/guarantee"); revalidatePath("/buyer"); revalidatePath("/factory"); };

// The owner sets the deposit share and how soon factories are paid, and turns the Guarantee on for buyers and factories.
export async function setGuarantee(live: boolean, depositPct: number, payDays: number): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can change the Guarantee." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_guarantee", { p_live: live, p_deposit_pct: Math.round(depositPct), p_pay_days: Math.round(payDays) });
  if (error) return { error: friendly(error) };
  done();
  return {};
}

export type PaymentInput = { orderId: string; kind: "deposit" | "balance" | "factory"; factoryId: string | null; amount: number; paidOn: string; note: string };

export async function recordPayment(p: PaymentInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" && me?.role !== "accounts") return { error: "Only Accounts and the owner record Guarantee payments." };
  if (!(p.amount > 0)) return { error: "Write the amount paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) return { error: "Pick the day it was paid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_guarantee_payment", {
    p_order: p.orderId, p_kind: p.kind, p_factory: p.factoryId, p_amount: Math.round(p.amount * 100) / 100, p_paid_on: p.paidOn, p_note: p.note.trim().slice(0, 200) || null,
  });
  if (error) return { error: friendly(error) };
  done();
  return {};
}

export async function takeBackPayment(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" && me?.role !== "accounts") return { error: "Only Accounts and the owner can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_guarantee_payment", { p_id: id });
  if (error) return { error: friendly(error) };
  done();
  return {};
}

// The team raises a claim for a buyer who rang or emailed.
export async function raiseClaimForBuyer(c: ClaimInput): Promise<{ error?: string; no?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can raise a claim for a buyer." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("raise_buyer_claim", {
    p_line: c.lineId, p_reason: c.reason, p_pieces: c.pieces, p_ask: c.ask, p_detail: c.detail.trim().slice(0, 800), p_photos: c.photos,
  });
  if (error) return { error: friendly(error) };
  done();
  return { no: data as string };
}

export type DecideInput = { id: string; decision: "remake" | "refund" | "declined"; amount: number | null; answer: string; passOn: boolean };

export async function decideClaim(d: DecideInput): Promise<{ error?: string; factoryClaim?: string | null }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team and Accounts decide claims." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_buyer_claim", {
    p_id: d.id, p_decision: d.decision, p_amount: d.decision === "refund" ? d.amount : null, p_answer: d.answer.trim().slice(0, 500) || null,
    p_pass_on: d.decision !== "declined" && d.passOn,
  });
  if (error) return { error: friendly(error) };
  done();
  revalidatePath("/payables");
  return { factoryClaim: (data as string | null) ?? null };
}
