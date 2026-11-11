"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { canEditOrders } from "@/lib/auth-roles";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The orders team agrees to a factory's new date for a step (the factory's date moves; the target stays), or says no.
export async function answerFactoryDate(orderId: string, askId: string, agree: boolean, answer: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can answer the factory." };
  const text = answer.trim();
  if (text.length > 300) return { error: "Keep the answer under 300 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_factory_date", { p_id: askId, p_agree: agree, p_answer: text || null });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}

// The orders team saw a factory's goods-ready notice, with a word back if it wants ("Final QC on 14 Nov").
export async function goodsReadySeen(orderId: string, id: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can do that." };
  const text = note.trim();
  if (text.length > 300) return { error: "Keep the note under 300 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("factory_ready_seen", { p_id: id, p_note: text || null });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}
