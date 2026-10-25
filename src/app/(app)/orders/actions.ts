"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, canEnterDone, canRecordQc, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { QC_KINDS, TNA_STEPS, todayIST } from "@/lib/format";
import { buyerOverdue, NO_WARNINGS, orderWarnings, type OrderWarnings, type Overdue } from "@/lib/order-checks";
import { PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";
import { createClient } from "@/lib/supabase/server";

export type OrderInput = {
  id?: string;
  // The order's edit number when the form was loaded; a save from an older copy is refused.
  edit_no?: number;
  buyer_id: string;
  buyer_po: string;
  po_date: string;
  ship_date: string;
  status: string;
  merchandiser_id: string;
  notes: string;
  // The buyer's terms: inspection window, penalty clauses. Left out by forms that don't show it.
  buyer_terms?: string;
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

// What the form shows while an order is typed in: other orders it may repeat, and the buyer's overdue invoices.
export async function checkOrder(order: Pick<OrderInput, "id" | "buyer_id" | "buyer_po">, styles: string[]): Promise<{ warnings: OrderWarnings; overdue: Overdue | null }> {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !order.buyer_id) return { warnings: NO_WARNINGS, overdue: null };
  const supabase = await createClient();
  const [warnings, overdue] = await Promise.all([
    orderWarnings(supabase, order.buyer_id, order.buyer_po, styles, order.id),
    buyerOverdue(supabase, order.buyer_id),
  ]);
  return { warnings: warnings ?? NO_WARNINGS, overdue };
}

// incomingId: the incoming PO this order was made from, marked added once the order is saved.
// existing: the order that already holds this buyer PO, so the form can link to it.
// confirmed: the person saw that a very similar PO number is already an order and chose Save anyway.
// confirm: returned instead of saving when that choice is still needed.
// inquiryId: the buyer inquiry this order was made from, marked converted once the order is saved.
export async function saveOrder(order: OrderInput, lines: LineInput[], incomingId?: string, confirmed = false, inquiryId?: string): Promise<{
  error?: string; id?: string; existing?: { id: string; orderNo: string }; confirm?: OrderWarnings;
}> {
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
  // The same check the form shows, made again here so a save can't skip it. A check that can't run doesn't stop the save.
  const warnings = await orderWarnings(supabase, order.buyer_id, order.buyer_po, filled.map((l) => l.style), order.id);
  const same = warnings?.same_po[0];
  if (same) return {
    error: `PO ${order.buyer_po.trim()} from this buyer is already order ${same.order_no}. To add these styles, open ${same.order_no} and add them there.`,
    existing: { id: same.id, orderNo: same.order_no },
  };
  if (warnings?.similar_po.length && !confirmed) return { confirm: warnings };

  if ((order.buyer_terms ?? "").length > 2000) return { error: "Keep the buyer's terms under 2000 letters." };
  const { buyer_terms, ...head } = order;
  const { data, error } = await supabase.rpc("save_order", {
    p_order: { ...head, buyer_po: order.buyer_po.trim() },
    p_lines: filled.map((l) => ({
      ...l,
      qty: num(l.qty),
      buyer_rate: num(l.buyer_rate),
      factory_rate: num(l.factory_rate),
    })),
  });
  if (error) {
    if (error.message?.includes("orders_buyer_po_key")) {
      const po = order.buyer_po.trim().toLowerCase();
      const { data: same } = await supabase.from("orders").select("id, order_no, buyer_po").eq("buyer_id", order.buyer_id).ilike("buyer_po", po.replace(/[\\%_]/g, "\\$&"));
      const hit = (same ?? []).find((o) => o.id !== order.id && o.buyer_po.trim().toLowerCase() === po);
      if (hit) return {
        error: `PO ${order.buyer_po.trim()} from this buyer is already order ${hit.order_no}. To add these styles, open ${hit.order_no} and add them there.`,
        existing: { id: hit.id, orderNo: hit.order_no },
      };
    }
    return { error: friendly(error) };
  }
  if (incomingId) {
    const { error: link } = await supabase.rpc("link_incoming_po", { p_id: incomingId, p_order: data });
    if (link) return { error: `The order is saved, but the PO list didn't update: ${friendly(link)}`, id: data as string };
    revalidatePath("/pos");
  }
  if (buyer_terms !== undefined) {
    const { error: terms } = await supabase.from("orders").update({ buyer_terms: buyer_terms.trim() || null }).eq("id", data as string);
    if (terms) return { error: `The order is saved, but the buyer's terms didn't save: ${friendly(terms)}`, id: data as string };
  }
  if (inquiryId) {
    const { error: link } = await supabase.from("inquiries").update({ status: "converted", order_id: data }).eq("id", inquiryId).in("status", ["new", "quoted"]);
    if (link) return { error: `The order is saved, but the inquiry didn't update: ${friendly(link)}`, id: data as string };
    revalidatePath("/inquiries");
    revalidatePath(`/inquiries/${inquiryId}`);
  }
  revalidatePath("/");
  return { id: data as string };
}

export type ProgressInput = { revised_ship_date: string; delay_reason: string };

// Sets or clears the new ship date. A later date moves every unfinished step target with it, so the plan
// follows the order instead of showing it late (move_ship_date in the database).
export async function saveProgress(id: string, p: ProgressInput): Promise<{ error?: string; moved?: number }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (p.revised_ship_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.revised_ship_date)) return { error: "Enter the new ship date as a date." };
  if (p.revised_ship_date && !p.delay_reason.trim()) return { error: "Say why the ship date moved, so everyone knows." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("move_ship_date", {
    p_order: id, p_new: p.revised_ship_date || null, p_reason: p.delay_reason.trim(),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${id}`);
  return { moved: Number(data) || 0 };
}

// Closes an open order as shipped, from the Home screen's tidy-up list. The database still asks for a passed
// final QC unless the owner does it.
export async function markShipped(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").update({ status: "shipped" }).eq("id", id).eq("status", "open").select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "This order isn't open any more. Reload the page." };
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath(`/orders/${id}`);
  return {};
}

// Closes an open order with pieces left unsent, when the rest won't go (the buyer took less, or the factory
// can't make it). The reason goes on the order and into the owner's morning brief.
export async function closeShort(id: string, reason: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (!reason.trim()) return { error: "Say why the rest won't be sent." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_order_short", { p_order: id, p_reason: reason.trim() });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath(`/orders/${id}`);
  return {};
}

type StageCell = { planned_on: string; done_on: string; not_needed: boolean };
// was: the step as the screen loaded it, so only what this person changed is saved and someone else's newer dates are kept.
// target_note: the owner's reason for moving targets that release locked.
export type LineStageInput = StageCell & { line_id: string; stage: string; label?: string; target_note?: string; was?: StageCell };

// Saves the planned (TNA) and actual dates of an open order's styles; Quality saves done dates only.
// The order's stage follows on its own.
export async function saveLineStages(orderId: string, rows: LineStageInput[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEnterDone(me.role)) return { error: "Only the orders team and Quality can change production." };
  if (!rows.length) return {};
  const isDate = (d: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const knownStep = (r: LineStageInput) => TNA_STEPS.some((s) => s.key === r.stage) || (/^extra_[0-9a-f]{8}$/.test(r.stage) && !!r.label?.trim());
  if (rows.some((r) => !knownStep(r) || !isDate(r.planned_on) || !isDate(r.done_on) || (r.was && (!isDate(r.was.planned_on) || !isDate(r.was.done_on))))) return { error: "Enter the dates as dates, and give every extra step a name." };
  const clean = rows.map((r) => ({ ...(r.not_needed ? { ...r, planned_on: "", done_on: "" } : r), target_note: (r.target_note ?? "").trim().slice(0, 300) }));
  const today = todayIST();
  if (rows.some((r) => r.done_on > today)) return { error: "A done date can't be in the future. Use the plan date for what's expected." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_line_stages", { p_order: orderId, p_rows: clean });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Confirms a factory's "step done" update (its done date goes in) or sends it back with a reason the factory sees.
export async function reviewStepUpdate(orderId: string, updateId: string, confirm: boolean, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEnterDone(me?.role)) return { error: "Only the orders team and Quality confirm factory updates." };
  if (!confirm && !note.trim()) return { error: "Say why, so the factory knows what to fix." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_step_update", { p_id: updateId, p_confirm: confirm, p_note: note.trim().slice(0, 300) });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
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

// The factory agreed to the targets by phone or WhatsApp (it has no login, or doesn't use it): the orders team
// enters the targets as the factory's dates, so the PO can be released. The plan shows it was entered for the factory.
export async function acceptTargetsForFactory(orderId: string, factoryId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_targets_for_factory", { p_order: orderId, p_factory: factoryId });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// The owner locks and releases the factory's PO. The database refuses it until every style has a rate and a plan for every TNA step.
export async function releaseFactoryPo(orderId: string, factoryId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (me.role !== "owner") return { error: "Only the owner approves and releases a factory PO. Send the PO for approval." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_factory_po", { p_order: orderId, p_factory: factoryId });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// The orders team sends a complete plan for the owner's lock. The same checks as the release run first.
export async function requestPoLock(orderId: string, factoryId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_po_lock", { p_order: orderId, p_factory: factoryId });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// The owner sends a plan back to the team with what to change.
export async function sendBackPoLock(orderId: string, factoryId: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can send a plan back." };
  if (!note.trim()) return { error: "Say what to change, so the team knows." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_back_po_lock", { p_order: orderId, p_factory: factoryId, p_note: note.trim().slice(0, 300) });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
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

export type LineFileKind = "tech_pack" | "cutting" | "other";

// A style's fabric and its pieces per size. The database checks the sizes add up to the style's quantity.
export async function saveStyleDetails(orderId: string, lineId: string, fabric: string, sizes: { size: string; qty: string }[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can change orders." };
  const rows = sizes.map((r) => ({ size: r.size.trim(), qty: r.qty.trim() })).filter((r) => r.size || r.qty);
  if (rows.some((r) => !r.size)) return { error: "Every size needs a name, like S or 32." };
  if (rows.some((r) => !/^\d+$/.test(r.qty))) return { error: "Enter whole pieces for every size." };
  if (new Set(rows.map((r) => r.size.toUpperCase())).size !== rows.length) return { error: "A size is entered twice." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_style_details", {
    p_line: lineId, p_fabric: fabric.trim(), p_sizes: rows.length ? Object.fromEntries(rows.map((r) => [r.size, Number(r.qty)])) : null,
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Files already uploaded to <company>/<order>/files/<style>/ are added to the style: tech pack, cutting program or other.
export async function addLineFiles(orderId: string, lineId: string, kind: LineFileKind, files: { path: string; file_name: string }[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.companyId || !canEditOrders(me.role)) return { error: "Only the orders team can change orders." };
  if (!files.every((f) => f.path.startsWith(`${me.companyId}/${orderId}/files/${lineId}/`) && !f.path.includes(".."))) return { error: "Those files didn't upload properly. Try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_line_files", { p_line: lineId, p_kind: kind, p_files: files });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// A style is a garment (every standard step) or fabric (no garment-making steps).
export async function setLineProduct(orderId: string, lineId: string, product: "garment" | "fabric"): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_line_product", { p_line: lineId, p_product: product });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function removeLineFile(orderId: string, fileId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_line_file", { p_id: fileId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// The buyer's PO files, already uploaded to <company>/<order>/ in the PO files store, are kept on the order.
export async function addOrderPoFiles(orderId: string, files: StoredFile[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.companyId || !canEditOrders(me.role)) return { error: "Only the orders team can add the buyer's PO." };
  if (!files.length) return { error: "Pick the PO file first." };
  for (const f of files) {
    const ext = f.path.split(".").pop() ?? "";
    if (!f.path.startsWith(`${me.companyId}/${orderId}/`) || f.path.includes("..") || PO_FILE_TYPES[ext] !== f.type || !(f.size > 0 && f.size <= PO_MAX_BYTES)) {
      return { error: "That file didn't upload properly. Try again." };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_order_po_files", { p_order: orderId, p_files: files.map((f) => ({ ...f, name: f.name.slice(0, 200) })) });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// A PO file that came with one of the buyer's emails, linked to this order without uploading it again.
export async function linkEmailPo(orderId: string, incomingId: string, path: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.companyId || !canEditOrders(me.role)) return { error: "Only the orders team can add the buyer's PO." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_email_po_file", { p_order: orderId, p_incoming: incomingId, p_path: path });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function removeOrderPoFile(orderId: string, fileId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_order_po_file", { p_id: fileId });
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export type QcInput = { line_id: string; kind: string; checked_on: string; result: string; pieces_checked: string; defects: string; notes: string };

export type QcFile = { path: string; kind: "photo" | "report"; file_name: string };

const checkFiles = (prefix: string, files: QcFile[]) =>
  files.every((f) => f.path.startsWith(prefix) && !f.path.includes("..") && (f.kind === "photo" || f.kind === "report"));

// Records one inspection with its proof: at least one photo, and any reports. Saved checks are never edited, only cancelled.
export async function recordQc(orderId: string, qcId: string, q: QcInput, files: QcFile[]): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role || !me.companyId) return { error: "Your account is not switched on yet." };
  if (!canRecordQc(me.role)) return { error: "Only the Quality team records QC." };
  if (!/^[0-9a-f-]{36}$/i.test(q.line_id)) return { error: "Pick the style this check is for." };
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
  if (!files.length) return { error: "Add the QC report or at least one photo as proof of the check." };
  if (!checkFiles(`${me.companyId}/${orderId}/qc/${qcId}/`, files)) return { error: "Those files didn't upload properly. Try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_qc", {
    p_order: orderId,
    p: { id: qcId, line_id: q.line_id, kind: q.kind, checked_on: q.checked_on, result: q.result, pieces_checked: pieces == null ? "" : String(pieces), defects: String(defects), notes: q.notes },
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

// The owner deletes a PO entered by mistake. It is hidden everywhere, kept in the activity log, and can be brought back.
export async function deleteOrder(id: string, reason: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can delete a PO." };
  if (reason.trim().length < 3) return { error: "Say why this PO is being deleted, for example: entered twice." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_order", { p_order: id, p_reason: reason.trim() });
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return {};
}

export async function restoreOrder(id: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can bring back a deleted PO." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_order", { p_order: id });
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return {};
}
