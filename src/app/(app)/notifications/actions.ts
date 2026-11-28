"use server";

import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// Everything up to now counts as seen, so the bell's dot clears on the next screen. The page itself is not
// refreshed, so what was new stays marked new while it is being read.
export async function markSeen(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("bell_seen");
}

export async function setEveningEmail(on: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_evening_email", { p_on: on });
  return error ? { error: friendly(error) } : {};
}
