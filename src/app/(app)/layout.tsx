import { redirect } from "next/navigation";
import { Sidebar, type NavGroup } from "@/components/nav";
import { canEditOrders, getMe, roleLabel } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  // A factory login only has its own panel.
  if (me.role === "factory") redirect("/factory");

  // Buyer POs waiting for the orders team, shown on the menu.
  let toCheck = 0;
  if (canEditOrders(me.role) && me.companyId) {
    const supabase = await createClient();
    const { count } = await supabase.from("incoming_pos").select("id", { count: "exact", head: true })
      .eq("company_id", me.companyId).in("status", ["to_check", "failed"]);
    toCheck = count ?? 0;
  }

  const edit = canEditOrders(me.role);
  const money = me.role === "owner" || me.role === "accounts";
  const groups: NavGroup[] = [
    { items: [
      { href: "/today", label: "Home", icon: "home" },
      { href: "/", label: "Orders", icon: "orders" },
      ...(edit ? [{ href: "/pos", label: "Incoming POs", icon: "inbox" as const, count: toCheck }] : []),
    ] },
    ...(edit ? [{ label: "Partners", items: [{ href: "/buyers", label: "Buyers", icon: "buyers" as const }, { href: "/factories", label: "Factories", icon: "factories" as const }] }] : []),
    ...(money ? [{ label: "Finance", items: [{ href: "/payments", label: "Payments", icon: "payments" as const }, { href: "/tally", label: "Tally", icon: "tally" as const }] }] : []),
    ...(me.role === "owner" ? [{ label: "Admin", items: [{ href: "/team", label: "Team", icon: "team" as const }, { href: "/activity", label: "Activity log", icon: "activity" as const }] }] : []),
  ];

  return (
    <div className="shell">
      {me.role && <Sidebar groups={groups} user={me.fullName || me.email} role={roleLabel(me.role)} company={me.companyName ?? ""} />}
      <main className="page">
        {me.role ? children : (
          <div className="empty mt-10">
            <b>You haven&apos;t been added to a company yet</b>
            You are signed in as {me.email}. Ask the owner to add this email in Team, then refresh this page.
          </div>
        )}
      </main>
    </div>
  );
}
