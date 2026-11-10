"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isPartner } from "@/lib/auth-roles";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// Sourcingo answers the buyer on an order. Answering deals with every buyer message still open there.
export async function answerBuyer(orderId: string, body: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || isPartner(me.role)) return { error: "Only the team can answer the buyer." };
  const text = body.trim();
  if (!text) return { error: "Write the answer first." };
  if (text.length > 2000) return { error: "Keep the answer under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_buyer", { p_order: orderId, p_body: text });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}

// The buyer's open messages on an order need no answer (sorted on a call, say): they leave Home.
export async function buyerMessagesDone(orderId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || isPartner(me.role)) return { error: "Only the team can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("buyer_messages_done", { p_order: orderId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}
