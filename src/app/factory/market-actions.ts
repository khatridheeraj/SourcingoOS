"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// A factory quotes on a style open to factories, or changes its quote.
export async function sendQuote(listingId: string, rate: number, readyOn: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  if (!(rate > 0) || rate >= 1_000_000) return { error: "Fill your price." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readyOn)) return { error: "Pick the day your goods will be ready." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("market_quote", { p_listing: listingId, p_rate: Math.round(rate * 100) / 100, p_ready_on: readyOn, p_note: note.slice(0, 500) });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory/market");
  return {};
}

// A factory takes its quote back while the style is still open.
export async function withdrawQuote(listingId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("market_withdraw", { p_listing: listingId });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory/market");
  return {};
}
