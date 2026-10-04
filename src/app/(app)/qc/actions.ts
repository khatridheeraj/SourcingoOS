"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { QcDefect, QcKind } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type QcInput = {
  so_id: string; style_id: string; kind: QcKind; inspected_on: string; lot_qty: number; sample_size: number;
  aql_major: number; aql_minor: number; defects: QcDefect[]; measurements_ok: boolean | null; packing_ok: boolean | null; notes: string;
};

// The database counts the defects and decides pass, fail or hold.
export async function saveQc(q: QcInput): Promise<{ ok?: string; error?: string; id?: string }> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can record inspections." };
  if (!q.so_id || !q.style_id) return { error: "Pick the order and style you inspected." };
  if (!(q.lot_qty > 0)) return { error: "Enter how many pieces were offered (the lot)." };
  if (!(q.sample_size > 0) || q.sample_size > q.lot_qty) return { error: "The sample can't be bigger than the lot." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("qc_inspections").insert({
    so_id: q.so_id, style_id: q.style_id, kind: q.kind, inspected_on: q.inspected_on, lot_qty: Math.round(q.lot_qty), sample_size: Math.round(q.sample_size),
    aql_major: q.aql_major, aql_minor: q.aql_minor, measurements_ok: q.measurements_ok, packing_ok: q.packing_ok, notes: q.notes.trim() || null,
    defects: q.defects.filter((d) => d.count > 0 && d.name.trim()).map((d) => ({ name: d.name.trim(), severity: d.severity, count: Math.round(d.count) })),
  }).select("id, result").single();
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: `${data.id} saved: ${data.result === "pass" ? "passed" : data.result === "fail" ? "failed" : "on hold"}.`, id: data.id };
}

export async function deleteQc(id: string): Promise<{ ok?: string; error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" && me?.role !== "manager") return { error: "Only the owner or a merchandiser manager can delete an inspection." };
  const supabase = await createClient();
  const { data: files } = await supabase.from("files").select("storage_path").eq("qc_id", id);
  if (files?.length) await supabase.storage.from("files").remove(files.map((f) => f.storage_path));
  const { error } = await supabase.from("qc_inspections").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: `${id} deleted.` };
}
