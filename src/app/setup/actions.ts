"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { canManageFactories } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok?: string; error?: string; nonce?: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const done = (ok: string): FormState => {
  revalidatePath("/setup");
  return { ok, nonce: Date.now() };
};

export async function saveFactory(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await getMe();
  if (!canManageFactories(me?.role)) return { error: "Only the owner or a merchandiser manager can change factories." };

  const id = text(form, "id");
  const row = {
    name: text(form, "name"),
    city: text(form, "city") || null,
    contact: text(form, "contact") || null,
    address: text(form, "address") || null,
  };
  if (!row.name) return { error: "Enter the factory name." };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("factories").update(row).eq("id", id)
    : await supabase.from("factories").insert(row);
  if (error?.code === "23505") return { error: `${row.name} is already in the list.` };
  if (error) return { error: error.message };
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
    p_real_name: text(form, "real_name"),
    p_initials: text(form, "initials") || null,
    p_payment_terms: text(form, "payment_terms") || null,
    p_address: text(form, "address") || null,
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
  const { error } = await supabase
    .from("buyers")
    .update({ default_payment_terms: text(form, "payment_terms") || null, default_address: text(form, "address") || null })
    .eq("id", id);
  if (error) return { error: error.message };
  const reg = await supabase.from("buyer_registry").upsert({ buyer_id: id, real_name: realName });
  if (reg.error?.code === "23505") return { error: `${realName} already belongs to another buyer code.` };
  if (reg.error) return { error: reg.error.message };
  return done("Saved.");
}
