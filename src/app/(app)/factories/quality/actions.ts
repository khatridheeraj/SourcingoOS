"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The team has read a buyer's rating: a low one stops waiting on Home.
export async function seeRating(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || me.role === "buyer" || me.role === "factory") return { error: "Only the team can do that." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("see_order_rating", { p_id: id });
  if (error) return { error: friendly(error) };
  revalidatePath("/factories/quality");
  revalidatePath("/today");
  return {};
}
