import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { dayNear, dueDate, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { canLead, countBy } from "@/lib/team-board";
import { weekOf } from "@/lib/week";
import { PageTabs } from "@/components/page-tabs";
import { reportTabs } from "@/lib/page-groups";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The week in review, for Monday's team talk: what shipped, which ship dates moved and why, how the TNA went,
// QC results, what came in, and who did the work. Monday to Sunday, India time.
export default async function WeekPage({ searchParams }: PageProps<"/reports/week">) {
  const me = await getMe();
  if (!canLead(me?.role) || !me?.companyId) redirect("/reports");
  const sp = await searchParams;
  const today = todayIST();
  const back = sp.w === "1" ? 1 : 0;
  const wk = weekOf(today, back);
  const fromTs = new Date(`${wk.from}T00:00:00+05:30`).toISOString();
  const toTs = new Date(`${wk.to}T23:59:59.999+05:30`).toISOString();
  const supabase = await createClient();
  const cid = me.companyId;
  const [buyers, team, { data: shipped }, { data: moved }, { data: newOrders }, { data: steps }, { data: qc }, { data: hist }, { data: openOrders }] = await Promise.all([
    loadBuyers(),
    loadTeam(),
    supabase.from("dispatches").select("id, order_id, shipped_at, orders(order_no, buyer_id)").eq("company_id", cid).is("cancelled_at", null)
      .gte("shipped_at", fromTs).lte("shipped_at", toTs).order("shipped_at"),
    supabase.from("history").select("row_id, at, actor, before, after").eq("company_id", cid).eq("table_name", "orders").eq("action", "update")
      .gte("at", fromTs).lte("at", toTs).order("at"),
    supabase.from("orders").select("id, order_no, buyer_id, created_at").eq("company_id", cid).is("removed_at", null).gte("created_at", fromTs).lte("created_at", toTs).order("created_at"),
    fetchAll((a, z) => supabase.from("line_stages").select("planned_on, done_on").eq("company_id", cid).gte("done_on", wk.from).lte("done_on", wk.to).order("id").range(a, z)),
    supabase.from("qc_checks").select("kind, result").eq("company_id", cid).is("cancelled_at", null).gte("checked_on", wk.from).lte("checked_on", wk.to),
    fetchAll((a, z) => supabase.from("history").select("actor").eq("company_id", cid).gte("at", fromTs).lte("at", toTs).not("actor", "is", null).order("id").range(a, z)),
    supabase.from("orders").select("id, order_no, buyer_id, ship_date, revised_ship_date").eq("company_id", cid).eq("status", "open").is("removed_at", null),
  ]);
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const orderNo = new Map((openOrders ?? []).map((o) => [o.id, o.order_no]));
  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);

  // Ship dates that moved: the first and last date of each order this week, with the reason written last.
  const moves = new Map<string, { from: string; to: string; reason: string; by: string }>();
  for (const h of moved ?? []) {
    const b = (h.before ?? {}) as Record<string, string | null>, a = (h.after ?? {}) as Record<string, string | null>;
    const was = b.revised_ship_date || b.ship_date, now = a.revised_ship_date || a.ship_date;
    if (!was || !now || was === now) continue;
    const prev = moves.get(h.row_id);
    moves.set(h.row_id, { from: prev?.from ?? was, to: now, reason: a.delay_reason || prev?.reason || "", by: (h.actor && people.get(h.actor)) || "Someone" });
  }
  const moveList = [...moves].filter(([, m]) => m.from !== m.to);
  const done = (steps ?? []).length;
  const late = (steps ?? []).filter((s) => s.planned_on && s.done_on && s.done_on > s.planned_on).length;
  const finals = (qc ?? []).filter((c) => c.kind === "final" || c.kind === "recheck");
  const fails = (qc ?? []).filter((c) => c.result === "fail").length;
  const edits = [...countBy(hist ?? [], (h) => h.actor)].sort((a, b) => b[1] - a[1]);
  const nextFrom = today;
  const nextTo = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  const comingUp = (openOrders ?? []).filter((o) => { const d = dueDate(o); return !!d && d >= nextFrom && d <= nextTo; });
  const pastDue = (openOrders ?? []).filter((o) => { const d = dueDate(o); return !!d && d < today; });

  const kpis = [
    { label: "Lots shipped", value: String((shipped ?? []).length), sub: (shipped ?? []).length ? "sent to buyers" : "none" },
    { label: "Ship dates moved", value: String(moveList.length), sub: moveList.length ? "reasons below" : "none", cls: moveList.length ? "text-warn" : "" },
    { label: "TNA steps done", value: String(done), sub: done ? `${late} after their target` : "none marked", cls: done && late / done > 0.2 ? "text-warn" : "" },
    { label: "QC checks", value: String((qc ?? []).length), sub: `${finals.length} final · ${fails} failed`, cls: fails ? "text-bad" : "" },
  ];

  return (
    <>
      <PageTabs tabs={reportTabs(me.role)} label="Reports" />
      <div className="head">
        <div className="grow">
          <h1>Week in review</h1>
          <p>{dayNear(wk.from, today)} to {dayNear(wk.to, today)}{!back && " (so far)"}. {pastDue.length > 0 && <b className="text-bad">{plural(pastDue.length, "open order")} past ship date now.</b>}</p>
        </div>
        <nav className="seg" aria-label="Which week">
          <Link href="/reports/week" aria-current={!back ? "page" : undefined} scroll={false}>This week</Link>
          <Link href="/reports/week?w=1" aria-current={back ? "page" : undefined} scroll={false}>Last week</Link>
        </nav>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className="kpi">
            <span className="kpi-label">{k.label}</span>
            <b className={`num ${k.cls ?? ""}`}>{k.value}</b>
            <small>{k.sub}</small>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="moved-h">
        <header className="card-h"><h2 id="moved-h">Ship dates that moved</h2></header>
        {moveList.length === 0 ? <p className="card-empty">No ship date moved this week.</p> : (
          <ul className="rows">
            {moveList.map(([id, m]) => (
              <li key={id} className="wk-row">
                <Link href={`/orders/${id}#details`} className="min-w-0">
                  <b><span className="code">{orderNo.get(id) ?? "Order"}</span>{dayNear(m.from, today)} → {dayNear(m.to, today)}</b>
                  <small>{m.reason ? `“${m.reason}”` : "No reason written"} · {m.by}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="shipped-h">
        <header className="card-h"><h2 id="shipped-h">Shipped</h2></header>
        {(shipped ?? []).length === 0 ? <p className="card-empty">Nothing shipped this week.</p> : (
          <ul className="rows">
            {(shipped ?? []).map((d) => {
              const o = one(d.orders as { order_no: string; buyer_id: string } | { order_no: string; buyer_id: string }[] | null);
              return (
                <li key={d.id} className="wk-row">
                  <Link href={`/orders/${d.order_id}#dispatch`} className="min-w-0">
                    <b><span className="code">{o?.order_no}</span>{o ? buyerOf.get(o.buyer_id) : ""}</b>
                    <small>Sent {dayNear(String(d.shipped_at).slice(0, 10), today)}</small>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="next-h">
        <header className="card-h">
          <div className="min-w-0"><h2 id="next-h">Shipping in the next 7 days</h2></div>
          <Link href="/calendar" className="btn sm">Calendar</Link>
        </header>
        {comingUp.length === 0 ? <p className="card-empty">Nothing is due to ship.</p> : (
          <ul className="rows">
            {comingUp.sort((a, b) => (dueDate(a) ?? "").localeCompare(dueDate(b) ?? "")).map((o) => (
              <li key={o.id} className="wk-row">
                <Link href={`/orders/${o.id}`} className="min-w-0">
                  <b><span className="code">{o.order_no}</span>{buyerOf.get(o.buyer_id)}</b>
                  <small>Ships {dayNear(dueDate(o)!, today)}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="who-h">
        <header className="card-h">
          <div className="min-w-0"><h2 id="who-h">Who did the work</h2><p>{plural((newOrders ?? []).length, "new order")} came in.</p></div>
          <Link href="/reports/team" className="btn sm">Team</Link>
        </header>
        {edits.length === 0 ? <p className="card-empty">Nobody changed anything in the app this week.</p> : (
          <ul className="rows">
            {edits.map(([id, n]) => (
              <li key={id} className="wk-row"><span className="min-w-0"><b>{people.get(id) ?? "Someone"}</b><small>{plural(n, "change")}</small></span></li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
