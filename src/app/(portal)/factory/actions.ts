"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { DELAY_REASONS, type TnaStatus } from "@/lib/model";
import { createClient } from "@/lib/supabase/server";

const STATUSES: TnaStatus[] = ["pending", "in_progress", "completed", "delayed"];
const NOT_FACTORY = { error: "Only factory logins can update this." };

export async function markSampleReady(id: string, note: string): Promise<{ ok?: string; error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return NOT_FACTORY;
  const supabase = await createClient();
  const { error } = await supabase.rpc("factory_sample_ready", { p_sample: id, p_note: note.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/factory", "layout");
  return { ok: me.language === "hi" ? "तैयार बता दिया। Sourcingo को दिख रहा है।" : "Marked ready. Sourcingo can see it now." };
}

export async function updateCheckpoint(id: string, status: TnaStatus, note: string, reason = ""): Promise<{ ok?: string; error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return NOT_FACTORY;
  if (!STATUSES.includes(status)) return { error: "Unknown status." };
  const hi = me.language === "hi";
  if (status === "delayed" && !DELAY_REASONS.some((r) => r.value === reason)) return { error: hi ? "देरी का कारण चुनें।" : "Pick why it is delayed." };
  if (status === "delayed" && reason === "other" && !note.trim()) return { error: hi ? "देरी का कारण लिखें।" : "Say why it is delayed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_checkpoint", { p_checkpoint: id, p_status: status, p_note: note.trim() || null, p_reason: status === "delayed" ? reason : null });
  if (error) return { error: error.message };
  revalidatePath("/factory", "layout");
  return { ok: hi ? "अपडेट हो गया। Sourcingo को दिख रहा है।" : "Updated. Sourcingo can see it now." };
}

export async function answerPo(id: string, accept: boolean, note: string): Promise<{ ok?: string; error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return NOT_FACTORY;
  const hi = me.language === "hi";
  if (!accept && !note.trim()) return { error: hi ? "कारण लिखें, ताकि Sourcingo बात कर सके।" : "Say why, so Sourcingo can sort it out." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_factory_po", { p_id: id, p_accept: accept, p_note: note.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/factory", "layout");
  return { ok: accept ? (hi ? "PO मंज़ूर हुआ। Sourcingo को दिख गया।" : "PO accepted. Sourcingo can see it now.") : (hi ? "Sourcingo को बता दिया। वे आपसे बात करेंगे।" : "Sourcingo has been told. They'll call you.") };
}
