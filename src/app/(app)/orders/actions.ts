"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { loadOrder } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { DEFAULT_CHECKPOINTS, type Draft, type TnaStatus, toDraft, toPayload, validateDraft } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok?: string; error?: string; errors?: string[]; warnings?: string[]; id?: string };

const NOT_ALLOWED = "Only merchandisers, managers, QC and the owner can change sales orders.";
const refresh = () => revalidatePath("/", "layout");

async function guard() {
  const me = await getMe();
  return isOps(me?.role) ? me : null;
}

export async function createOrder(input: { buyer_id: string; po: string; order_type: "garment" | "fabric"; inquiry_id: string }): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  if (!input.buyer_id) return { error: "Choose the buyer." };
  if (!input.po.trim()) return { error: "Enter the buyer PO / reference number." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sales_order", {
    p_buyer: input.buyer_id, p_po_number: input.po.trim(), p_order_type: input.order_type, p_inquiry: input.inquiry_id || null,
  });
  if (error) return { error: error.message };
  const id = data as string;
  // Styles the buyer accepted on the cost sheets come across with their
  // prices; otherwise start with one empty style, like the old tool.
  const { data: costs } = input.inquiry_id
    ? await supabase.from("costings").select("style_name, qty, currency, factory_id, factory_cost, quoted_price").eq("inquiry_id", input.inquiry_id).eq("status", "accepted").order("created_at")
    : { data: [] };
  const names = await defaultSteps(input.order_type);
  const draft = await draftFor(id);
  const factories = [...new Set((costs ?? []).map((c) => c.factory_id).filter(Boolean))];
  const { error: e2 } = await supabase.rpc("save_sales_order", {
    p: {
      ...draft,
      ...(costs?.length ? { currency: costs[0].currency, factory_id: factories.length === 1 ? factories[0] : draft.factory_id } : {}),
      styles: costs?.length
        ? costs.map((c) => ({ ...blankStyle(input.order_type, names), name: c.style_name, use_sizes: false, qty: c.qty != null ? String(c.qty) : "",
            buyer_rate: c.quoted_price != null ? String(c.quoted_price) : "", factory_rate: c.factory_cost ? String(c.factory_cost) : "" }))
        : [blankStyle(input.order_type, names)],
    },
  });
  if (e2) return { error: `Created ${id}, but the first style wasn't added: ${e2.message}`, id };
  refresh();
  return { ok: `Created ${id}.`, id };
}

// Step names from the default TNA template for this kind of order.
async function defaultSteps(type: "garment" | "fabric") {
  const supabase = await createClient();
  const { data } = await supabase.from("tna_templates").select("steps").eq("order_type", type).eq("is_default", true).maybeSingle();
  const names = ((data?.steps ?? []) as { name: string }[]).map((s) => s.name);
  return names.length ? names : DEFAULT_CHECKPOINTS;
}

function blankStyle(type: "garment" | "fabric", steps: string[]) {
  return {
    id: crypto.randomUUID(), name: "", code: "", fabric: "", colour: "", use_sizes: type === "garment", sizes: {}, qty: "",
    buyer_rate: "", factory_rate: "", internal_note: "",
    checkpoints: steps.map((name) => ({ id: crypto.randomUUID(), name, due_date: "" })),
  };
}

async function draftFor(id: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("sales_orders").select("*").eq("id", id).single();
  return toPayload(toDraft({ ...data, tags: data?.tags ?? [], styles: [] }));
}

// Autosave: the whole draft in one call.
export async function saveOrder(draft: Draft): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_sales_order", { p: toPayload(draft) });
  if (error) return { error: error.message };
  return { ok: "Saved" };
}

async function checkSaved(id: string): Promise<Result | null> {
  const o = await loadOrder(id);
  if (!o) return { error: `Sales order ${id} not found.` };
  const { E, W } = validateDraft(toDraft(o), todayIST());
  return E.length ? { errors: E, warnings: W } : null;
}

export async function submitOrder(id: string): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const bad = await checkSaved(id);
  if (bad) return bad;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sales_order_review", { p_so: id, p_review: true });
  if (error) return { error: error.message };
  refresh();
  return { ok: `${id} sent to the owner for the TNA lock.` };
}

export async function backToDraft(id: string): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sales_order_review", { p_so: id, p_review: false });
  if (error) return { error: error.message };
  refresh();
  return { ok: `${id} is back to draft.` };
}

export async function deleteDraft(id: string): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_draft_sales_order", { p_so: id });
  if (error) return { error: error.message };
  refresh();
  return { ok: `Deleted ${id}.` };
}

export async function lockOrder(id: string): Promise<Result> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can lock a TNA." };
  const bad = await checkSaved(id);
  if (bad) return bad;
  const supabase = await createClient();
  const { error } = await supabase.rpc("lock_sales_order", { p_so: id });
  if (error) return { error: error.message };
  refresh();
  return { ok: `${id} locked. The factory can now see the final PO.` };
}

export async function unlockOrder(id: string): Promise<Result> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can unlock a TNA." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_sales_order", { p_so: id });
  if (error) return { error: error.message };
  refresh();
  return { ok: `${id} unlocked and back in TNA review.` };
}

export async function saveLiveStatus(id: string, merchDate: string, remarks: string): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_orders").update({ merch_date: merchDate || null, remarks: remarks.trim() || null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: "Status saved." };
}

const TNA: TnaStatus[] = ["pending", "in_progress", "completed", "delayed"];
export async function setCheckpoint(checkpointId: string, status: TnaStatus, note = "", reason = ""): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  if (!TNA.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_checkpoint", {
    p_checkpoint: checkpointId, p_status: status, p_note: note.trim() || null, p_reason: reason || null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: "Updated." };
}

export async function saveStyleNote(styleId: string, note: string): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  const supabase = await createClient();
  const { error } = await supabase.from("so_styles").update({ internal_note: note.trim() || null }).eq("id", styleId);
  if (error) return { error: error.message };
  refresh();
  return { ok: "Note saved." };
}
