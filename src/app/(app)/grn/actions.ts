"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { Condition, GrnStatus } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type GrnInput = {
  id: string | null; so_id: string; received_at: string; received_by: string; qc_checked: boolean; qc_note: string; notes: string;
  lines: { style_id: string; qty: string; condition: Condition }[]; status: Extract<GrnStatus, "draft" | "pending_approval" | "approved">;
};
type Result = { ok?: string; error?: string; id?: string };
const refresh = () => revalidatePath("/", "layout");

export async function saveGrn(input: GrnInput): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can record goods received." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_grn", { p: input });
  if (error) return { error: error.message };
  refresh();
  const id = data as string;
  return {
    id,
    ok: input.status === "draft" ? `${id} saved as draft` : input.status === "approved" ? `${id} approved. Dispatch within 24 hours.` : `${id} sent for approval. Dispatch within 24 hours.`,
  };
}

export async function decideGrn(id: string, decision: "approved" | "rejected"): Promise<Result> {
  if ((await getMe())?.role !== "owner") return { error: "Only the owner can approve or reject a GRN." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("grns").update({ status: decision }).eq("id", id).eq("status", "pending_approval").select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: `${id} isn't waiting for approval any more.` };
  refresh();
  return { ok: decision === "approved" ? `${id} approved` : `${id} rejected` };
}

export async function deleteGrn(id: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can delete GRN drafts." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("grns").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only draft GRNs can be deleted." };
  refresh();
  return { ok: `Deleted ${id}.` };
}
