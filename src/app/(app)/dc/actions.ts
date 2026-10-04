"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type DcInput = {
  id: string | null; grn_id: string; courier: string; tracking: string; address: string; invoice_no: string; invoice_date: string;
  dispatched_at: string; lines: { style_id: string; qty: string }[]; status: "draft" | "dispatched";
};
type Result = { ok?: string; error?: string; id?: string };
const NOT_ALLOWED = "Only merchandisers, managers, QC and the owner can create delivery challans.";

export async function saveDc(input: DcInput): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_dc", { p: input });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  const id = data as string;
  return { id, ok: input.status === "dispatched" ? `${id} dispatched` : `${id} saved as draft` };
}

export async function deleteDc(id: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { data, error } = await supabase.from("delivery_challans").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only draft delivery challans can be deleted." };
  revalidatePath("/", "layout");
  return { ok: `Deleted ${id}.` };
}
