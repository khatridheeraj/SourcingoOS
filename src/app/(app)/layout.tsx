import { redirect } from "next/navigation";
import { HelpChat } from "@/components/help/help-chat";
import { Sidebar, type NavGroup } from "@/components/nav";
import { Toaster } from "@/components/toast";
import { OrderSheet } from "@/components/order-sheet";
import { SearchPalette } from "@/components/search";
import { QcSheet } from "@/components/qc-sheet";
import { canEditOrders, canEnterDone, canRecordQc, getMe, roleLabel } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { heldSince } from "@/lib/goods";
import { createClient } from "@/lib/supabase/server";
import { MARKERS_ON } from "@/lib/features";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  // A factory or buyer login only has its own page.
  if (me.role === "factory") redirect("/factory");
  if (me.role === "buyer") redirect("/buyer");

  // Buyer POs waiting for the orders team, and Help's counts, shown on the menu.
  const supabase = await createClient();
  const today = todayIST();
  const [pos, counts, due, held, samples] = await Promise.all([
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
    // Samples factories sent that the team hasn't checked and sent on yet.
    canEditOrders(me.role) && me.companyId
      ? supabase.from("sample_rounds").select("id", { count: "exact", head: true }).eq("company_id", me.companyId).eq("status", "with_team")
      : Promise.resolve({ count: 0 }),
  ]);
  const toCheck = pos.count ?? 0;
  const help = (counts.data ?? {}) as { unseen?: number; new?: number | null; owner?: string | null };

  const edit = canEditOrders(me.role);
  const money = me.role === "owner" || me.role === "accounts";
  // The menu follows the work: sell (inquiries, buyer POs), make (orders, samples, chasing), ship, money,
  // then the records everything hangs off. On a phone the first few sit in the tab bar.
  const home = { href: "/today", label: "Home", icon: "home" as const };
  const orders = { href: "/", label: "Orders", icon: "orders" as const };
  const inbox = { href: "/pos", label: "Buyer POs", icon: "inbox" as const, count: toCheck };
  const samplesItem = { href: "/samples", label: "Samples", icon: "sample" as const, count: samples.count ?? 0 };
  const groups: NavGroup[] = [
    { items: [home, orders] },
    ...(edit ? [{ label: "Sell", items: [
      { href: "/inquiries", label: "Inquiries", icon: "inquiry" as const, count: due.count ?? 0 },
      inbox,
    ] }] : []),
    { label: "Make", items: [
      samplesItem,
      ...(edit ? [{ href: "/updates", label: "Chase and updates", icon: "share" as const }] : []),
    ] },
    ...(edit ? [{ label: "Ship", items: [{ href: "/goods", label: "Goods with us", icon: "box" as const, count: held.count ?? 0 }] }] : []),
    ...(money ? [{ label: "Money", items: [{ href: "/payments", label: "Payments", icon: "payments" as const }, { href: "/payables", label: "Bills to pay", icon: "bills" as const }, { href: "/tally", label: "Tally", icon: "tally" as const }] }] : []),
    { label: "Records", items: [
      ...(edit ? [{ href: "/buyers", label: "Buyers", icon: "buyers" as const }, { href: "/factories", label: "Factories", icon: "factories" as const },
        { href: "/styles", label: "Style catalogue", icon: "styles" as const }, { href: "/reports", label: "Reports", icon: "chart" as const },
        ...(MARKERS_ON ? [{ href: "/markers", label: "Markers", icon: "markers" as const }] : [])] : []),
      { href: "/brief", label: "Morning brief", icon: "sun" as const },
    ] },
    ...(me.role === "owner" ? [{ label: "Admin", items: [{ href: "/team", label: "Team", icon: "team" as const }, { href: "/activity", label: "Activity log", icon: "activity" as const },
      { href: "/feedback", label: "Team notes", icon: "notes" as const, count: help.new ?? 0 }] }] : []),
  ];
  // Phone tab bar: Home, Orders, New, then the screen each role opens most.
  const tabs = edit ? [home, orders, inbox] : [home, orders, samplesItem];
  // Everything that starts a piece of work, in one place.
  const create = [
    ...(edit ? [
      { href: "/orders/new", label: "New order", icon: "orders" as const, hint: "From a buyer PO: styles, quantities, ship date" },
      { href: "/inquiries/new", label: "Log an inquiry", icon: "inquiry" as const, hint: "A buyer asked for prices or samples" },
      { href: "/pos", label: "Add a buyer PO", icon: "inbox" as const, hint: "A PO that came on WhatsApp or paper: upload its file" },
    ] : []),
    ...(money ? [
      { href: "/payments/cheques/new", label: "Add a cheque", icon: "payments" as const, hint: "A cheque received from a buyer" },
      { href: "/payments/invoices/new", label: "Add an invoice", icon: "bills" as const, hint: "Our sales invoice to a buyer" },
    ] : []),
  ];

  return (
    <div className="shell">
      {me.role && <Sidebar groups={groups} tabs={tabs} create={create} user={me.fullName || me.email} role={roleLabel(me.role)} company={me.companyName ?? ""} helpUnseen={help.unseen ?? 0} />}
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
      {canEnterDone(me.role) && <OrderSheet />}
      <SearchPalette groups={groups} />
      {canRecordQc(me.role) && <QcSheet />}
      <Toaster />
    </div>
  );
}
