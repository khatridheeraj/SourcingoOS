"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { datesFrom, type TemplateStep } from "@/lib/tna";

type Result = { ok?: string; error?: string };
const NOT_ALLOWED = { error: "Only merchandisers, managers, QC and the owner can fix order data." };
const refresh = () => revalidatePath("/", "layout");
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// Orders that left before the app existed: close them so alerts stay true.
export async function markShipped(ids: string[], note: string): Promise<Result> {
  const me = await getMe();
  if (me?.role !== "owner" && me?.role !== "manager") return { error: "Only the owner or a merchandiser manager can close orders by hand." };
  if (!ids.length) return { error: "Tick the orders that have shipped." };
  const supabase = await createClient();
  const done: string[] = [];
  for (const id of ids) {
    const { error } = await supabase.rpc("mark_order_shipped", { p_so: id, p_note: note.trim() || null });
    if (error) { refresh(); return { error: `${done.length ? `Closed ${done.join(", ")}. ` : ""}${id}: ${error.message}` }; }
    done.push(id);
  }
  refresh();
  return { ok: done.length === 1 ? `${done[0]} marked shipped.` : `${done.length} orders marked shipped.` };
}

// Plan the TNA of a running order from a template, dated back from the factory date.
export async function applyRunningTemplate(soId: string, templateId: string, factoryDate: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return NOT_ALLOWED;
  if (!isDate(factoryDate)) return { error: "Set the factory delivery date first. The steps are dated back from it." };
  const supabase = await createClient();
  const [{ data: t }, { data: o }] = await Promise.all([
    supabase.from("tna_templates").select("steps").eq("id", templateId).maybeSingle(),
    supabase.from("sales_orders").select("factory_date, buyer_date").eq("id", soId).maybeSingle(),
  ]);
  if (!t) return { error: "Pick a TNA template." };
  if (!o) return { error: `Sales order ${soId} not found.` };
  if (!o.factory_date) {
    if (o.buyer_date && factoryDate > o.buyer_date) return { error: "The factory date can't be after the buyer's date." };
    const { error } = await supabase.from("sales_orders").update({ factory_date: factoryDate }).eq("id", soId);
    if (error) return { error: error.message };
  }
  const { data, error } = await supabase.rpc("add_running_tna", { p_so: soId, p_steps: datesFrom(t.steps as TemplateStep[], o.factory_date ?? factoryDate) });
  if (error) return { error: error.message };
  refresh();
  return { ok: `TNA added to ${data === 1 ? "1 style" : `${data} styles`} on ${soId}.` };
}

// Missing order details. A running order accepts each one once.
export async function fillOrder(soId: string, patch: { merchandiser_id?: string; manager_id?: string; factory_id?: string; factory_date?: string; buyer_date?: string }): Promise<Result> {
  if (!isOps((await getMe())?.role)) return NOT_ALLOWED;
  const row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v));
  if (!Object.keys(row).length) return { error: "Nothing to save." };
  for (const k of ["factory_date", "buyer_date"]) if (row[k] && !isDate(row[k])) return { error: "Pick a valid date." };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_orders").update(row).eq("id", soId);
  if (error) return { error: error.message };
  refresh();
  return { ok: `${soId} saved.` };
}

export async function fillFactoryRate(styleId: string, rate: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return NOT_ALLOWED;
  const n = Number(rate);
  if (!rate.trim() || !Number.isFinite(n) || n <= 0) return { error: "Enter the factory rate per piece." };
  const supabase = await createClient();
  const { error } = await supabase.from("so_styles").update({ factory_rate: n }).eq("id", styleId);
  if (error) return { error: error.message };
  refresh();
  return { ok: "Rate saved." };
}

export async function fillSampleDue(sampleId: string, date: string): Promise<Result> {
  if (!isOps((await getMe())?.role)) return NOT_ALLOWED;
  if (!isDate(date)) return { error: "Pick the date the buyer needs it." };
  const supabase = await createClient();
  const { error } = await supabase.from("samples").update({ due_date: date }).eq("id", sampleId);
  if (error) return { error: error.message };
  refresh();
  return { ok: "Due date saved." };
}
