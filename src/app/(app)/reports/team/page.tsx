import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { isPartner, roleLabel, type Role } from "@/lib/auth-roles";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { dayTimeNear, dueDate, nowMs, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { buildBoard, canLead, countBy } from "@/lib/team-board";
import { PageTabs } from "@/components/page-tabs";
import { reportTabs } from "@/lib/page-groups";
import { HandOver } from "./hand-over";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Who on the team is carrying what: their open orders, what is late, notes waiting on them and when they last worked
// in the app. The owner or a manager hands a person's orders to someone else from here.
export default async function TeamBoardPage() {
  const me = await getMe();
  if (!canLead(me?.role) || !me?.companyId) redirect("/reports");
  const supabase = await createClient();
  const today = todayIST();
  const now = nowMs();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(now - 30 * 86_400_000).toISOString();
  const [team, buyers, { data: orders }, { data: tags }, { data: hist }, { data: floor }, { data: qc }] = await Promise.all([
    loadTeam(),
    loadBuyers(),
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id")
      .eq("company_id", me.companyId!).eq("status", "open").is("removed_at", null).order("id").range(a, z)),
    supabase.from("order_notes").select("mentions, done_by").eq("company_id", me.companyId).gte("created_at", monthAgo),
    fetchAll((a, z) => supabase.from("history").select("actor, at").eq("company_id", me.companyId!).gte("at", monthAgo).not("actor", "is", null).order("id").range(a, z)),
    supabase.from("floor_updates").select("created_by").eq("company_id", me.companyId).gte("created_at", weekAgo),
    supabase.from("qc_checks").select("checked_by").eq("company_id", me.companyId).gte("created_at", weekAgo).is("cancelled_at", null),
  ]);
  const ids = (orders ?? []).map((o) => o.id);
  const { data: overdue } = ids.length
    ? await fetchAll((a, z) => supabase.from("line_stages").select("order_id").in("order_id", ids).lt("planned_on", today).is("done_on", null).eq("not_needed", false).order("id").range(a, z))
    : { data: [] };
  const overdueBy = countBy(overdue ?? [], (r) => r.order_id);
  const people = team.filter((m) => m.active && !isPartner(m.role as Role)).map((m) => ({ id: m.user_id, name: personName(m), role: m.role }));
  const lastAt = new Map<string, string>();
  for (const h of hist ?? []) if (h.actor && (!lastAt.has(h.actor) || h.at > lastAt.get(h.actor)!)) lastAt.set(h.actor, h.at);
  const openTags = new Map<string, number>();
  for (const n of tags ?? []) for (const u of n.mentions as string[]) if (!(n.done_by as string[]).includes(u)) openTags.set(u, (openTags.get(u) ?? 0) + 1);
  const rows = buildBoard({
    people, now, tags: openTags, lastAt,
    orders: (orders ?? []).map((o) => { const d = dueDate(o); return { id: o.id, merchandiser_id: o.merchandiser_id, due: d, late: !!d && d < today, overdueSteps: overdueBy.get(o.id) ?? 0 }; }),
    edits7: countBy((hist ?? []).filter((h) => h.at >= weekAgo), (h) => h.actor),
    floor7: countBy(floor ?? [], (r) => r.created_by), qc7: countBy(qc ?? [], (r) => r.checked_by),
  });
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const unowned = (orders ?? []).filter((o) => !o.merchandiser_id || !people.some((p) => p.id === o.merchandiser_id));
  const takers = people.filter((p) => ["owner", "manager", "merchandiser"].includes(p.role));
  const orderList = (pid: string) => (orders ?? []).filter((o) => o.merchandiser_id === pid)
    .map((o) => ({ id: o.id, label: `${o.order_no} · ${buyerOf.get(o.buyer_id) ?? ""}`, late: (dueDate(o) ?? "9") < today }));

  return (
    <>
      <PageTabs tabs={reportTabs(me?.role)} label="Reports" />
      <div className="head">
        <div className="grow">
          <h1>Team</h1>
          <p>What each person is carrying right now. Red means an order of theirs is past its ship date.</p>
        </div>
      </div>

      {unowned.length > 0 && (
        <div className="warnbox mb-4">
          <b>{plural(unowned.length, "open order")} {unowned.length === 1 ? "has" : "have"} nobody looking after {unowned.length === 1 ? "it" : "them"}:</b>{" "}
          {unowned.slice(0, 6).map((o, i) => <span key={o.id}>{i > 0 && ", "}<Link href={`/orders/${o.id}#details`} className="link">{o.order_no}</Link></span>)}
          {unowned.length > 6 && ` and ${unowned.length - 6} more`}. Open each and pick a merchandiser under Details.
        </div>
      )}

      <ul className="tb">
        {rows.map((r) => (
          <li key={r.id} className="card tb-card">
            <div className="tb-head">
              <span className={`sev ${r.tone}`} aria-hidden />
              <div className="min-w-0 grow">
                <b>{r.name}{r.id === me.id && <span className="muted"> (you)</span>}</b>
                <small>{roleLabel(r.role as Role)} · {r.lastAt ? `last worked in the app ${dayTimeNear(r.lastAt, today)}` : "no work in the app in 30 days"}</small>
              </div>
            </div>
            <dl className="tb-stats">
              {r.role === "quality" ? (
                <>
                  <div><dt>Floor updates</dt><dd className="num">{r.floor7}</dd><small>7 days</small></div>
                  <div><dt>QC checks</dt><dd className="num">{r.qc7}</dd><small>7 days</small></div>
                </>
              ) : r.role === "accounts" ? null : (
                <>
                  <div><dt>Open orders</dt><dd className="num">{r.orders}</dd></div>
                  <div><dt>Past ship date</dt><dd className={`num ${r.late ? "text-bad" : ""}`}>{r.late}</dd></div>
                  <div><dt>Steps past target</dt><dd className={`num ${r.overdueSteps ? "text-warn" : ""}`}>{r.overdueSteps}</dd></div>
                </>
              )}
              <div><dt>Notes waiting</dt><dd className={`num ${r.tags ? "text-warn" : ""}`}>{r.tags}</dd></div>
              <div><dt>Edits</dt><dd className="num">{r.edits7}</dd><small>7 days</small></div>
            </dl>
            {r.orders > 0 && <HandOver fromId={r.id} fromName={r.name} orders={orderList(r.id)} takers={takers.filter((t) => t.id !== r.id)} />}
          </li>
        ))}
      </ul>
      <details className="howto mt-4">
        <summary>How this is counted</summary>
        <p>Open orders are the ones whose merchandiser is this person (Details on each order). Steps past target count every style&apos;s step that is past its target with no done date. Notes waiting are notes that tag this person and that they haven&apos;t replied to or marked done. Edits count every change they made in the app. Hand over moves the ticked open orders to someone else; it shows in each order&apos;s history.</p>
      </details>
    </>
  );
}
