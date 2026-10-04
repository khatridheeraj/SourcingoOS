"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok?: string; error?: string };

// A problem, idea or question from anyone signed in; the owner reads them in Feedback.
export async function sendFeedback(kind: string, message: string, page: string): Promise<Result> {
  const me = await getMe();
  if (!me?.role) return { error: "Sign in first." };
  if (!["problem", "idea", "question"].includes(kind)) return { error: "Pick what kind of note this is." };
  if (!message.trim()) return { error: "Write a few words first." };
  if (message.length > 2000) return { error: "Keep it under 2000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("feedback").insert({ kind, message: message.trim(), page: page.slice(0, 300) || null, user_id: me.id });
  if (error) return { error: error.message };
  revalidatePath("/feedback");
  return { ok: "Thank you. The owner will see it." };
}

export async function markNotificationsRead(ids: number[] | null): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Marked read." };
}

export async function savePreferences(input: { language?: "en" | "hi"; digest?: boolean; phone?: string }): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_preferences", {
    p_language: input.language ?? null, p_digest: input.digest ?? null, p_phone: input.phone ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: input.language === "hi" ? "भाषा बदल दी गई।" : "Saved." };
}
