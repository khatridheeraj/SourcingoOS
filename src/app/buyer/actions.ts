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
