import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { VISIT_DAYS } from "@/lib/floor";
import { daysBetween, dayNear, TNA_STEPS, todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { type PlanStep, planText, planVisits } from "@/lib/visit-plan";
import { PageTabs } from "@/components/page-tabs";
import { HOME_TABS_QUALITY } from "@/lib/page-groups";

const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const DAYS = 7;

// Quality's visit plan: which factory to visit on which of the coming days and why, from every open order's step
// targets and when each factory was last visited. Shared on WhatsApp so the day's route is agreed in the morning.
export default async function VisitPlanPage() {
  const me = await getMe();
  if (!me?.role || !["owner", "manager", "quality"].includes(me.role)) redirect("/calendar");
  const companyId = me.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const today = todayIST();
  const last = new Date(Date.parse(today) + (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const [{ data: orders, error }, factories, { data: visits, error: e2 }] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, order_lines(id, factory_id), factory_pos(factory_id, released_at)")
      .eq("company_id", companyId).eq("status", "open").is("removed_at", null).is("order_lines.removed_at", null).order("id").range(a, z)),
    loadFactories(),
    supabase.from("floor_updates").select("factory_id, visited_on").eq("company_id", companyId).gte("visited_on", new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10))
      .order("visited_on", { ascending: false }).limit(2000),
  ]);
  // Only styles whose factory PO has gone out are in production.
  const lineOf = new Map<string, { factory: string; order: string }>();
  for (const o of orders ?? []) {
    const released = new Set((o.factory_pos ?? []).filter((p) => p.released_at).map((p) => p.factory_id));
    for (const l of o.order_lines ?? []) if (l.factory_id && released.has(l.factory_id)) lineOf.set(l.id, { factory: l.factory_id, order: o.order_no });
  }
  const ids = [...new Set([...lineOf.values()].map((x) => x.order))].length ? (orders ?? []).map((o) => o.id) : [];
  const { data: stages, error: e3 } = ids.length
    ? await fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, label, planned_on").in("order_id", ids).is("done_on", null).eq("not_needed", false)
        .not("planned_on", "is", null).lte("planned_on", last).order("id").range(a, z))
    : { data: [], error: null };
  const label = new Map(TNA_STEPS.map((t) => [t.key, t.label]));
  const steps: PlanStep[] = (stages ?? []).flatMap((s) => {
    const l = lineOf.get(s.line_id);
    return l ? [{ factory_id: l.factory, order_no: l.order, line_id: s.line_id, stage: s.stage, label: s.label || label.get(s.stage) || s.stage, planned_on: String(s.planned_on) }] : [];
  });
  const lastVisit = new Map<string, string>();
  for (const v of visits ?? []) if (!lastVisit.has(v.factory_id)) lastVisit.set(v.factory_id, v.visited_on);
  const plan = planVisits({ today, days: DAYS, every: VISIT_DAYS, factories: factories.map((f) => ({ id: f.id, name: f.name })), steps, lastVisit });
  const dayLabel = (d: string) => { const n = daysBetween(today, d); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : `${weekday.format(new Date(`${d}T12:00:00+05:30`))} ${dayNear(d, today)}`; };
  const total = plan.reduce((n, d) => n + d.visits.length, 0);
  const text = planText(plan, dayLabel);
  const errors = [error, e2, e3].filter(Boolean).map((e) => e!.message);

  return (
    <>
      {me.role === "quality" && <PageTabs tabs={HOME_TABS_QUALITY} label="Home" />}
      <div className="head">
        <div className="grow">
          {me.role !== "quality" && <nav className="crumbs" aria-label="Breadcrumb"><Link href="/calendar">Calendar</Link> / Visit plan</nav>}
          <h1>Visit plan</h1>
          <p>{total ? `${plural(total, "factory visit")} in the next ${DAYS} days.` : "No factory needs a visit in the next 7 days."} Inspections fix their day; late steps and factories not visited for {VISIT_DAYS} days come first.</p>
        </div>
        {total > 0 && <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
      </div>

      {errors.length > 0 && <div className="errbox">Some of the plan couldn&apos;t load. Reload to try again. ({errors.join("; ")})</div>}

      <section className="card" aria-label="Visits by day">
        <ol className="cal">
          {plan.map((d) => (
            <li key={d.date} className="cal-day">
              <h2 className="cal-date">
                <span className="cal-wd">{daysBetween(today, d.date) === 0 ? "Today" : daysBetween(today, d.date) === 1 ? "Tomorrow" : weekday.format(new Date(`${d.date}T12:00:00+05:30`))}</span>
                <span className="num">{dayNear(d.date, today)}</span>
                {d.visits.length > 0 && <small>{d.visits.length}</small>}
              </h2>
              {d.visits.length === 0 ? <p className="cal-free">No visit needed</p> : (
                <ul className="tasks">
                  {d.visits.map((v) => (
                    <li key={v.factoryId} className="task">
                      <span className={`sev ${v.tone}`} aria-hidden />
                      <span className="task-text">
                        <b>{v.name}</b>
                        <span>{v.reasons.join(" · ")}{v.orders.length ? ` · ${v.orders.slice(0, 4).join(", ")}${v.orders.length > 4 ? ` and ${v.orders.length - 4} more` : ""}` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
      <details className="howto">
        <summary>How the plan is made</summary>
        <p>Every open order&apos;s step targets, for styles whose factory PO has gone out. An inline, mid-line or final inspection is a visit on its day. Steps already late, or a factory not visited for {VISIT_DAYS} days, put a visit today. Other steps due this week join the visit before them. Sundays move to Monday. Start each visit from To do.</p>
      </details>
    </>
  );
}
