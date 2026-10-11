import { cache } from "react";
import type { Role } from "@/lib/auth-roles";
import { createClient } from "@/lib/supabase/server";

export { canEditOrders, canEnterDone, canRecordQc, ROLES, roleLabel, type Role } from "@/lib/auth-roles";

export type Me = { id: string; email: string; fullName: string | null; companyId: string | null; companyName: string | null; role: Role | null };

// The signed-in person and the company they are working in, read once per request.
// role is null until the owner adds them to a company.
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  if (!id) return null;
  const { data: p } = await supabase.from("profiles").select("email, full_name, current_company_id").eq("id", id).maybeSingle();
  const me: Me = { id, email: p?.email ?? String(data.claims.email ?? ""), fullName: p?.full_name ?? null, companyId: null, companyName: null, role: null };
  if (!p?.current_company_id) return me;
  const [{ data: m }, { data: c }] = await Promise.all([
    supabase.from("members").select("role, active").eq("company_id", p.current_company_id).eq("user_id", id).maybeSingle(),
    supabase.from("companies").select("name").eq("id", p.current_company_id).maybeSingle(),
  ]);
  if (!m?.active) return me;
  return { ...me, companyId: p.current_company_id, companyName: c?.name ?? null, role: m.role as Role };
});
