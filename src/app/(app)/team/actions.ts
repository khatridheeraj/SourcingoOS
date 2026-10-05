"use server";

import { revalidatePath } from "next/cache";
import { getMe, ROLES } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const validRole = (r: string) => ROLES.some((x) => x.value === r);

export async function addPerson(email: string, role: string): Promise<{ error?: string; ok?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add people." };
  if (!validRole(role)) return { error: "Pick a role." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_member", { p_email: email, p_role: role });
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
  const { error } = await supabase.from("invites").delete().eq("company_id", me.companyId).eq("email", email);
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
