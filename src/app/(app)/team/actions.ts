"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/auth-roles";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const validRole = (r: string) => STAFF_ROLES.some((x) => x.value === r) || r === "factory" || r === "buyer";

export async function addPerson(email: string, role: string, factoryId = "", buyerId = ""): Promise<{ error?: string; ok?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add people." };
  if (!validRole(role)) return { error: "Pick a role." };
  const supabase = await createClient();
  if (role === "factory" && !factoryId) return { error: "Pick the factory this login is for." };
  if (role === "buyer" && !buyerId) return { error: "Pick the buyer this login is for." };
  const { data, error } = role === "factory"
    ? await supabase.rpc("add_factory_member", { p_email: email, p_factory: factoryId })
    : role === "buyer"
    ? await supabase.rpc("add_buyer_member", { p_email: email, p_buyer: buyerId })
    : await supabase.rpc("add_member", { p_email: email, p_role: role });
  if (error) return { error: friendly(error) };
  revalidatePath("/team");
  return {
    ok: data === "added"
      ? `${email.trim()} is in. They can use the app now.`
      : `${email.trim()} is added. They're in as soon as they sign in at this site with that email.`,
  };
}

export async function updateMember(userId: string, input: { role: string; active: boolean }): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return { error: "Only the owner can change the team." };
  if (!validRole(input.role)) return { error: "Pick a role." };
  const supabase = await createClient();
  const { error } = await supabase.from("members").update({ role: input.role, active: input.active }).eq("company_id", me.companyId).eq("user_id", userId);
  if (error) return { error: error.message.startsWith("There must") ? error.message : friendly(error) };
  revalidatePath("/", "layout");
  return {};
}

export async function cancelInvite(email: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return { error: "Only the owner can change the team." };
  const supabase = await createClient();
  const { error } = await supabase.from("invites").update({ closed_at: new Date().toISOString() }).eq("company_id", me.companyId).eq("email", email);
  if (error) return { error: friendly(error) };
  revalidatePath("/team");
  return {};
}

export async function renameMe(fullName: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me) return { error: "Sign in first." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() || null }).eq("id", me.id);
  if (error) return { error: friendly(error) };
  revalidatePath("/", "layout");
  return {};
}
