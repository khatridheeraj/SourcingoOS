"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { canManageFactories } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok?: string; error?: string; nonce?: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const opt = (form: FormData, key: string) => text(form, key) || null;
const upper = (form: FormData, key: string) => text(form, key).toUpperCase().replace(/\s+/g, "") || null;
const done = (ok: string): FormState => {
  revalidatePath("/", "layout");
  return { ok, nonce: Date.now() };
};
// Database check names, said in plain words.
function friendly(msg: string) {
  if (/gstin/i.test(msg)) return "GSTIN should be 15 characters, like 08ABCDE1234F1Z5.";
  if (/pan/i.test(msg)) return "PAN should be 10 characters, like ABCDE1234F.";
  if (/ifsc/i.test(msg)) return "IFSC should be 11 characters, like HDFC0001234.";
  if (/email/i.test(msg)) return "Check the email address.";
  return msg;
}

export async function saveFactory(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (!canManageFactories(me?.role)) return { error: "Only the owner or a merchandiser manager can change factories." };
  const id = text(form, "id");
  const cap = text(form, "capacity_per_month");
  const row = {
    name: text(form, "name"), city: opt(form, "city"), contact: opt(form, "contact"), address: opt(form, "address"),
    phone: opt(form, "phone"), email: opt(form, "email"), gstin: upper(form, "gstin"), state: opt(form, "state"), pan: upper(form, "pan"),
    bank_name: opt(form, "bank_name"), bank_account: opt(form, "bank_account"), bank_ifsc: upper(form, "bank_ifsc"),
    default_payment_terms: opt(form, "default_payment_terms"),
    categories: text(form, "categories").split(",").map((c) => c.trim()).filter(Boolean),
    capacity_per_month: cap ? Math.max(0, Math.round(Number(cap))) || null : null,
    notes: opt(form, "notes"),
  };
  if (!row.name) return { error: "Enter the factory name." };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("factories").update(row).eq("id", id) : await supabase.from("factories").insert(row);
  if (error?.code === "23505") return { error: `${row.name} is already in the list.` };
  if (error) return { error: friendly(error.message) };
  return done(id ? `Saved ${row.name}.` : `Added ${row.name}.`);
}

export async function setFactoryActive(id: string, active: boolean): Promise<FormState> {
  const me = await getMe();
  if (!canManageFactories(me?.role)) return { error: "Only the owner or a merchandiser manager can change factories." };
  const supabase = await createClient();
  const { error } = await supabase.from("factories").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  return done(active ? "Factory is active again." : "Factory hidden from new orders. Existing orders keep it.");
}

export async function addBuyer(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add buyers." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_buyer", {
    p_real_name: text(form, "real_name"), p_initials: text(form, "initials") || null,
    p_payment_terms: text(form, "payment_terms") || null, p_address: text(form, "address") || null,
  });
  if (error) return { error: error.message };
  return done(`${text(form, "real_name")} is now ${data}.`);
}

export async function saveBuyer(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can change buyers." };
  const id = text(form, "id");
  const realName = text(form, "real_name");
  if (!realName) return { error: "The real name can't be empty." };
  const supabase = await createClient();
  const { error } = await supabase.from("buyers").update({
    default_payment_terms: opt(form, "payment_terms"), default_address: opt(form, "address"), gstin: upper(form, "gstin"), state: opt(form, "state"),
  }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  const reg = await supabase.from("buyer_registry").upsert({
    buyer_id: id, real_name: realName, billing_address: opt(form, "billing_address"), contact_name: opt(form, "contact_name"),
    contact_email: opt(form, "contact_email"), contact_phone: opt(form, "contact_phone"), notes: opt(form, "notes"),
  });
  if (reg.error?.code === "23505") return { error: `${realName} already belongs to another buyer code.` };
  if (reg.error) return { error: friendly(reg.error.message) };
  return done("Saved.");
}

export async function saveCompany(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can change the company details." };
  const row = {
    legal_name: text(form, "legal_name"), trade_name: text(form, "trade_name"), address: opt(form, "address"), gstin: upper(form, "gstin"),
    pan: upper(form, "pan"), phone: opt(form, "phone"), email: opt(form, "email"), website: opt(form, "website"),
    bank_name: opt(form, "bank_name"), bank_account: opt(form, "bank_account"), bank_ifsc: upper(form, "bank_ifsc"),
    po_terms: opt(form, "po_terms"), so_terms: opt(form, "so_terms"),
  };
  if (!row.legal_name || !row.trade_name) return { error: "Enter the legal and trade names." };
  const supabase = await createClient();
  const { error } = await supabase.from("company_profile").update(row).eq("id", true);
  if (error) return { error: friendly(error.message) };
  return done("Company details saved. They print on every PO and challan.");
}

export type TemplateInput = { id?: string; name: string; order_type: "garment" | "fabric"; steps: { name: string; days: number }[]; is_default: boolean; active: boolean };

export async function saveTemplate(t: TemplateInput): Promise<FormState> {
  const me = await getMe();
  if (!canManageFactories(me?.role)) return { error: "Only the owner or a merchandiser manager can change TNA templates." };
  if (!t.name.trim()) return { error: "Name the template." };
  const steps = t.steps.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), days: Math.round(Number(s.days)) }));
  if (!steps.length) return { error: "Add at least one step." };
  const supabase = await createClient();
  // Only one default per order type: clear the old one first.
  if (t.is_default) {
    const { error } = await supabase.from("tna_templates").update({ is_default: false }).eq("order_type", t.order_type).eq("is_default", true).neq("id", t.id ?? "00000000-0000-0000-0000-000000000000");
    if (error) return { error: error.message };
  }
  const row = { name: t.name.trim(), order_type: t.order_type, steps, is_default: t.is_default, active: t.active };
  const { error } = t.id ? await supabase.from("tna_templates").update(row).eq("id", t.id) : await supabase.from("tna_templates").insert(row);
  if (error?.code === "23505") return { error: `A template called ${row.name} already exists.` };
  if (error) return { error: error.message };
  return done(`Saved ${row.name}.`);
}
