"use server";

import { revalidatePath } from "next/cache";
import { getMe, ROLES, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SaveState = { ok?: string; error?: string };

// Turns database errors into something the owner can act on.
function friendly(message: string) {
  if (message.includes("factory_users_have_factory")) return "Pick which factory this person works for.";
  if (message.includes("buyer_users_have_buyer")) return "Pick which buyer this person belongs to.";
  return message;
}

export async function saveProfile(_prev: SaveState, form: FormData): Promise<SaveState> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can change roles." };

  const id = String(form.get("id") ?? "");
  const roleValue = String(form.get("role") ?? "");
  const role = ROLES.some((r) => r.value === roleValue) ? (roleValue as Role) : null;
  const active = form.get("active") === "on";
  if (active && !role) return { error: "Choose a role before giving access." };

  const update = {
    role,
    active,
    factory_id: role === "factory" ? String(form.get("factory_id") || "") || null : null,
    buyer_id: role === "buyer" ? String(form.get("buyer_id") || "") || null : null,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update(update).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "That person no longer exists. Reload the page." };

  revalidatePath("/team");
  revalidatePath("/");
  return { ok: active ? "Saved. They can use Sourcingo OS now." : "Saved. They have no access." };
}
