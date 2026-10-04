"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Removes a file and its stored copy. Row-level security decides who may.
export async function deleteFile(id: string): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const { data: f } = await supabase.from("files").select("id, storage_path, file_name").eq("id", id).maybeSingle();
  if (!f) return { error: "That file is already gone. Reload the page." };
  const { error: se } = await supabase.storage.from("files").remove([f.storage_path]);
  if (se) return { error: `Couldn't delete ${f.file_name}: ${se.message}` };
  const { data, error } = await supabase.from("files").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You can only delete files you added." };
  revalidatePath("/", "layout");
  return { ok: `Deleted ${f.file_name}` };
}
