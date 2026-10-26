import { NO_COMPANY } from "@/lib/names";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { factoryPace } from "@/lib/tna-plan";
import { isMsme45, MSME_DAYS, type Msme } from "@/lib/payables";

export type Buyer = { id: string; code: string; city: string | null; notes: string | null; active: boolean; grn_days: number | null; realName: string | null };
export type Factory = { id: string; name: string; city: string | null; contact_name: string | null; phone: string | null; notes: string | null; active: boolean; address: string | null; gstin: string | null; email: string | null };
export type Member = { user_id: string; role: string; active: boolean; factory_id: string | null; buyer_id: string | null; email: string; full_name: string | null };
export type Invite = { email: string; role: string; factory_id: string | null; buyer_id: string | null; created_at: string };

// Every list below is for the company the signed-in person is working in.
async function scope() {
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  return { companyId: me?.companyId ?? NO_COMPANY, supabase };
}

// The name a buyer is shown by. The team sees real names for now (Dheeraj, 15 Oct 2026); codes may come back later.
export const buyerName = (b: Pick<Buyer, "code" | "realName">) => b.realName ?? b.code;

// Buyers, A to Z by the name they are shown by. Factory logins can't read real names, so they never reach the factory panel.
export async function loadBuyers(): Promise<Buyer[]> {
  const { companyId, supabase } = await scope();
  const [{ data: buyers }, { data: names }] = await Promise.all([
    supabase.from("buyers").select("id, code, city, notes, active, grn_days").eq("company_id", companyId).order("code"),
    supabase.from("buyer_names").select("buyer_id, real_name").eq("company_id", companyId),
  ]);
  const byId = new Map((names ?? []).map((n) => [n.buyer_id as string, n.real_name as string]));
  return (buyers ?? []).map((b) => ({ ...b, realName: byId.get(b.id) ?? null }))
    .sort((a, z) => buyerName(a).localeCompare(buyerName(z), "en-IN", { sensitivity: "base" }));
}

export async function loadFactories(): Promise<Factory[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("factories").select("id, name, city, contact_name, phone, notes, active, address, gstin, email").eq("company_id", companyId).order("name");
  return data ?? [];
}

export async function loadTeam(): Promise<Member[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("members").select("user_id, role, active, factory_id, buyer_id, created_at, profiles(email, full_name)").eq("company_id", companyId).order("created_at");
  return (data ?? []).map((m) => {
    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { email: string; full_name: string | null } | null;
    return { user_id: m.user_id, role: m.role, active: m.active, factory_id: m.factory_id ?? null, buyer_id: m.buyer_id ?? null, email: p?.email ?? "", full_name: p?.full_name ?? null };
  });
}

export async function loadInvites(): Promise<Invite[]> {
  const { companyId, supabase } = await scope();
  const { data } = await supabase.from("invites").select("email, role, factory_id, buyer_id, created_at").eq("company_id", companyId).is("closed_at", null).order("created_at");
  return data ?? [];
}

export { personName } from "@/lib/names";

// How late each factory usually finishes a step, learnt from every finished step with a target on its orders.
export async function loadPace(): Promise<Map<string, number>> {
  const { companyId, supabase } = await scope();
  const { data } = await fetchAll((a, z) => supabase.from("line_stages").select("planned_on, done_on, order_lines!inner(factory_id)")
    .eq("company_id", companyId).not("done_on", "is", null).not("planned_on", "is", null).order("id").range(a, z));
  return factoryPace((data ?? []).map((r) => {
    const l = r.order_lines as unknown as { factory_id: string | null } | { factory_id: string | null }[] | null;
    return { factory_id: (Array.isArray(l) ? l[0]?.factory_id : l?.factory_id) ?? null, planned_on: r.planned_on, done_on: r.done_on };
  }));
}

// Days a buyer or factory is taken to pay when nothing is set for it.
export const USUAL_DAYS = 60;

// Payment days: each buyer's credit days, and each factory's days from its Tally ledger's terms, never past 45 for a
// micro or small MSME (the law). Money screens only; supplier terms are readable by the owner and Accounts.
export async function loadTerms() {
  const { companyId, supabase } = await scope();
  const [b, f, t] = await Promise.all([
    supabase.from("buyers").select("id, credit_days").eq("company_id", companyId),
    supabase.from("factories").select("id, tally_ledger").eq("company_id", companyId),
    supabase.from("supplier_terms").select("ledger, days, msme").eq("company_id", companyId),
  ]);
  const buyer = new Map((b.data ?? []).map((x) => [x.id as string, x.credit_days as number | null]));
  const ledger = new Map((f.data ?? []).map((x) => [x.id as string, x.tally_ledger as string | null]));
  const terms = new Map(((t.data ?? []) as { ledger: string; days: number | null; msme: Msme | null }[]).map((x) => [x.ledger, x]));
  return {
    buyerDays: (id: string) => buyer.get(id) ?? USUAL_DAYS,
    factoryDays: (id: string | null) => {
      const x = id ? terms.get(ledger.get(id) ?? "") : undefined;
      const d = x?.days ?? USUAL_DAYS;
      return isMsme45(x?.msme) ? Math.min(d, MSME_DAYS) : d;
    },
  };
}
