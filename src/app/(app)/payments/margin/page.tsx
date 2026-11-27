import Link from "next/link";
import { PageTabs } from "@/components/page-tabs";
import { dayNear, money, todayIST } from "@/lib/format";
import { marginBy, marginCls, orderMargin, pct, THIN_MARGIN_PCT, type MarginRow, type OrderMargin } from "@/lib/margin";
import { MONEY_TABS } from "@/lib/page-groups";
import { lakh } from "@/lib/payables";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../load";

const VIEWS = [{ key: "orders", label: "Orders" }, { key: "buyers", label: "Buyers" }, { key: "factories", label: "Factories" }];
const signedLakh = (n: number) => (n < 0 ? `−${lakh(-n)}` : lakh(n));

// Margin: what each order earns, from its rates until it is billed and from the bills after, less refunds agreed to the
// buyer and plus claims passed to factories. Before GST and freight. Thin and losing orders first, so they get looked at.
export default async function MarginPage({ searchParams }: PageProps<"/payments/margin">) {
  const { buyerLabel } = await loadBooks();
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.by) ? String(sp.by) : "orders";
  const today = todayIST();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_margins");
  const all = ((data ?? []) as MarginRow[]).map(orderMargin).filter((m) => m.sale > 0 || m.cost > 0);
  const open = all.filter((m) => m.row.status === "open");
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const shipped = all.filter((m) => m.row.status === "shipped" && (m.row.shipped_on ?? m.row.ship_date ?? "") >= since);
  const total = (list: OrderMargin[]) => {
    const sale = list.reduce((n, m) => n + m.sale, 0), margin = list.reduce((n, m) => n + m.margin, 0);
    return { sale, margin, pct: sale > 0 ? (margin / sale) * 100 : null };
  };
  const o = total(open), s = total(shipped);
  const thin = all.filter((m) => m.pct != null && m.pct < THIN_MARGIN_PCT);
  const losing = thin.filter((m) => m.margin < 0).length;
  const missing = all.filter((m) => m.plan.missing > 0).length;
  const orders = [...all].sort((a, z) => (a.pct ?? 999) - (z.pct ?? 999));
  const groups = view === "orders" ? [] : marginBy(all, view === "buyers" ? "buyer" : "factory", buyerLabel);
  const peak = Math.max(1, ...groups.map((g) => Math.abs(g.margin)));

  return (
    <>
      <PageTabs tabs={MONEY_TABS} label="Money" />
      <div className="head">
        <div className="grow">
          <h1>Margin</h1>
          <p>What each order earns: from its rates until it is billed, then from the bills. Less refunds to buyers, plus claims on factories. Before GST and freight.</p>
        </div>
      </div>
      {error && <div className="errbox">Couldn&apos;t load the margins: {error.message}. Reload to try again.</div>}

      <div className="kpis bills-kpis">
        <div className="kpi">
          <span className="kpi-label"><i aria-hidden />Open orders</span>
          <b className={`num ${marginCls(o.pct)}`}>{o.pct == null ? "—" : pct(o.pct)}</b>
          <small>{open.length ? `${signedLakh(o.margin)} on ${lakh(o.sale)} of sales` : "No open orders with rates"}</small>
        </div>
        <div className="kpi">
          <span className="kpi-label"><i aria-hidden />Shipped, last 90 days</span>
          <b className={`num ${marginCls(s.pct)}`}>{s.pct == null ? "—" : pct(s.pct)}</b>
          <small>{shipped.length ? `${signedLakh(s.margin)} on ${lakh(s.sale)} billed` : "Nothing shipped in 90 days"}</small>
        </div>
        <a href="#orders" className={`kpi ${losing ? "bad" : thin.length ? "warn" : "ok"}`}>
          <span className="kpi-label"><i aria-hidden />Thin or losing</span>
          <b className="num">{thin.length}</b>
          <small>{thin.length ? `${losing ? `${losing} losing money, ` : ""}under ${THIN_MARGIN_PCT}%` : `Every order above ${THIN_MARGIN_PCT}%`}</small>
        </a>
      </div>

      <nav className="seg mb-4" aria-label="View">
        {VIEWS.map((v) => <Link key={v.key} href={v.key === "orders" ? "/payments/margin" : `/payments/margin?by=${v.key}`} aria-current={view === v.key ? "page" : undefined}>{v.label}</Link>)}
      </nav>

      {view === "orders" ? (
        <section className="card" id="orders" aria-label="Orders, thinnest first">
          {orders.length === 0 ? <p className="cash-none">No orders with rates yet.</p> : (
            <ul className="cash-items mgn-list">
              {orders.map((m) => (
                <li key={m.row.id}>
                  <Link href={`/orders/${m.row.id}`} className="cash-item">
                    <span className="min-w-0">
                      <b>{m.row.order_no} · {buyerLabel(m.row.buyer_id) || "Buyer"}</b>
                      <small>
                        {[m.row.status === "shipped" ? `Shipped ${dayNear(m.row.shipped_on ?? m.row.ship_date, today)}` : m.billed ? "Part billed" : "From the rates",
                          `${money(Math.round(m.sale))} sale`,
                          Number(m.row.refunds) > 0 && `${money(Number(m.row.refunds))} refunded`,
                          Number(m.row.recovered) > 0 && `${money(Number(m.row.recovered))} claimed from factories`,
                          m.plan.missing > 0 && `${m.plan.missing} ${m.plan.missing === 1 ? "style" : "styles"} without a rate`].filter(Boolean).join(" · ")}
                      </small>
                      {m.slip != null && m.slip < -2 && <small className="text-warn">{Math.abs(m.slip).toFixed(1)} points below its planned {pct(m.plan.pct)}</small>}
                    </span>
                    <span className="mgn-amt">
                      <b className={`num ${marginCls(m.pct)}`}>{pct(m.pct)}</b>
                      <small className="num">{signedLakh(m.margin)}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="card" aria-label={view === "buyers" ? "By buyer" : "By factory"}>
          <ul className="cash-items mgn-list">
            {groups.map((g) => (
              <li key={g.key}>
                <div className="cash-item">
                  <span className="min-w-0 grow">
                    <b>{g.name || "—"}</b>
                    <small>{g.orders} {g.orders === 1 ? "order" : "orders"} · {lakh(g.sale)} sale</small>
                    <span className="mgn-bar" aria-hidden><i className={g.margin < 0 ? "neg" : ""} style={{ width: `${(Math.abs(g.margin) / peak) * 100}%` }} /></span>
                  </span>
                  <span className="mgn-amt">
                    <b className={`num ${marginCls(g.pct)}`}>{pct(g.pct)}</b>
                    <small className="num">{signedLakh(g.margin)}</small>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {view === "factories" && <p className="cash-later">A factory&apos;s share is its sales less its bills; refunds and claims are counted on the order.</p>}
        </section>
      )}

      <details className="howto">
        <summary>How margin is worked out</summary>
        <p>From the rates: each style&apos;s buyer rate less its factory rate, times its pieces. Once a factory&apos;s goods are billed, its purchase bill and our invoice (both before GST) replace the rates. A shipped order counts only what was billed.</p>
        <p>Refunds agreed on buyer claims come off; claims passed to factories come back. Freight, samples and overheads are not in it yet. Under {THIN_MARGIN_PCT}% shows amber, a loss red.</p>
        {missing > 0 && <p>{missing} {missing === 1 ? "order has" : "orders have"} a style without a rate; those styles are left out until the rate is set on the order.</p>}
      </details>
    </>
  );
}
