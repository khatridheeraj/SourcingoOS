"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The buyer approves a sample or asks for changes, with photos already uploaded. An approval marks the step done.
export async function answerSample(id: string, approved: boolean, note: string, photos: string[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  if (!approved && !note.trim()) return { error: "Say what to change, so the factory can fix it." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_sample", { p_id: id, p_approved: approved, p_note: note.slice(0, 1000), p_photos: photos });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

// The buyer writes to Sourcingo about one of its open POs. The order's merchandiser sees it on Home until answered.
export async function sendBuyerMessage(orderId: string, body: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const text = body.trim();
  if (!text) return { error: "Write your message first." };
  if (text.length > 2000) return { error: "Keep the message under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_buyer_message", { p_order: orderId, p_body: text });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}
