"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { TNA_STEPS } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type FactoryDateInput = { line_id: string; stage: string; factory_on: string };

// The factory sends its TNA dates for one order. They are fixed once the PO is released.
export async function saveFactoryTna(orderId: string, rows: FactoryDateInput[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  if (rows.some((r) => (!TNA_STEPS.some((s) => s.key === r.stage) && !/^extra_[0-9a-f]{8}$/.test(r.stage)) || (r.factory_on && !/^\d{4}-\d{2}-\d{2}$/.test(r.factory_on)))) {
    return { error: "Enter the dates as dates." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_factory_tna", { p_order: orderId, p_rows: rows });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory");
  return {};
}

// The factory says a step of its style is done, with photos already uploaded. Sourcingo confirms it.
export async function postStepUpdate(lineId: string, stage: string, doneOn: string, note: string, photos: string[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) return { error: "Pick the date the step was done." };
  if (!photos.length) return { error: "Add at least one photo of the work." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_step_update", { p_line: lineId, p_stage: stage, p_done_on: doneOn, p_note: note.slice(0, 500), p_photos: photos });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory");
  return {};
}

// The factory sends a style's sample (fit, strike off, PP or size set) with photos already uploaded.
// Sourcingo checks it and sends it to the buyer.
export async function sendSample(lineId: string, stage: string, note: string, photos: string[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  if (!photos.length) return { error: "Add at least one photo of the sample." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_sample", { p_line: lineId, p_stage: stage, p_note: note.slice(0, 500), p_photos: photos });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory");
  return {};
}

// The factory accepts its PO in the panel, the same as Accept on the PO's emailed link. Reminders stop.
export async function acceptPoInPanel(orderId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("factory_accept_po", { p_order: orderId });
  if (error) return { error: friendly(error) };
  revalidatePath("/factory");
  return {};
}

// The factory's piece counts so far (cut, stitched, packed) for the styles it changed. Each is today's count for that
// style; sending again the same day replaces it.
export async function saveFactoryCounts(rows: { lineId: string; cut: number; stitched: number; packed: number }[]): Promise<{ error?: string; style?: string }> {
  const me = await getMe();
  if (me?.role !== "factory") return { error: "This login is not set up for a factory." };
  const supabase = await createClient();
  for (const r of rows) {
    const { error } = await supabase.rpc("post_factory_count", { p_line: r.lineId, p_cut: r.cut, p_stitched: r.stitched, p_packed: r.packed, p_note: null });
    if (error) return { error: friendly(error), style: r.lineId };
  }
  revalidatePath("/factory");
  return {};
}
