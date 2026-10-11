import { NO_COMPANY } from "@/lib/names";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Buyer = { id: string; code: string; city: string | null; notes: string | null; active: boolean; realName: string | null };
export type Factory = { id: string; name: string; city: string | null; contact_name: string | null; phone: string | null; notes: string | null; active: boolean };
export type Member = { user_id: string; role: string; active: boolean; factory_id: string | null; email: string; full_name: string | null };
export type Invite = { email: string; role: string; factory_id: string | null; created_at: string };

// Every list below is for the company the signed-in person is working in.
async function scope() {
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  return { companyId: me?.companyId ?? NO_COMPANY, supabase };
}

// Buyers by code. Real names come back only for the owner; the database hides them from everyone else.
export async function loadBuyers(): Promise<Buyer[]> {
  const { companyId, supabase } = await scope();
  const [{ data: buyers }, { data: names }] = await Promise.all([
    supabase.from("buyers").select("id, code, city, notes, active").eq("company_id", companyId).order("code"),
    supabase.from("buyer_names").select("buyer_id, real_name").eq("company_id", companyId),
  ]);
  const byId = new Map((names ?? []).map((n) => [n.buyer_id as string, n.real_name as string]));
  return (buyers ?? []).map((b) => ({ ...b, realName: byId.get(b.id) ?? null }));
}

export async function loadFactories(): Promise<Factory[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("factories").select("id, name, city, contact_name, phone, notes, active").eq("company_id", companyId).order("name");
  return data ?? [];
}

export async function loadTeam(): Promise<Member[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("members").select("user_id, role, active, factory_id, created_at, profiles(email, full_name)").eq("company_id", companyId).order("created_at");
  return (data ?? []).map((m) => {
    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { email: string; full_name: string | null } | null;
    return { user_id: m.user_id, role: m.role, active: m.active, factory_id: m.factory_id ?? null, email: p?.email ?? "", full_name: p?.full_name ?? null };
  });
}

export async function loadInvites(): Promise<Invite[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("invites").select("email, role, factory_id, created_at").eq("company_id", companyId).is("closed_at", null).order("created_at");
  return data ?? [];
}

export { personName } from "@/lib/names";
