import type { createClient } from "@/lib/supabase/server";
import { toProfile, type BuyerBasics, type BuyerDoc, type BuyerProfile } from "./buyer-profile";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type BuyerFile = { profile: BuyerProfile; basics: BuyerBasics; docs: BuyerDoc[] };

// Buyers' details and papers, for people with Buyer details (the database returns nothing to anyone else, so every
// buyer then reads as empty and screens show nothing about it).
export async function loadBuyerFiles(supabase: Supa, ids?: string[]): Promise<Map<string, BuyerFile>> {
  let pq = supabase.from("buyer_profiles").select("*");
  let dq = supabase.from("buyer_documents").select("id, buyer_id, kind, path, file_name, by_buyer, added_at").is("removed_at", null).order("added_at");
  if (ids) { pq = pq.in("buyer_id", ids); dq = dq.in("buyer_id", ids); }
  const [{ data: rows }, { data: docs }, { data: basics }] = await Promise.all([
    pq, dq,
    supabase.rpc("buyer_details", ids ? { p_ids: ids } : {}),
  ]);
  // Currency and credit days are on the buyer itself and readable by the team.
  const bq = supabase.from("buyers").select("id, currency, credit_days");
  const { data: money } = await (ids ? bq.in("id", ids) : bq);
  const out = new Map<string, BuyerFile>();
  const addr = new Map(((basics ?? []) as { id: string; delivery_address: string | null }[]).map((d) => [d.id, d.delivery_address]));
  for (const b of money ?? []) {
    out.set(b.id, { profile: toProfile(null), basics: { delivery_address: addr.get(b.id) ?? null, currency: b.currency, credit_days: b.credit_days }, docs: [] });
  }
  for (const r of rows ?? []) { const f = out.get(r.buyer_id); if (f) f.profile = toProfile(r); }
  for (const d of (docs ?? []) as (BuyerDoc & { buyer_id: string })[]) out.get(d.buyer_id)?.docs.push(d);
  return out;
}
