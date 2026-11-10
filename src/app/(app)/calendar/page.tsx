import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { isPartner } from "@/lib/auth-roles";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { daysBetween, dayNear, dueDate, money, planDueAt, qtyTotal, TNA_STEPS, todayIST } from "@/lib/format";
import { NO_COMPANY } from "@/lib/names";
import { createClient } from "@/lib/supabase/server";
import { buildCalendar, type CalBill, type CalCheque, type CalStep } from "@/lib/calendar";
import { isFinance } from "../payments/load";
import { loadPayables } from "../payables/load";
import { PageTabs } from "@/components/page-tabs";
import { HOME_TABS, HOME_TABS_QUALITY } from "@/lib/page-groups";

const RANGES = [{ days: 7, label: "7 days" }, { days: 14, label: "14 days" }, { days: 30, label: "30 days" }] as const;
const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
const lakh = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : money(n));

// What falls on each coming day across open orders: ship dates, inspections, samples, factory plans and production
// steps, plus bills to pay and cheques to deposit for the owner and Accounts. Home's To do covers what is late.
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me?.role || isPartner(me.role)) redirect("/today");
  const companyId = me.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const today = todayIST();
  const days = RANGES.find((r) => String(r.days) === sp.days)?.days ?? 14;
  const last = new Date(Date.parse(today) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const team = canEditOrders(me.role);
  const finance = isFinance(me.role);

  const [{ data: all, error }, buyers, factories, pay, { data: cheques, error: chqErr }] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, merchandiser_id, order_lines(id, qty, product, factory_id)")
      .eq("company_id", companyId).eq("status", "open").is("removed_at", null).is("order_lines.removed_at", null).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
    finance ? loadPayables(supabase) : Promise.resolve(null),
    finance ? supabase.from("cheques").select("id, buyer_id, cheque_no, cheque_date, amount").eq("company_id", companyId).eq("status", "in_hand").lte("cheque_date", last)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const mineCount = (all ?? []).filter((o) => o.merchandiser_id === me.id).length;
  const who = sp.who === "all" || sp.who === "mine" ? sp.who : me.role === "merchandiser" && mineCount ? "mine" : "all";
  const orders = (all ?? []).filter((o) => who === "all" || o.merchandiser_id === me.id);
  const ids = orders.map((o) => o.id);
  const [{ data: stages, error: e2 }, { data: pos, error: e3 }] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, label, planned_on").in("order_id", ids)
          .gte("planned_on", today).lte("planned_on", last).is("done_on", null).eq("not_needed", false).order("id").range(a, z)),
        team ? supabase.from("factory_pos").select("order_id, factory_id, plan_requested_at").in("order_id", ids).not("plan_requested_at", "is", null)
          .is("factory_sent_at", null).is("released_at", null) : Promise.resolve({ data: [], error: null }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f.name]));
  const lineFactory = new Map(orders.flatMap((o) => (o.order_lines ?? []).map((l) => [l.id, l.factory_id ? factoryOf.get(l.factory_id) ?? "" : ""])));
  const stepLabel = new Map(TNA_STEPS.map((t) => [t.key, t.label]));
  const steps: CalStep[] = (stages ?? []).filter((s) => s.planned_on).map((s) => ({
    order_id: s.order_id, line_id: s.line_id, stage: s.stage, planned_on: String(s.planned_on),
    label: s.label || stepLabel.get(s.stage) || s.stage, factory: lineFactory.get(s.line_id) ?? "",
  }));
  const bills: CalBill[] = (pay?.bills ?? []).filter((b) => b.due_on && !b.hold && b.open > 0)
    .map((b, i) => ({ key: `${b.ledger}:${b.bill ?? i}`, supplier: b.factory ?? b.ledger, bill: b.bill, due_on: b.due_on!, amount: lakh(b.open), href: `/payables?s=${encodeURIComponent(b.ledger)}` }));
  const chq: CalCheque[] = (cheques ?? []).map((c) => ({ id: c.id, buyer: buyerOf.get(c.buyer_id) ?? "Buyer", cheque_no: c.cheque_no, on: c.cheque_date, amount: lakh(Number(c.amount)) }));
  const cal = buildCalendar({
    today, days, steps, bills, cheques: chq,
    orders: orders.map((o) => ({ id: o.id, code: o.order_no, title: `${buyerOf.get(o.buyer_id) ?? ""}${o.buyer_po ? ` · PO ${o.buyer_po}` : ""}`, due: dueDate(o), pieces: qtyTotal(o.order_lines ?? []) })),
    plans: (pos ?? []).map((p) => ({ order_id: p.order_id, factory: factoryOf.get(p.factory_id) ?? "The factory", due_on: planDueAt(String(p.plan_requested_at)).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) })),
  });
  const errors = [error, e2, e3, chqErr, pay?.error].filter(Boolean).map((e) => e!.message);
  const total = cal.reduce((n, d) => n + d.items.length, 0);
  const ships = cal.reduce((n, d) => n + d.items.filter((i) => i.kind === "ship").length, 0);
  const checks = cal.reduce((n, d) => n + d.items.filter((i) => i.kind === "qc").length, 0);
  const qs = (p: Record<string, string>) => `/calendar?${new URLSearchParams({ ...(sp.who ? { who: String(sp.who) } : {}), ...(sp.days ? { days: String(sp.days) } : {}), ...p })}`;
  const busy = cal.filter((d) => d.items.length);

  return (
    <>
      <PageTabs tabs={team ? HOME_TABS : HOME_TABS_QUALITY} label="Home" />
      <div className="head">
        <div className="grow">
          <h1>Calendar</h1>
          <p>
            {total === 0 ? `Nothing falls in the next ${days} days.` : `${ships ? `${ships} ${ships === 1 ? "order ships" : "orders ship"}` : "Nothing ships"}${checks ? ` · ${checks} ${checks === 1 ? "inspection" : "inspections"}` : ""} in the next ${days} days.`}
            {" "}Late work is on <Link href="/today" className="link">To do</Link>.
          </p>
        </div>
        {(me.role === "owner" || me.role === "manager") && <Link href="/calendar/visits" className="btn">Factory visit plan</Link>}
      </div>

      {errors.length > 0 && <div className="errbox">Some of the calendar couldn&apos;t load, so days may look emptier than they are. Reload to try again. ({[...new Set(errors)].join("; ")})</div>}

      <section className="card" aria-label="Coming days">
        <header className="card-h cal-h">
          <nav className="seg" aria-label="How far ahead">
            {RANGES.map((r) => <Link key={r.days} href={qs({ days: String(r.days) })} aria-current={days === r.days ? "page" : undefined} scroll={false}>{r.label}</Link>)}
          </nav>
          {mineCount > 0 && (
            <nav className="seg" aria-label="Whose orders">
              <Link href={qs({ who: "mine" })} aria-current={who === "mine" ? "page" : undefined} scroll={false}>Mine</Link>
              <Link href={qs({ who: "all" })} aria-current={who === "all" ? "page" : undefined} scroll={false}>All</Link>
            </nav>
          )}
        </header>
        {busy.length === 0 ? (
          <p className="card-empty">Nothing is planned in the next {days} days. Add step targets on an order and they show here.</p>
        ) : (
          <ol className="cal">
            {busy.map((d) => {
              const n = daysBetween(today, d.date);
              return (
                <li key={d.date} className="cal-day">
                  <h2 className="cal-date">
                    <span className="cal-wd">{n === 0 ? "Today" : n === 1 ? "Tomorrow" : weekday.format(new Date(`${d.date}T12:00:00+05:30`))}</span>
                    <span className="num">{dayNear(d.date, today)}</span>
                    <small>{d.items.length}</small>
                  </h2>
                  <ul className="tasks">
                    {d.items.map((i) => (
                      <li key={i.key} className="task cal-item">
                        <span className={`cal-kind k-${i.kind}`}>{i.label}</span>
                        <Link href={i.href} className="task-text">
                          <b>{i.code && <span className="code">{i.code}</span>}{i.title}</b>
                          <span>{i.detail}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}
