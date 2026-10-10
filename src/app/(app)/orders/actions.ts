"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, canRecordQc, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { QC_KINDS, STAGES, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type OrderInput = {
  id?: string;
  buyer_id: string;
  buyer_po: string;
  po_date: string;
  ship_date: string;
  status: string;
  merchandiser_id: string;
  notes: string;
};
export type LineInput = {
  id?: string;
  style: string;
  description: string;
  colour: string;
  qty: string;
  buyer_rate: string;
  factory_id: string;
  factory_rate: string;
};

const num = (s: string) => s.replace(/[,₹\s]/g, "");

export async function saveOrder(order: OrderInput, lines: LineInput[]): Promise<{ error?: string; id?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (!order.buyer_id) return { error: "Pick the buyer." };
  if (!order.buyer_po.trim()) return { error: "Enter the buyer's PO number." };

  const filled = lines.filter((l) => l.style.trim() || l.qty.trim());
  if (filled.length === 0) return { error: "Add at least one style." };
  for (const [i, l] of filled.entries()) {
    const n = i + 1;
    if (!l.style.trim()) return { error: `Line ${n}: enter the style number.` };
    const q = Number(num(l.qty));
    if (!Number.isInteger(q) || q <= 0) return { error: `Line ${n}: quantity must be a whole number above zero.` };
    for (const [k, label] of [["buyer_rate", "buyer rate"], ["factory_rate", "factory rate"]] as const) {
      if (l[k].trim() && !(Number(num(l[k])) >= 0)) return { error: `Line ${n}: the ${label} must be a number.` };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_order", {
    p_order: { ...order, buyer_po: order.buyer_po.trim() },
    p_lines: filled.map((l) => ({
      ...l,
      qty: num(l.qty),
      buyer_rate: num(l.buyer_rate),
      factory_rate: num(l.factory_rate),
    })),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  return { id: data as string };
}

export type ProgressInput = { stage: string; revised_ship_date: string; delay_reason: string };

// Updates only the production details, so it never touches the styles or prices.
export async function saveProgress(id: string, p: ProgressInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (p.stage && !STAGES.some((s) => s.key === p.stage)) return { error: "Pick a stage from the list." };
  if (p.revised_ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.revised_ship_date)) return { error: "Enter the new ship date as a date." };
  if (p.revised_ship_date && !p.delay_reason.trim()) return { error: "Say why the ship date moved, so everyone knows." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({
      stage: p.stage || null,
      revised_ship_date: p.revised_ship_date || null,
      delay_reason: p.delay_reason.trim() || null,
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "Only open orders can be updated here. Reload the page." };
  revalidatePath("/");
  revalidatePath(`/orders/${id}`);
  return {};
}

export type QcInput = { kind: string; checked_on: string; result: string; pieces_checked: string; defects: string; notes: string };

// Records one inspection. Saved checks are never edited, only cancelled with a reason.
export async function addQc(orderId: string, q: QcInput): Promise<{ error?: string; id?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  if (!QC_KINDS.some((k) => k.key === q.kind)) return { error: "Pick the type of check." };
  if (q.result !== "pass" && q.result !== "fail") return { error: "Pick Pass or Fail." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.checked_on)) return { error: "Enter the date of the check." };
  if (q.checked_on > todayIST()) return { error: "The check date can't be in the future." };
  const pieces = q.pieces_checked.trim() ? Number(num(q.pieces_checked)) : null;
  const defects = q.defects.trim() ? Number(num(q.defects)) : 0;
  if (pieces != null && (!Number.isInteger(pieces) || pieces <= 0)) return { error: "Pieces checked must be a whole number above zero." };
  if (!Number.isInteger(defects) || defects < 0) return { error: "Defects must be a whole number, 0 or more." };
  if (pieces != null && defects > pieces) return { error: "Defects can't be more than the pieces checked." };
  if (q.result === "fail" && !q.notes.trim()) return { error: "Write what failed in the notes, so the factory knows what to fix." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("qc_checks").insert({
    company_id: me.companyId, order_id: orderId, kind: q.kind, checked_on: q.checked_on, result: q.result,
    pieces_checked: pieces, defects, notes: q.notes.trim() || null, checked_by: me.id,
  }).select("id").single();
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return { id: data.id };
}

// Lists photos the browser has just uploaded to storage against a QC check.
export async function addQcPhotos(orderId: string, qcId: string, paths: string[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  const prefix = `${me.companyId}/${orderId}/qc/${qcId}/`;
  if (!paths.length || paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) return { error: "Those photos didn't upload properly. Try again." };
  const supabase = await createClient();
  const { error } = await supabase.from("qc_photos").insert(paths.map((path) => ({ company_id: me.companyId, qc_id: qcId, path, created_by: me.id })));
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Takes a photo off a check. The file itself is kept.
export async function removeQcPhoto(orderId: string, id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  const supabase = await createClient();
  const { error } = await supabase.from("qc_photos").update({ removed_at: new Date().toISOString() }).eq("id", id).is("removed_at", null);
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function cancelQc(orderId: string, id: string, reason: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  if (!reason.trim()) return { error: "Say why this QC check is being cancelled." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("qc_checks").update({ cancelled_at: new Date().toISOString(), cancel_reason: reason.trim() })
    .eq("id", id).is("cancelled_at", null).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "That check was already cancelled. Reload the page." };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return {};
}
