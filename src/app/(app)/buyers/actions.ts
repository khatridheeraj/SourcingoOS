"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type BuyerInput = { id?: string; code: string; realName: string; city: string; notes: string; active: boolean };

export async function saveBuyer(b: BuyerInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add or change buyers." };
  const code = b.code.trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) return { error: "Use 2 to 20 capital letters, numbers or dashes for the code, like BYR-OZ." };
  if (!b.realName.trim()) return { error: "Enter the buyer's real name. Only you will see it." };

  const supabase = await createClient();
  const row = { code, city: b.city.trim() || null, notes: b.notes.trim() || null, active: b.active };
  const { data, error } = b.id
    ? await supabase.from("buyers").update(row).eq("id", b.id).select("id").single()
    : await supabase.from("buyers").insert(row).select("id").single();
  if (error) return { error: friendly(error) };
  const { error: nameError } = await supabase.from("buyer_names").upsert({ buyer_id: data.id, real_name: b.realName.trim() });
  if (nameError) {
    if (!b.id) await supabase.from("buyers").delete().eq("id", data.id);
    return { error: friendly(nameError) };
  }
  revalidatePath("/", "layout");
  return {};
}
