"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

type Result = { ok?: string; error?: string; id?: string };

// Issue (or re-issue after a change) the factory PO of a running order.
export async function issuePo(soId: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can issue factory POs." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_factory_po", { p_so: soId });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: `${data} sent to the factory.`, id: data as string };
}

// The factory said yes or no on the phone: record it for them.
export async function recordAnswer(id: string, accept: boolean, note: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can do this." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_factory_po", { p_id: id, p_accept: accept, p_note: note.trim() || null });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: accept ? `${id} marked accepted.` : `${id} marked declined.` };
}
