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
  const { error } = await supabase.rpc("save_buyer", {
    p: { id: b.id ?? "", code, real_name: b.realName.trim(), city: b.city, notes: b.notes, active: b.active },
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return {};
}
