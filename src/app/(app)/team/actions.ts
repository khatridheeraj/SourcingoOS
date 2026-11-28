"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { PERMS, type Perms, roleLabel, STAFF_ROLES, type Role } from "@/lib/auth-roles";
import { friendly } from "@/lib/errors";
import { loadTeam } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { cleanWhatsapp } from "@/lib/roll-call";

const validRole = (r: string) => STAFF_ROLES.some((x) => x.value === r) || r === "factory" || r === "buyer";

export async function addPerson(email: string, role: string, factoryId = "", buyerId = ""): Promise<{ error?: string; ok?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner can add people." };
  if (!validRole(role)) return { error: "Pick a role." };
  const supabase = await createClient();
  if (role === "factory" && !factoryId) return { error: "Pick the factory this login is for." };
  if (role === "buyer" && !buyerId) return { error: "Pick the buyer this login is for." };
  // Adding someone who is already here must never quietly change their role or switch them back on: say so, and
  // point to their row, where a role change is a deliberate act.
  if (role !== "factory" && role !== "buyer") {
    const addr = email.trim().toLowerCase();
    const here = (await loadTeam()).find((m) => m.email.toLowerCase() === addr);
    if (here) {
      if (here.role === "factory" || here.role === "buyer") {
        return { error: `${addr} is a ${here.role} login here. Use a separate email for a team login.` };
      }
      const as = roleLabel(here.role as Role);
      if (!here.active) return { error: `${addr} is already on the team as ${as}, switched off. Tick "Can sign in" on their row below.` };
      return { error: here.role === role ? `${addr} is already on the team as ${as}.` : `${addr} is already on the team as ${as}. Change their role on their row below.` };
    }
  }
  const { data, error } = role === "factory"
    ? await supabase.rpc("add_factory_member", { p_email: email, p_factory: factoryId })
    : role === "buyer"
    ? await supabase.rpc("add_buyer_member", { p_email: email, p_buyer: buyerId })
    : await supabase.rpc("add_member", { p_email: email, p_role: role });
  if (error) return { error: friendly(error) };
  revalidatePath("/team");
  return {
    ok: data === "added"
      ? `${email.trim().toLowerCase()} is in. They can use the app now.`
      : `${email.trim().toLowerCase()} is added. They're in as soon as they sign in at this site with that email.`,
  };
}

export async function updateMember(userId: string, input: { role: string; active: boolean; whatsapp?: string; perms?: Perms }): Promise<{ error?: string; whatsapp?: string }> {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return { error: "Only the owner can change the team." };
  if (!validRole(input.role)) return { error: "Pick a role." };
  const supabase = await createClient();
  // The WhatsApp number the morning update ask tags them with. Saved first, so a bad number stops the whole save.
  let whatsapp: string | undefined;
  if (input.whatsapp !== undefined) {
    const n = cleanWhatsapp(input.whatsapp);
    if (n === null) return { error: "That isn't a WhatsApp number. Type the 10-digit mobile number, or + and the country code for other countries." };
    const { data: had } = await supabase.from("team_whatsapp").select("number").eq("company_id", me.companyId).eq("user_id", userId).maybeSingle();
    if ((had?.number ?? "") !== n) {
      const change = { number: n || null, updated_by: me.id, updated_at: new Date().toISOString() };
      const { error } = had
        ? await supabase.from("team_whatsapp").update(change).eq("company_id", me.companyId).eq("user_id", userId)
        : await supabase.from("team_whatsapp").insert({ company_id: me.companyId, user_id: userId, ...change });
      if (error) return { error: friendly(error) };
    }
    whatsapp = n;
  }
  const { error } = await supabase.from("members").update({ role: input.role, active: input.active }).eq("company_id", me.companyId).eq("user_id", userId);
  if (error) return { error: error.message.startsWith("There must") ? error.message : friendly(error), whatsapp };
  if (input.perms && input.role !== "owner") {
    // undefined means "follow the role", sent as null so the database clears the switch.
    const perms = Object.fromEntries(PERMS.map((p) => [p.key, input.perms![p.key] ?? null]));
    const { error: e } = await supabase.rpc("set_member_perms", { p_user: userId, p_perms: perms });
    if (e) return { error: friendly(e), whatsapp };
  }
  revalidatePath("/", "layout");
  return { whatsapp };
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
