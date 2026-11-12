"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function team() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can do that." } as const;
  return { supabase: await createClient() } as const;
}

// Open a style to factories: they see it in Shop orders and quote until quotes close.
export async function openStyle(lineId: string, target: string, readyBy: string, closesOn: string, note: string): Promise<{ error?: string; id?: string }> {
  const t = await team();
  if ("error" in t) return t;
  const rate = target.trim() ? Number(target.replace(/,/g, "")) : null;
  if (rate != null && !(rate > 0)) return { error: "Fill the target price as an amount, or leave it empty." };
  if (!DATE.test(readyBy) || !DATE.test(closesOn)) return { error: "Pick the dates." };
  const { data, error } = await t.supabase.rpc("market_open", { p_line: lineId, p_target: rate, p_ready_by: readyBy, p_closes_on: closesOn, p_note: note.trim().slice(0, 500) });
  if (error) return { error: friendly(error) };
  revalidatePath("/factories/market");
  return { id: data as string };
}

// Give the style to this quote's factory at its price. The style then follows the usual factory PO flow.
export async function awardQuote(listingId: string, quoteId: string): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return t;
  const { error } = await t.supabase.rpc("market_award", { p_quote: quoteId });
  if (error) return { error: friendly(error) };
  revalidatePath("/factories/market");
  revalidatePath(`/factories/market/${listingId}`);
  revalidatePath("/today");
  return {};
}

// Take a style back from factories without choosing anyone.
export async function closeListing(listingId: string): Promise<{ error?: string }> {
  const t = await team();
  if ("error" in t) return t;
  const { error } = await t.supabase.rpc("market_close", { p_listing: listingId });
  if (error) return { error: friendly(error) };
  revalidatePath("/factories/market");
  revalidatePath("/today");
  return {};
}
