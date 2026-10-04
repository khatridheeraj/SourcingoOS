import { cache } from "react";
import { todayIST } from "@/lib/format";
import { isInternal, isOps, type Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type Badges = Record<string, { n: number; hot: boolean }>;

// Small counts for the sidebar badges. Each query is a head-only count.
export const navCounts = cache(async (role: Role | null): Promise<Badges> => {
  const out: Badges = {};
  if (!isInternal(role)) return out;
  const supabase = await createClient();
  const today = todayIST();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [pendingGrn, oldGrn] = await Promise.all([
    count(supabase.from("grns").select("id", { count: "exact", head: true }).eq("status", "pending_approval")),
    count(supabase.from("goods_held").select("grn_id", { count: "exact", head: true }).gt("units_held", 0).lt("received_at", dayAgo)),
  ]);
  out.grn = { n: oldGrn || pendingGrn, hot: oldGrn > 0 || (role === "owner" && pendingGrn > 0) };

  if (isOps(role)) {
    const [open, due, review, overdue] = await Promise.all([
      count(supabase.from("inquiries").select("id", { count: "exact", head: true }).in("status", ["new", "quoted"])),
      count(supabase.from("inquiries").select("id", { count: "exact", head: true }).in("status", ["new", "quoted"]).lte("next_follow_up", today)),
      count(supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("status", "tna_review")),
      count(
        supabase.from("tna_checkpoints").select("id, so_styles!inner(sales_orders!inner(status))", { count: "exact", head: true })
          .neq("status", "completed").lt("due_date", today).eq("so_styles.sales_orders.status", "locked"),
      ),
    ]);
    out.inquiries = { n: open, hot: due > 0 };
    out.review = { n: review, hot: role === "owner" && review > 0 };
    out.alerts = { n: overdue + oldGrn, hot: overdue + oldGrn > 0 };
  }
  return out;
});
