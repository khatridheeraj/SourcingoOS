import { redirect } from "next/navigation";
import { HelpChat } from "@/components/help/help-chat";
import { Sidebar, type NavGroup } from "@/components/nav";
import { Toaster } from "@/components/toast";
import { canEditOrders, getMe, roleLabel } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { heldSince } from "@/lib/goods";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  // A factory or buyer login only has its own page.
  if (me.role === "factory") redirect("/factory");
  if (me.role === "buyer") redirect("/buyer");

  // Buyer POs waiting for the orders team, and Help's counts, shown on the menu.
  const supabase = await createClient();
  const today = todayIST();
  const [pos, counts, due, held] = await Promise.all([
    canEditOrders(me.role) && me.companyId
      ? supabase.from("incoming_pos").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).in("status", ["to_check", "failed"])
      : Promise.resolve({ count: 0 }),
    me.role ? supabase.rpc("help_counts") : Promise.resolve({ data: null }),
    // Inquiries whose follow-up is due today or earlier.
    canEditOrders(me.role) && me.companyId
      ? supabase.from("inquiries").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).in("status", ["new", "quoted"]).lte("next_follow_up", today)
      : Promise.resolve({ count: 0 }),
    // Goods bought from a factory and still with us after a day.
    canEditOrders(me.role) && me.companyId
      ? supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).is("cancelled_at", null).is("shipped_at", null)
        .lt("purchased_at", heldSince())
      : Promise.resolve({ count: 0 }),
  ]);
  const toCheck = pos.count ?? 0;
  const help = (counts.data ?? {}) as { unseen?: number; new?: number | null; owner?: string | null };

  const edit = canEditOrders(me.role);
  const money = me.role === "owner" || me.role === "accounts";
  const groups: NavGroup[] = [
    { items: [
      { href: "/today", label: "Home", icon: "home" },
      { href: "/", label: "Orders", icon: "orders" },
      ...(edit ? [{ href: "/inquiries", label: "Inquiries", icon: "inquiry" as const, count: due.count ?? 0 },
        { href: "/pos", label: "Incoming POs", icon: "inbox" as const, count: toCheck },
        { href: "/goods", label: "Goods with us", icon: "box" as const, count: held.count ?? 0 }] : []),
      { href: "/brief", label: "Brief", icon: "sun" as const },
    ] },
    ...(edit ? [{ label: "Partners", items: [{ href: "/buyers", label: "Buyers", icon: "buyers" as const }, { href: "/factories", label: "Factories", icon: "factories" as const }] }] : []),
    ...(edit ? [{ label: "Tools", items: [{ href: "/styles", label: "Style catalogue", icon: "styles" as const }, { href: "/reports", label: "Reports", icon: "chart" as const },
      { href: "/markers", label: "Markers", icon: "markers" as const }] }] : []),
    ...(money ? [{ label: "Finance", items: [{ href: "/payments", label: "Payments", icon: "payments" as const }, { href: "/tally", label: "Tally", icon: "tally" as const }] }] : []),
    ...(me.role === "owner" ? [{ label: "Admin", items: [{ href: "/team", label: "Team", icon: "team" as const }, { href: "/activity", label: "Activity log", icon: "activity" as const },
      { href: "/feedback", label: "Team notes", icon: "notes" as const, count: help.new ?? 0 }] }] : []),
  ];

  return (
    <div className="shell">
      {me.role && <Sidebar groups={groups} user={me.fullName || me.email} role={roleLabel(me.role)} company={me.companyName ?? ""} helpUnseen={help.unseen ?? 0} />}
      <main className="page">
        {me.role ? children : (
          <div className="empty mt-10">
            <b>You haven&apos;t been added to a company yet</b>
            You are signed in as {me.email}. Ask the owner to add this email in Team, then refresh this page.
          </div>
        )}
      </main>
      {me.role && me.companyId && (
        <HelpChat who="staff" role={me.role} name={me.fullName ?? ""} userId={me.id} companyId={me.companyId} ownerName={me.role === "owner" ? "Claude" : help.owner || "the owner"} unseen={help.unseen ?? 0} />
      )}
      <Toaster />
    </div>
  );
}
