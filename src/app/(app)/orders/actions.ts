"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { loadOrder } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { type Draft, type TnaStatus, toDraft, toPayload, validateDraft } from "@/lib/model";
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
  // Start with one empty style and the standard checkpoints, like the old tool.
  const { error: e2 } = await supabase.rpc("save_sales_order", {
    p: { ...(await draftFor(id)), styles: [blankStyle(input.order_type)] },
  });
  if (e2) return { error: `Created ${id}, but the first style wasn't added: ${e2.message}`, id };
  refresh();
  return { ok: `Created ${id}.`, id };
}

function blankStyle(type: "garment" | "fabric") {
  return {
    id: crypto.randomUUID(), name: "", code: "", fabric: "", colour: "", use_sizes: type === "garment", sizes: {}, qty: "",
    buyer_rate: "", factory_rate: "", internal_note: "",
    checkpoints: ["Fabric Sourcing", "Cutting", "Sewing", "QC", "Packing", "Ready for Dispatch"].map((name) => ({ id: crypto.randomUUID(), name, due_date: "" })),
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
export async function setCheckpoint(checkpointId: string, status: TnaStatus): Promise<Result> {
  if (!(await guard())) return { error: NOT_ALLOWED };
  if (!TNA.includes(status)) return { error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_checkpoint_status", { p_checkpoint: checkpointId, p_status: status });
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
