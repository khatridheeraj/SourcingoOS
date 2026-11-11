"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type VisitInput = { factoryId: string; visitedOn: string; gstOk: boolean; udyam: string; certs: { name: string; until: string }[]; note: string };

// The roles that visit factories and may vouch for one.
const VERIFIERS = ["owner", "manager", "merchandiser", "quality"];

export async function verifyFactory(v: VisitInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can verify a factory." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.visitedOn)) return { error: "Pick the day of the visit." };
  const certs = v.certs.map((c) => ({ name: c.name.trim(), until: c.until || null })).filter((c) => c.name || c.until);
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_factory", {
    p_factory: v.factoryId, p_visited_on: v.visitedOn, p_gst_ok: v.gstOk, p_udyam: v.udyam.trim() || null,
    p_certs: certs, p_note: v.note.trim().slice(0, 300) || null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${v.factoryId}`);
  revalidatePath("/factories");
  return {};
}

export async function takeBackVisit(factoryId: string, id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !VERIFIERS.includes(me.role)) return { error: "Only the owner, a manager, a merchandiser or Quality can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_factory_verification", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/factories/${factoryId}`);
  return {};
}
