import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/login");

  const supabase = await createClient();
  let waiting = 0;
  if (me.role === "owner") {
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("active", false);
    waiting = count ?? 0;
  }
  let openInquiries = 0;
  let followUpsDue = 0;
  if (isOps(me.role)) {
    const [open, due] = await Promise.all([
      supabase.from("inquiries").select("id", { count: "exact", head: true }).in("status", ["new", "quoted"]),
      supabase.from("inquiries").select("id", { count: "exact", head: true }).in("status", ["new", "quoted"]).lte("next_follow_up", todayIST()),
    ]);
    openInquiries = open.count ?? 0;
    followUpsDue = due.count ?? 0;
  }

  return (
    <div className="flex flex-col gap-6">

      {waiting > 0 && (
        <Link href="/team" className="rounded-xl bg-accent-soft p-4 font-semibold">
          {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting for you to approve them →
        </Link>
      )}

      {isOps(me.role) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/inquiries?status=open" className="rounded-xl bg-accent-soft p-4">
            <span className="text-sm font-semibold text-muted">Open inquiries</span>
            <b className="block text-3xl">{openInquiries}</b>
          </Link>
          <Link href="/inquiries?status=due" className={`rounded-xl p-4 ${followUpsDue ? "bg-bad text-white" : "border border-line bg-surface"}`}>
            <span className={`text-sm font-semibold ${followUpsDue ? "" : "text-muted"}`}>Follow-ups due today</span>
            <b className="block text-3xl">{followUpsDue}</b>
          </Link>
        </div>
      )}

      {me.role ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">You&apos;re signed in</h2>
          <p className="text-muted">Sales orders, TNA and the warehouse screens are being moved here next.</p>
        </section>
      ) : (
        <section className="rounded-xl bg-warn-soft p-5 text-warn">
          <h2 className="text-lg font-bold">Waiting for approval</h2>
          <p>Your account is set up. The owner needs to give you a role before you can see any orders.</p>
        </section>
      )}
    </div>
  );
}
