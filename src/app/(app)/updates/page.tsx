import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { buildUpdates } from "@/lib/updates";
import { UpdatesView } from "./updates-view";

// The day's messages in one place: chase every factory that is behind, and send each buyer where their orders stand.
export default async function UpdatesPage({ searchParams }: PageProps<"/updates">) {
  const sp = await searchParams;
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/today");
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const today = todayIST();
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const [{ data: all, error }, buyers, factories, { data: chases }] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, order_lines(id, style, colour, qty, factory_id, position)")
      .eq("company_id", companyId).eq("status", "open").is("order_lines.removed_at", null).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
    supabase.from("factory_chases").select("factory_id").gte("chased_at", dayStart),
  ]);
  const mineCount = (all ?? []).filter((o) => o.merchandiser_id === me?.id).length;
  const who = sp.who === "all" || sp.who === "mine" ? sp.who : me?.role === "merchandiser" && mineCount ? "mine" : "all";
  const orders = (all ?? []).filter((o) => who === "all" || o.merchandiser_id === me?.id)
    .map((o) => ({ ...o, order_lines: [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position) }));
  const ids = orders.map((o) => o.id);
  const [{ data: stages, error: e2 }, { data: pos, error: e3 }] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, label, planned_on, done_on, not_needed").in("order_id", ids).order("id").range(a, z)),
        fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id, released_at, buffer_days").in("order_id", ids).order("id").range(a, z)),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const names = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const { chases: factoryList, buyers: buyerList } = buildUpdates({
    orders, stages: stages ?? [], pos: pos ?? [], factories, buyerName: (id) => names.get(id) ?? "Buyer",
    chased: new Set((chases ?? []).map((c) => c.factory_id)), today,
  });
  const tab = sp.tab === "buyers" ? "buyers" : "factories";
  const failed = error || e2 || e3;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Updates</h1>
          <p>Chase every factory that is behind, and tell each buyer where their orders stand. One tap each, the message is written.</p>
        </div>
        {mineCount > 0 && (
          <nav className="seg" aria-label="Whose orders">
            <Link href={`/updates?who=mine&tab=${tab}`} aria-current={who === "mine" ? "page" : undefined}>My orders</Link>
            <Link href={`/updates?who=all&tab=${tab}`} aria-current={who === "all" ? "page" : undefined}>Everyone&apos;s</Link>
          </nav>
        )}
      </div>
      {failed && <div className="errbox">Some orders couldn&apos;t load, so these messages may be missing something. Reload to try again.</div>}
      <UpdatesView tab={tab} who={who} factories={factoryList} buyers={buyerList} />
    </>
  );
}
