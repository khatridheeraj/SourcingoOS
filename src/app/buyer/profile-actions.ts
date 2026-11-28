"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { profileProblem, type BuyerProfile, type DocKind } from "@/lib/buyer-profile";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The buyer fills in its own company details and uploads its papers from its page. Our terms are never sent.
export async function buyerSaveProfile(p: Record<string, unknown>): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const bad = profileProblem({ gstin: typeof p.gstin === "string" ? p.gstin : "", pan: typeof p.pan === "string" ? p.pan : "",
    contacts: Array.isArray(p.contacts) ? (p.contacts as BuyerProfile["contacts"]) : [] });
  if (bad) return { error: bad };
  const supabase = await createClient();
  const { error } = await supabase.rpc("buyer_save_profile", { p });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

export async function buyerAddDoc(kind: DocKind, path: string, name: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("buyer_add_document", { p_kind: kind, p_path: path, p_name: name });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}

export async function buyerRemoveDoc(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "buyer") return { error: "This login is not set up for a buyer." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_buyer_document", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath("/buyer");
  return {};
}
