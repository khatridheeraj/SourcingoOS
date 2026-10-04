"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { CostExtra } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type CostingInput = {
  id?: string; inquiry_id: string; style_name: string; currency: string; qty: string; factory_id: string; factory_cost: string;
  extras: CostExtra[]; overhead_pct: string; margin_pct: string; quoted_price: string; status: "draft" | "quoted" | "accepted" | "rejected"; notes: string;
};

const n = (v: string) => (v.trim() === "" ? null : Number(v));

export async function saveCosting(c: CostingInput): Promise<{ ok?: string; error?: string; id?: string }> {
  if (!isOps((await getMe())?.role)) return { error: "Only merchandisers, managers, QC and the owner can cost inquiries." };
  if (!c.style_name.trim()) return { error: "Name the style you're costing." };
  for (const [k, v] of [["Factory cost", c.factory_cost], ["Overhead", c.overhead_pct], ["Margin", c.margin_pct], ["Quoted price", c.quoted_price], ["Quantity", c.qty]] as const) {
    if (v.trim() && (!Number.isFinite(Number(v)) || Number(v) < 0)) return { error: `${k}: enter a number of 0 or more.` };
  }
  const row = {
    inquiry_id: c.inquiry_id, style_name: c.style_name.trim(), currency: c.currency, qty: n(c.qty), factory_id: c.factory_id || null,
    factory_cost: n(c.factory_cost) ?? 0, overhead_pct: n(c.overhead_pct) ?? 0, margin_pct: n(c.margin_pct) ?? 15, quoted_price: n(c.quoted_price),
    status: c.status, notes: c.notes.trim() || null,
    extras: c.extras.filter((e) => e.label.trim() || Number(e.amount)).map((e) => ({ label: e.label.trim(), amount: Number(e.amount) || 0 })),
  };
  const supabase = await createClient();
  const res = c.id ? await supabase.from("costings").update(row).eq("id", c.id).select("id").single() : await supabase.from("costings").insert(row).select("id").single();
  if (res.error) return { error: res.error.message };
  revalidatePath("/inquiries", "layout");
  return { ok: "Cost sheet saved.", id: res.data.id };
}

export async function deleteCosting(id: string): Promise<{ ok?: string; error?: string }> {
  if (!isOps((await getMe())?.role)) return { error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase.from("costings").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inquiries", "layout");
  return { ok: "Deleted." };
}
