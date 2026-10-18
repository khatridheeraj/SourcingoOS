"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export type FactoryInput = { id?: string; name: string; city: string; contact_name: string; phone: string; notes: string; active: boolean };

export async function saveFactory(f: FactoryInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me?.role) return { error: "Your account is not switched on yet." };
  if (!canEditOrders(me.role)) return { error: "Only the orders team can change factories." };
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

// The factory's WhatsApp link: opening it signs the phone in to that factory's panel. The same link is given each
// time until a new one is made, which stops the old one and signs out every phone that used it.
export async function factoryLink(factoryId: string, renew = false): Promise<{ url?: string; error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can send a factory its link." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("factory_link", { p_factory: factoryId, p_renew: renew });
  if (error || typeof data !== "string") return { error: error ? friendly(error) : "Couldn't make the link. Try again." };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "sourcingo-os.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  if (renew) revalidatePath("/factories");
  return { url: `${proto}://${host}/f/${data}` };
}
