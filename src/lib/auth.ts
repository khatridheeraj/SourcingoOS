import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export { ROLES, roleLabel, type Role } from "@/lib/roles";

export type Me = { id: string; email: string; fullName: string | null; role: Role | null; active: boolean };

// The signed-in user's profile, read once per request.
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims.sub;
  if (!id) return null;
  const { data: p } = await supabase.from("profiles").select("email, full_name, role, active").eq("id", id).maybeSingle();
  if (!p) return null;
  return { id, email: p.email, fullName: p.full_name, role: p.active ? p.role : null, active: p.active };
});
