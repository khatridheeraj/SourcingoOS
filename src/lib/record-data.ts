import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordCounts } from "@/lib/record";

// Our record as the database counts it, or null when this caller may not see it (a visitor while it is switched off).
export async function loadRecord(supabase: SupabaseClient): Promise<RecordCounts | null> {
  try {
    const { data, error } = await supabase.rpc("sourcingo_record");
    if (error || !data) return null;
    return data as RecordCounts;
  } catch {
    return null;
  }
}
