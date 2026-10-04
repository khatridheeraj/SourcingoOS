"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type FactoryInput = { id?: string; name: string; city: string; contact_name: string; phone: string; notes: string; active: boolean };

export async function saveFactory(f: FactoryInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!f.name.trim()) return { error: "Enter the factory's name." };
  const row = {
    name: f.name.trim().replace(/\s+/g, " "),
    city: f.city.trim() || null,
    contact_name: f.contact_name.trim() || null,
    phone: f.phone.trim() || null,
    notes: f.notes.trim() || null,
    active: f.active,
  };
  const supabase = await createClient();
  const { error } = f.id ? await supabase.from("factories").update(row).eq("id", f.id) : await supabase.from("factories").insert(row);
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return {};
}
