import { NO_COMPANY } from "@/lib/names";
import { buyerName, loadBuyers } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { addDays, sinceOf, weekOf } from "@/lib/buyer-week";
import { istDate, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type Sent = { via: string; at: string };
export type UpdateBuyer = { id: string; name: string; openOrders: number; sent: Sent | null; lastSent: string | null };

// The buyers who should hear from us this week: every active buyer with an open order, plus anyone already sent one
// this week. With when each was last sent an update, so the next one counts from there.
export async function loadUpdateBuyers(companyId: string | null | undefined): Promise<{ week: string; buyers: UpdateBuyer[] }> {
  const supabase = await createClient();
  const today = todayIST();
  const week = weekOf(today);
  const [buyers, { data: open }, { data: sent }] = await Promise.all([
    loadBuyers(),
    fetchAll((a, z) => supabase.from("orders").select("buyer_id").eq("company_id", companyId ?? NO_COMPANY).eq("status", "open").order("id").range(a, z)),
    supabase.from("buyer_updates").select("buyer_id, week_of, via, sent_at").eq("company_id", companyId ?? NO_COMPANY)
      .gte("week_of", addDays(week, -21)).order("sent_at"),
  ]);
  const count = new Map<string, number>();
  for (const o of open as { buyer_id: string }[]) count.set(o.buyer_id, (count.get(o.buyer_id) ?? 0) + 1);
  const rows = (sent ?? []) as { buyer_id: string; week_of: string; via: string; sent_at: string }[];
  const thisWeek = new Map(rows.filter((r) => r.week_of === week).map((r) => [r.buyer_id, { via: r.via, at: r.sent_at }]));
  // The last update before this week's (rows are oldest first); this week's own send doesn't move where it starts.
  const last = new Map<string, string>();
  for (const r of rows) if (r.week_of !== week) last.set(r.buyer_id, istDate(r.sent_at));
  const list = buyers.filter((b) => (b.active && count.has(b.id)) || thisWeek.has(b.id)).map((b) => ({
    id: b.id, name: buyerName(b), openOrders: count.get(b.id) ?? 0, sent: thisWeek.get(b.id) ?? null,
    lastSent: last.get(b.id) ?? null,
  }));
  return { week, buyers: list };
}

export const sinceFor = (b: UpdateBuyer) => (today: string) => sinceOf(today, b.lastSent);
