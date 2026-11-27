"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// The owner shows our record on the website (and its PDF to visitors), or takes it down again.
export async function setRecordPublic(on: boolean): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can show our record on the website." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_record_public", { p_on: on });
  if (error) return { error: friendly(error) };
  revalidatePath("/reports/record");
  revalidatePath("/record");
  revalidatePath("/", "layout");
  return {};
}
