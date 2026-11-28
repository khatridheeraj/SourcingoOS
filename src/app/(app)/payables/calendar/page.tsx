import Link from "next/link";
import { redirect } from "next/navigation";
import { PageTabs } from "@/components/page-tabs";
import { getMe } from "@/lib/auth";
import { dayNear, money, todayIST } from "@/lib/format";
import { DEFAULT_PLAN, factoryPay, type GOrder, type GuaranteeTerms } from "@/lib/guarantee";
import { MONEY_TABS } from "@/lib/page-groups";
import { payCalendar, type PayItem } from "@/lib/pay-calendar";
import { isMsme45, lakh, supplierName } from "@/lib/payables";
import { createClient } from "@/lib/supabase/server";
import { loadOpenOrderMoney } from "../../payments/cash/load";
import { isFinance, loadBooks } from "../../payments/load";
import { loadPayables } from "../load";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
const KIND: Record<PayItem["kind"], string> = { bill: "Bill in Tally", guarantee: "Guarantee: after its QC pass", expected: "Expected from the order" };

// The factory payment calendar: what goes out to factories and suppliers, day by day for the next 13 weeks, so the
// owner can plan the bank before a heavy week. Read only: bills from Tally, the Guarantee's factory pay, open orders.
export default async function PayCalendarPage() {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const today = todayIST();
  const supabase = await createClient();
  const { books } = await loadBooks();
  const [{ bills, error }, { open }, { data: termsRow }] = await Promise.all([
    loadPayables(supabase), loadOpenOrderMoney(books), supabase.rpc("guarantee_terms"),
  ]);
  const terms = (termsRow ?? { live: false, deposit_pct: 30, pay_days: 15, plan: DEFAULT_PLAN }) as GuaranteeTerms;
  // Under the Guarantee a factory is paid within its days of the pass, so that date replaces the bill's and the guess.
  const guaranteed = new Set<string>();
  const items: PayItem[] = [];
  if (terms.live) {
    const { data } = await supabase.rpc("guarantee_orders");
    for (const o of ((data as { orders?: GOrder[] } | null)?.orders ?? [])) {
      for (const f of o.factories ?? []) {
        const s = factoryPay(f, terms, today);
        if (s.state === "paid" || !s.due) continue;
        guaranteed.add(`${o.order_id}|${f.factory_id}`);
        items.push({ on: s.due, amount: s.left, who: f.name, label: `${o.order_no} · passed QC`, href: "/guarantee", kind: "guarantee", key: `g${o.order_id}${f.factory_id}` });
      }
    }
  }
  for (const b of bills) {
    if (b.hold || b.open <= 0 || !b.due_on) continue;
    if (b.order_id && b.factory_id && guaranteed.has(`${b.order_id}|${b.factory_id}`)) continue;
    items.push({ on: b.due_on, amount: b.open, who: supplierName(b), label: [b.bill, b.order_no].filter(Boolean).join(" · ") || "Bill",
      href: `/payables?s=${encodeURIComponent(b.ledger)}`, kind: "bill", msme: isMsme45(b.msme), key: `b${b.ledger}${b.bill}` });
  }
  for (const o of open) {
    for (const f of o.factories) {
      if (guaranteed.has(`${o.id}|${f.factoryId}`)) continue;
      const on = new Date(Date.parse(`${o.ships}T00:00:00Z`) + f.days * 86_400_000).toISOString().slice(0, 10);
      items.push({ on, amount: f.cost, who: f.name, label: `${o.orderNo} · ships about ${dayNear(o.ships, today)}`, href: `/orders/${o.id}`, kind: "expected", key: `e${o.id}${f.factoryId}` });
    }
  }
  const c = payCalendar(items, today);
  const week = c.weeks[0];
  const next7 = c.days.filter((d) => d.on <= new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)).reduce((n, d) => n + d.total, 0);
  const peak = Math.max(1, ...c.weeks.map((w) => w.total));
  const heaviest = c.weeks.reduce((m, w) => (w.total > m.total ? w : m), week);
  const older = bills.filter((b) => !b.hold && b.open > 0 && !b.due_on).reduce((n, b) => n + b.open, 0);

  return (
    <>
      <PageTabs tabs={MONEY_TABS} label="Money" />
      <div className="head">
        <div className="grow">
          <h1>Payment calendar</h1>
          <p>What goes out to factories and suppliers, day by day for the next 13 weeks.</p>
        </div>
      </div>
      <nav className="seg mb-4" aria-label="View">
        <Link href="/payables">By due date</Link>
        <Link href="/payables?view=suppliers">By supplier</Link>
        <Link href="/payables?view=claims">Claims</Link>
        <Link href="/payables/calendar" aria-current="page">Calendar</Link>
      </nav>
      {error && <div className="errbox">Couldn&apos;t load the bills from Tally: {error.message}. Reload to try again.</div>}

      <div className="kpis bills-kpis">
        <a href="#overdue" className={`kpi ${c.overdueTotal ? "bad" : "ok"}`}>
          <span className="kpi-label"><i aria-hidden />Overdue</span><b className="num">{lakh(c.overdueTotal)}</b>
          <small>{c.overdue.length ? `${c.overdue.length} ${c.overdue.length === 1 ? "payment" : "payments"} past due` : "Nothing late"}</small>
        </a>
        <div className={`kpi ${next7 ? "warn" : ""}`}>
          <span className="kpi-label"><i aria-hidden />Next 7 days</span><b className="num">{lakh(next7)}</b>
          <small>{next7 ? "Plan this into the bank now" : "Nothing falls due this week"}</small>
        </div>
        <div className="kpi">
          <span className="kpi-label"><i aria-hidden />Next 13 weeks</span><b className="num">{lakh(c.total)}</b>
          <small>{c.expectedTotal ? `${lakh(c.expectedTotal)} of it expected from open orders` : "All of it billed already"}</small>
        </div>
      </div>

      <section className="card" aria-labelledby="weeks-h">
        <div className="card-h">
          <div>
            <h2 id="weeks-h">Week by week</h2>
            <p>{heaviest.total ? `Heaviest: week of ${dayNear(heaviest.start, today)}, ${lakh(heaviest.total)}.` : "Nothing falls due in the next 13 weeks."}</p>
          </div>
        </div>
        <ol className="pcal-bars" aria-label="Payments each week">
          {c.weeks.map((w) => (
            <li key={w.start} title={`Week of ${dayNear(w.start, today)}: ${money(Math.round(w.total))}`}>
              <span className="pcal-bar" aria-hidden>
                <i className="pcal-exp" style={{ height: `${(w.expected / peak) * 100}%` }} />
                <i className="pcal-bill" style={{ height: `${(w.bills / peak) * 100}%` }} />
              </span>
              <b className="num">{w.total ? lakh(w.total).replace("₹", "") : ""}</b>
              <small>{dayNear(w.start, today).replace(/ \d{4}$/, "")}</small>
            </li>
          ))}
        </ol>
        <p className="pcal-key"><span><i className="pcal-bill" /> Billed</span><span><i className="pcal-exp" /> Expected from open orders</span></p>
      </section>

      {c.overdue.length > 0 && (
        <section className="card pcal-day" id="overdue" aria-label="Overdue">
          <div className="pcal-dh bad"><b>Overdue</b><span className="num">{money(Math.round(c.overdueTotal))}</span></div>
          <ul>{c.overdue.map((x) => <Row key={x.key} x={x} today={today} late />)}</ul>
        </section>
      )}

      {c.days.map((d) => (
        <section key={d.on} className="card pcal-day" aria-label={dayNear(d.on, today)}>
          <div className="pcal-dh">
            <b>{d.on === today ? "Today" : `${weekday(d.on)} ${dayNear(d.on, today)}`}</b>
            <span className="num">{money(Math.round(d.total))}</span>
          </div>
          <ul>{d.items.map((x) => <Row key={x.key} x={x} today={today} />)}</ul>
        </section>
      ))}
      {!c.days.length && !c.overdue.length && <p className="muted">Nothing to pay in the next 13 weeks.</p>}
      {(c.later > 0 || older > 0) && (
        <p className="muted text-[13px] mt-3 num">
          {[c.later > 0 && `${lakh(c.later)} falls due after these 13 weeks`, older > 0 && `${lakh(older)} in older Tally balances with no bill date (see Bills to pay)`].filter(Boolean).join(". ")}.
        </p>
      )}

      <details className="howto">
        <summary>How the calendar is worked out</summary>
        <p>Billed: every factory and supplier bill in Tally with money left, on its due date (bills on hold are left out). Micro and small MSME factories are marked: the law says 45 days.</p>
        <p>Expected: open orders not billed yet, the factory rate for what is still to ship, on the likely ship date plus the factory&apos;s payment days. These move as the orders move.</p>
        <p>{terms.live ? `Under the Guarantee a factory is paid within ${terms.pay_days} days of its goods passing Final QC, so that date is used for those orders.` : "When the Guarantee is on, its orders show on the day the factory is paid under it."} Tally is only read, never changed.</p>
      </details>
    </>
  );
}

function Row({ x, today, late }: { x: PayItem; today: string; late?: boolean }) {
  return (
    <li>
      <Link href={x.href ?? "/payables"} className="pcal-row">
        <span className="min-w-0">
          <b>{x.who}</b>
          <small>{[x.label, late ? `due ${dayNear(x.on, today)}` : "", KIND[x.kind], x.msme ? "MSME 45 days" : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={`num ${x.kind === "expected" ? "muted" : ""} ${late ? "text-bad" : ""}`}>{money(Math.round(x.amount))}</span>
      </Link>
    </li>
  );
}
