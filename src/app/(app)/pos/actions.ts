"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type PoResult = { ok?: string; error?: string; href?: string };

const NOT_ALLOWED = "Only merchandisers, managers, QC and the owner can work on POs.";
const refresh = () => revalidatePath("/", "layout");

export async function poToInquiry(id: string): Promise<PoResult> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("received_po_to_inquiry", { p_po: id });
  if (error) return { error: error.message };
  refresh();
  return { ok: `Opened inquiry ${data}.`, href: `/inquiries?status=all&q=${encodeURIComponent(String(data))}` };
}

export async function poToOrder(id: string): Promise<PoResult> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_received_po", { p_po: id });
  if (error) return { error: error.message };
  refresh();
  return { ok: `Sales order ${data} is ready as a draft.`, href: `/orders/${data}` };
}

export async function setPoStatus(id: string, status: "new" | "in_progress" | "rejected", reason = ""): Promise<PoResult> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  if (!["new", "in_progress", "rejected"].includes(status)) return { error: "A PO becomes Converted when a sales order is created from it." };
  const why = reason.trim();
  if (status === "rejected" && !why) return { error: "Say why the PO is rejected." };
  if (why.length > 500) return { error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("received_pos").update({ status, reject_reason: status === "rejected" ? why : null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: status === "rejected" ? "PO rejected." : status === "in_progress" ? "Marked in progress." : "Back to new." };
}
