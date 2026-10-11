import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// The company a mailbox script's key belongs to, or null for an unknown key.
export async function companyForKey(admin: SupabaseClient, key: unknown): Promise<string | null> {
  if (typeof key !== "string" || key.length < 20) return null;
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  const { data } = await admin.from("inbound_keys").select("company_id").eq("key_hash", hash).maybeSingle();
  return (data?.company_id as string | undefined) ?? null;
}
