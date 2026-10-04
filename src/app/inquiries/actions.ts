"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok?: string; error?: string; nonce?: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => {
  const v = text(form, key);
  return v === "" ? null : Number(v);
};
const NOT_ALLOWED = "Only merchandisers, managers, QC and the owner can work on inquiries.";

function refresh() {
  revalidatePath("/inquiries");
  revalidatePath("/");
}

export async function createInquiry(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };

  const row = {
    buyer_id: text(form, "buyer_id"),
    contact_person: text(form, "contact_person"),
    contact_email: text(form, "contact_email"),
    product_type: text(form, "product_type"),
    est_qty: num(form, "est_qty"),
    unit: text(form, "unit") === "m" ? "m" : "pcs",
    budget_inr: num(form, "budget_inr"),
    merchandiser_id: text(form, "merchandiser_id") || null,
    next_follow_up: text(form, "next_follow_up") || null,
    notes: text(form, "notes") || null,
  };
  const missing = [
    !row.buyer_id && "buyer",
    !row.contact_person && "contact person",
    !row.contact_email && "email",
    !row.product_type && "product type",
  ].filter(Boolean);
  if (missing.length) return { error: `Fill in the ${missing.join(", ")}.` };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact_email)) return { error: "That email address doesn't look right." };
  if ([row.est_qty, row.budget_inr].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
    return { error: "Quantity and budget must be positive numbers." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("inquiries").insert(row).select("id").single();
  if (error) return { error: error.message };
  refresh();
  return { ok: `Logged ${data.id}.`, nonce: Date.now() };
}

const FIELDS = ["status", "merchandiser_id", "next_follow_up"] as const;
type Field = (typeof FIELDS)[number];

export async function updateInquiry(id: string, field: Field, value: string): Promise<FormState> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  if (!FIELDS.includes(field)) return { error: "That field can't be changed here." };
  if (field === "status" && !["new", "quoted", "lost"].includes(value)) {
    return { error: "An inquiry becomes Converted when a sales order is created from it." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("inquiries").update({ [field]: value || null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: "Saved." };
}

export async function addFollowUp(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isOps((await getMe())?.role)) return { error: NOT_ALLOWED };
  const note = text(form, "note");
  if (!note) return { error: "Write what happened first." };
  const supabase = await createClient();
  const inquiryId = text(form, "inquiry_id");
  const { error } = await supabase.from("inquiry_followups").insert({ inquiry_id: inquiryId, note });
  if (error) return { error: error.message };
  const next = text(form, "next_follow_up");
  if (next) {
    const upd = await supabase.from("inquiries").update({ next_follow_up: next }).eq("id", inquiryId);
    if (upd.error) return { error: `Note added, but the next follow-up date wasn't saved: ${upd.error.message}` };
  }
  refresh();
  return { ok: "Note added.", nonce: Date.now() };
}
