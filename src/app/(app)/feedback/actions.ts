"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["new", "planned", "done", "wontfix"];

export async function answerFeedback(id: number, status: string, reply: string): Promise<{ ok?: string; error?: string }> {
  if ((await getMe())?.role !== "owner") return { error: "Only the owner answers feedback." };
  if (!STATUSES.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.from("feedback").update({ status, reply: reply.trim() || null }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Saved. They'll see your answer." };
}
