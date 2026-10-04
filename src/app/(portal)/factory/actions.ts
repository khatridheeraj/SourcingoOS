"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { TnaStatus } from "@/lib/model";
import { createClient } from "@/lib/supabase/server";

const STATUSES: TnaStatus[] = ["pending", "in_progress", "completed", "delayed"];

export async function updateCheckpoint(id: string, status: TnaStatus, note: string): Promise<{ ok?: string; error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "Only factory logins can update this." };
  if (!STATUSES.includes(status)) return { error: "Unknown status." };
  if (status === "delayed" && !note.trim()) return { error: "Say why it is delayed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_checkpoint_status", { p_checkpoint: id, p_status: status, p_note: note.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/factory", "layout");
  return { ok: "Updated. Sourcingo can see it now." };
}
