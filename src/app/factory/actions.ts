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
