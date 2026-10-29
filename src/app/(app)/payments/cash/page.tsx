import Link from "next/link";
import { cashAhead, carryDays, type CashItem, type OpenOrder } from "@/lib/cash";
import { buyerName, loadFactories, loadPace, loadTerms, USUAL_DAYS } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { day, dueDate, money, todayIST } from "@/lib/format";
import type { LinePrice } from "@/lib/margin";
import { lakh, MSME_DAYS } from "@/lib/payables";
import { forecast, paceLookup, type StepRow } from "@/lib/progress";
import { loadShipProgress } from "@/lib/shipments";
import { createClient } from "@/lib/supabase/server";
import { PageTabs } from "@/components/page-tabs";
import { MONEY_TABS } from "@/lib/page-groups";
import { loadPayables } from "../../payables/load";
import { loadBooks } from "../load";

const short = (d: string) => day(d).slice(0, -5);
const signed = (n: number) => (n < 0 ? `−${lakh(-n)}` : lakh(n));

// Cash ahead: money in from buyers and out to factories, week by week, so a squeeze shows before it comes.
// Read only: invoices from Payments, bills from Tally, and open orders from their rates and likely ship date.
export default async function CashPage() {
  const { books, buyerLabel, error } = await loadBooks();
  const supabase = await createClient();
  const today = todayIST();
  const [payables, factories, pace, { buyerDays, factoryDays }, orders] = await Promise.all([
    loadPayables(supabase),
    loadFactories(),
    loadPace(),
    loadTerms(),
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, ship_date, revised_ship_date, order_lines(id, style, qty, factory_id)")
      .eq("status", "open").order("order_no").order("id").range(a, z)),
  ]);
  const ids = (orders.data ?? []).map((o) => o.id);
  const none = { data: [], error: null };
  const [rates, ship, steps] = await Promise.all([
    ids.length ? fetchAll<LinePrice>((a, z) => supabase.rpc("line_prices", { p_orders: ids }).order("id").range(a, z)) : none,
    loadShipProgress(supabase, ids),
    ids.length
      ? fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, planned_on, done_on, not_needed").in("order_id", ids).eq("not_needed", false).order("id").range(a, z))
      : none,
  ]);

  const rateOf = new Map((rates.data as LinePrice[]).map((r) => [r.id, r]));
  const billedOf = new Map((ship.data ?? []).map((r) => [r.line_id, r.billed]));
  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name ?? "This factory";

  // An open order still to be billed: what is left of it, from its rates, landing its credit days after it likely ships.
  // What has been billed already is in the invoices and Tally bills above, so it isn't counted twice.
  let unpriced = 0, undated = 0;
  const open: OpenOrder[] = [];
  for (const o of orders.data ?? []) {
    const lines = (o.order_lines ?? []) as { id: string; style: string; qty: number; factory_id: string | null }[];
    let sale = 0, cost = 0, missing = false;
    const days: number[] = [];
    for (const l of lines) {
      const left = Math.max(0, l.qty - (billedOf.get(l.id) ?? 0));
      if (!left) continue;
      const r = rateOf.get(l.id);
      if (r?.buyer_rate == null || r?.factory_rate == null) { missing = true; continue; }
      sale += left * Number(r.buyer_rate);
      cost += left * Number(r.factory_rate);
      days.push(factoryDays(l.factory_id));
    }
    if (missing) unpriced++;
    if (!sale && !cost) continue;
    const due = dueDate(o);
    if (!due) { undated++; continue; }
    const f = forecast(lines, (steps.data ?? []) as StepRow[], due, today, paceLookup(pace, lines, factoryName));
    const ships = [today, due, f?.finish ?? due].sort().at(-1)!;
    const b = books.buyerById.get(o.buyer_id);
    open.push({
      id: o.id, orderNo: o.order_no, buyer: b ? buyerName(b) : "Buyer", sale, cost, ships,
      buyerDays: buyerDays(o.buyer_id), factoryDays: Math.min(...days),
    });
  }

  const c = cashAhead({
    today,
    invoices: books.invoices.filter((i) => i.state !== "cancelled" && i.outstanding > 0 && i.due)
      .map((i) => ({ amount: i.outstanding, due: i.due!, label: `${i.invoice_no} · ${buyerLabel(i.buyer_id)}`, href: `/payments/invoices/${i.id}` })),
    // A bill with no date in Tally is an older balance: it counts as already due.
    bills: payables.bills.filter((b) => !b.hold && b.open > 0)
      .map((b) => ({ amount: b.open, due: b.due_on ?? "2000-01-01", label: `${b.bill ?? "Older balance"} · ${b.factory ?? b.ledger}`, href: "/payables" })),
    orders: open,
  });
  const carried = open.filter((o) => carryDays(o) > 0).sort((a, z) => z.cost - a.cost);
  const lastWeek = c.weeks.at(-1)!;

  return (
    <>
      <PageTabs tabs={MONEY_TABS} label="Money" />
      <div className="head">
        <div className="grow">
          <h1>Cash ahead</h1>
          <p>Money in from buyers and out to factories over the next 12 weeks, so a tight week shows before it comes.</p>
        </div>
      </div>
      {error && <div className="errbox">Couldn&apos;t load the invoices: {error.message}. Reload to try again.</div>}
      {payables.error && <div className="errbox">Couldn&apos;t load the bills from Tally: {payables.error.message}.</div>}

      <div className="kpis cash-kpis">
        <div className={`kpi ${c.lowest ? "bad" : ""}`}>
          <span className="kpi-label"><i aria-hidden />Tightest week</span>
          <b className="num">{c.lowest ? signed(c.lowest.balance) : "No squeeze"}</b>
          <small>{c.lowest ? `Week of ${short(c.lowest.start)}: more goes out than has come in by then` : "More comes in than goes out, every week"}</small>
        </div>
        <Link href="/payments" className={`kpi ${c.overdueIn ? "warn" : ""}`}>
          <span className="kpi-label"><i aria-hidden />Buyers owe, overdue</span><b className="num">{lakh(c.overdueIn)}</b>
          <small>Not in the weeks below: it can land any day</small>
        </Link>
        <Link href="/payables" className={`kpi ${c.overdueOut ? "warn" : ""}`}>
          <span className="kpi-label"><i aria-hidden />You owe, overdue</span><b className="num">{lakh(c.overdueOut)}</b>
          <small>Bills past due in Tally</small>
        </Link>
      </div>

      <section className="card" aria-label="Week by week">
        <div className="card-h">
          <div>
            <h2>Week by week</h2>
            <p>Running total starts at zero today. Tap a week to see what lands in it.</p>
          </div>
        </div>
        <div className="cash-week cash-week-h hide-phone" aria-hidden>
          <span>Week</span><span className="cash-in">In</span><span className="cash-out">Out</span><span className="cash-bal">Running total</span>
        </div>
        <ul className="cash-weeks">
          {c.weeks.map((w) => (
            <li key={w.start}>
              <details>
                <summary className="cash-week">
                  <span className="cash-when">{short(w.start)} to {short(w.end)}{w.start <= today && <small>This week</small>}</span>
                  <span className="cash-in num">{w.in ? `+${lakh(w.in)}` : ""}</span>
                  <span className="cash-out num">{w.out ? `−${lakh(w.out)}` : ""}</span>
                  <span className={`cash-bal num ${w.balance < 0 ? "text-bad" : ""}`}>{signed(w.balance)}</span>
                </summary>
                {w.items.length ? (
                  <ul className="cash-items">
                    {w.items.map((x, i) => <Item key={i} x={x} />)}
                  </ul>
                ) : <p className="cash-none">Nothing due this week.</p>}
              </details>
            </li>
          ))}
        </ul>
        {(c.later.in > 0 || c.later.out > 0) && (
          <p className="cash-later">After {short(lastWeek.end)}: {lakh(c.later.in)} more in and {lakh(c.later.out)} more out.</p>
        )}
      </section>

      {carried.length > 0 && (
        <section className="card" aria-label="Orders you carry">
          <div className="card-h">
            <div>
              <h2>Orders you pay for before the buyer pays you</h2>
              <p>The factory is paid first, so this money is out of the business until the buyer pays.</p>
            </div>
          </div>
          <ul className="cash-items cash-carry">
            {carried.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="cash-item">
                  <span className="min-w-0">
                    <b>{o.orderNo} · {o.buyer}</b>
                    <small>Factory {money(Math.round(o.cost))} {day(addTo(o.ships, o.factoryDays))}, buyer pays {day(addTo(o.ships, o.buyerDays))}</small>
                  </span>
                  <span className="num cash-days">{carryDays(o)} days</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="howto">
        <summary>How this is worked out</summary>
        <p>
          In: invoices still owed, on their due date. Out: factory and supplier bills from Tally, on their due date (bills on hold are left out).
          Open orders not billed yet: the buyer rate and factory rate for what is still to ship, from the likely ship date the order page shows,
          plus the buyer&apos;s credit days for money in and the factory&apos;s days for money out. Anything without days set is taken as {USUAL_DAYS} days,
          and micro and small MSME factories as {MSME_DAYS} at most. Before GST and freight. Tally is only read, never changed.
        </p>
        {(unpriced > 0 || undated > 0) && (
          <p className="mt-2">
            Left out: {[unpriced && `${unpriced} ${unpriced === 1 ? "order" : "orders"} with a style missing a rate`, undated && `${undated} with no ship date`].filter(Boolean).join(" and ")}.
          </p>
        )}
      </details>
    </>
  );
}

const addTo = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

function Item({ x }: { x: CashItem }) {
  const body = (
    <>
      <span className="min-w-0">
        <b>{x.label}</b>
        <small>{day(x.on)}{x.kind === "order" ? " · expected from the order" : x.kind === "bill" ? " · bill in Tally" : " · invoice"}</small>
      </span>
      <span className="num">{x.amount < 0 ? `−${money(Math.round(-x.amount))}` : `+${money(Math.round(x.amount))}`}</span>
    </>
  );
  return <li>{x.href ? <Link href={x.href} className="cash-item">{body}</Link> : <div className="cash-item">{body}</div>}</li>;
}
