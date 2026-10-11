"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, canEnterDone, canRecordQc, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { QC_KINDS, TNA_STEPS, todayIST } from "@/lib/format";
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

// incomingId: the incoming PO this order was made from, marked added once the order is saved.
export async function saveOrder(order: OrderInput, lines: LineInput[], incomingId?: string): Promise<{ error?: string; id?: string }> {
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
  if (incomingId) {
    const { error: link } = await supabase.rpc("link_incoming_po", { p_id: incomingId, p_order: data });
    if (link) return { error: `The order is saved, but the PO list didn't update: ${friendly(link)}`, id: data as string };
    revalidatePath("/pos");
  }
  revalidatePath("/");
  return { id: data as string };
}

export type ProgressInput = { revised_ship_date: string; delay_reason: string };

// Updates only the production details, so it never touches the styles or prices.
export async function saveProgress(id: string, p: ProgressInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (p.revised_ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.revised_ship_date)) return { error: "Enter the new ship date as a date." };
  if (p.revised_ship_date && !p.delay_reason.trim()) return { error: "Say why the ship date moved, so everyone knows." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({
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

export type LineStageInput = { line_id: string; stage: string; planned_on: string; done_on: string; not_needed: boolean; label?: string };

// Saves the planned (TNA) and actual dates of an open order's styles; Quality saves done dates only.
// The order's stage follows on its own.
export async function saveLineStages(orderId: string, rows: LineStageInput[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEnterDone(me.role)) return { error: "Only the orders team and Quality can change production." };
  if (!rows.length) return {};
  const isDate = (d: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const knownStep = (r: LineStageInput) => TNA_STEPS.some((s) => s.key === r.stage) || (/^extra_[0-9a-f]{8}$/.test(r.stage) && !!r.label?.trim());
  if (rows.some((r) => !knownStep(r) || !isDate(r.planned_on) || !isDate(r.done_on))) return { error: "Enter the dates as dates, and give every extra step a name." };
  const clean = rows.map((r) => (r.not_needed ? { ...r, planned_on: "", done_on: "" } : r));
  const today = todayIST();
  if (rows.some((r) => r.done_on > today)) return { error: "A done date can't be in the future. Use the plan date for what's expected." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_line_stages", { p_order: orderId, p_rows: clean });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Asks the factory for its TNA plan, with the buffer to keep before the PO's delivery date.
// The factory then has 24 hours to send its dates in its panel. Nothing is sent outside the app.
export async function requestPlan(orderId: string, factoryId: string, bufferDays: number): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (!Number.isInteger(bufferDays) || bufferDays < 0 || bufferDays > 90) return { error: "Keep a buffer of 0 to 90 days." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_factory_plan", { p_order: orderId, p_factory: factoryId, p_buffer_days: bufferDays });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Releases the factory's PO. The database refuses it until every style has a rate and a plan for every TNA step.
export async function releaseFactoryPo(orderId: string, factoryId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_factory_po", { p_order: orderId, p_factory: factoryId });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Sets a style's photo. The old file is kept in storage; the style just points at the new one.
export async function setStylePhoto(orderId: string, lineId: string, path: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (!path.startsWith(`${me.companyId}/${orderId}/styles/${lineId}/`) || path.includes("..")) return { error: "That photo didn't upload properly. Try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("order_lines").update({ photo_path: path }).eq("id", lineId).eq("order_id", orderId).select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "That style is no longer on this order. Reload the page." };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export type QcInput = { kind: string; checked_on: string; result: string; pieces_checked: string; defects: string; notes: string };

export type QcFile = { path: string; kind: "photo" | "report"; file_name: string };

const checkFiles = (prefix: string, files: QcFile[]) =>
  files.every((f) => f.path.startsWith(prefix) && !f.path.includes("..") && (f.kind === "photo" || f.kind === "report"));

// Records one inspection with its proof: at least one photo, and any reports. Saved checks are never edited, only cancelled.
export async function recordQc(orderId: string, qcId: string, q: QcInput, files: QcFile[]): Promise<{ error?: string }> {
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
  if (!files.some((f) => f.kind === "photo")) return { error: "Add at least one photo as proof of the check." };
  if (!checkFiles(`${me.companyId}/${orderId}/qc/${qcId}/`, files)) return { error: "Those files didn't upload properly. Try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_qc", {
    p_order: orderId,
    p: { id: qcId, kind: q.kind, checked_on: q.checked_on, result: q.result, pieces_checked: pieces == null ? "" : String(pieces), defects: String(defects), notes: q.notes },
    p_files: files,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Adds more photos or reports to a saved check.
export async function addQcFiles(orderId: string, qcId: string, files: QcFile[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  if (!files.length || !checkFiles(`${me.companyId}/${orderId}/qc/${qcId}/`, files)) return { error: "Those files didn't upload properly. Try again." };
  const supabase = await createClient();
  const { error } = await supabase.from("qc_photos").insert(files.map((f) => ({
    company_id: me.companyId, qc_id: qcId, path: f.path, kind: f.kind, file_name: f.file_name || null, created_by: me.id,
  })));
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Anyone in the company can comment on a check; comments are never changed.
export async function addQcComment(orderId: string, qcId: string, body: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  const text = body.trim();
  if (!text) return { error: "Write the comment first." };
  if (text.length > 2000) return { error: "Keep the comment under 2,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("qc_comments").insert({ company_id: me.companyId, qc_id: qcId, body: text, created_by: me.id });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Takes a photo or report off a check. The file itself is kept.
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
