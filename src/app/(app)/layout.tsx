import { redirect } from "next/navigation";
import { Shell } from "@/components/sidebar";
import { getMe, roleLabel } from "@/lib/auth";
import { navCounts } from "@/lib/counts";
import { loadBooks, loadWorld } from "@/lib/data";
import { FINANCE_ACTIONS, isLive, navFor, QUICK_ACTIONS } from "@/lib/nav";
import { paymentBadge } from "@/lib/payments";
import { isFinance, isInternal, isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role === "factory") redirect("/factory");
  if (me.role === "buyer") redirect("/buyer");
  const badges = isInternal(me.role) ? navCounts((await loadWorld()).world, me.role) : {};
  const pay = isFinance(me.role) ? paymentBadge((await loadBooks()).books) : null;
  if (pay) badges.payments = pay;
  const supabase = await createClient();
  const [pos, unread, fb] = await Promise.all([
    // New buyer POs from email that nobody has picked up yet.
    isOps(me.role) && isLive("/pos") ? supabase.from("received_pos").select("id", { count: "exact", head: true }).eq("status", "new") : null,
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", me.id).is("read_at", null),
    me.role === "owner" && isLive("/feedback") ? supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "new") : null,
  ]);
  if (pos?.count) badges.pos = { n: pos.count, hot: true };
  if (fb?.count) badges.feedback = { n: fb.count, hot: false };
  const who = `${me.fullName || me.email}${me.role ? ` · ${roleLabel(me.role)}` : ""}`;
  return (
    <Shell nav={navFor(me.role)} badges={badges} who={who} unread={unread.count ?? 0} actions={[...(isOps(me.role) ? QUICK_ACTIONS : []), ...(isFinance(me.role) ? FINANCE_ACTIONS : [])]}>
      {children}
    </Shell>
  );
}
