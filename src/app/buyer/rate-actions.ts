"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The buyer rates an order whose goods have left: 1 to 5 stars and a comment, private to Sourcingo.
export async function rateOrder(orderId: string, score: number, comment: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "Only the buyer can rate an order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("rate_order", { p_order: orderId, p_score: score, p_comment: comment.trim().slice(0, 600) || null });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}
