import Link from "next/link";
import { redirect } from "next/navigation";
import "@/components/factory-bits.css";
import { canEnterDone, getMe } from "@/lib/auth";
import { buyerName, loadBuyers } from "@/lib/data";
import { type DefectStats, KIND_WORDS, passByMonth, per100, rankFactories } from "@/lib/defects";
import { dayAtNear, dayNear, qty, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { FactoriesTabs } from "../factories-tabs";
import { SeenButton } from "./seen-button";

type Rating = { id: string; order_id: string; buyer_id: string; score: number; comment: string | null; created_at: string; seen_at: string | null; orders: { order_no: string } | { order_no: string }[] | null };

// Quality as a number: first-time Final QC by month, the defects we find most, each factory's defect rate, and what
// buyers said about their delivered orders. Every figure comes from QC checks and ratings already on record.
export default async function QualityPage() {
  const me = await getMe();
  if (!canEnterDone(me?.role)) redirect("/");
  const supabase = await createClient();
  const today = todayIST();
  const [{ data: statsRow, error }, { data: rateRows }, { data: byFactory }, buyers] = await Promise.all([
    supabase.rpc("defect_stats", { p_days: 365 }),
    supabase.from("order_ratings").select("id, order_id, buyer_id, score, comment, created_at, seen_at, orders(order_no)").order("created_at", { ascending: false }).limit(50),
    supabase.rpc("factory_ratings"),
    loadBuyers(),
  ]);
  const s = (statsRow ?? { top: [], factories: [], kinds: [], months: [], since: today }) as DefectStats;
  const months = passByMonth(s.months, today);
  const firsts = months.reduce((a, m) => a + m.firsts, 0);
  const passed = s.months.reduce((a, m) => a + m.passed, 0);
  const passPct = firsts ? Math.round((passed / firsts) * 100) : null;
  const checked = s.factories.reduce((a, f) => a + f.pieces_checked, 0);
  const found = s.factories.reduce((a, f) => a + f.defects, 0);
  const rate = per100(found, checked);
  const ratings = (rateRows ?? []) as Rating[];
  const avg = ratings.length ? Math.round((ratings.reduce((a, r) => a + r.score, 0) / ratings.length) * 10) / 10 : null;
  const factoriesOf = new Map<string, string[]>();
  for (const r of (byFactory ?? []) as { order_id: string; factory_id: string }[]) {
    const name = s.factories.find((f) => f.factory_id === r.factory_id)?.name;
    factoriesOf.set(r.order_id, [...(factoriesOf.get(r.order_id) ?? []), ...(name ? [name] : [])]);
  }
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const ranked = rankFactories(s.factories);
  const maxTop = Math.max(1, ...s.top.map((t) => t.pieces));

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Factories</h1>
          <p className="hide-phone">Quality as a number: what our checks find, factory by factory, and how buyers rated what they received.</p>
        </div>
      </div>
      <FactoriesTabs at="quality" />
      {error && <div className="errbox">{error.message}</div>}

      <section className="kpis cash-kpis" aria-label="Quality in the last 12 months">
        <div className={`kpi ${passPct != null && passPct < 75 ? "warn" : ""}`}>
          <span className="kpi-label"><i />Final QC passed first time</span>
          <b className="num">{passPct == null ? "–" : `${passPct}%`}</b>
          <small>{firsts ? `${passed} of ${firsts} styles, last 12 months` : "No Final QC in the last 12 months"}</small>
        </div>
        <div className="kpi">
          <span className="kpi-label"><i />Defects per 100 pieces</span>
          <b className="num">{rate == null ? "–" : rate}</b>
          <small>{checked ? `${qty(found)} in ${qty(checked)} pcs checked since ${dayNear(s.since)}` : "Shows after 100 pieces checked"}</small>
        </div>
        <div className={`kpi ${avg != null && avg < 4 ? "warn" : ""}`}>
          <span className="kpi-label"><i />Buyers&apos; rating</span>
          <b className="num">{avg == null ? "–" : `${avg} / 5`}</b>
          <small>{ratings.length ? `${ratings.length} delivered ${ratings.length === 1 ? "order" : "orders"} rated` : "Buyers rate an order on their page once it ships"}</small>
        </div>
      </section>

      <section className="card" aria-labelledby="pass-h">
        <div className="card-h"><div><h2 id="pass-h">First-time Final QC, month by month</h2><p>Share of styles whose first Final check passed.</p></div></div>
        <ol className="q-months" aria-label="By month">
          {months.map((m) => (
            <li key={m.month} title={m.firsts ? `${m.pct}% of ${m.firsts}` : "No Final QC"}>
              <span className="q-bar"><i className={m.pct != null && m.pct < 75 ? "warn" : ""} style={{ height: `${m.pct ?? 0}%` }} /></span>
              <b className="num">{m.pct == null ? "" : `${m.pct}%`}</b>
              <small>{m.label}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="top-h">
        <div className="card-h"><div><h2 id="top-h">Defects we find most</h2><p>Every check since {dayNear(s.since)}, Inline to Final.</p></div></div>
        {s.top.length === 0 ? <p className="card-empty">No defects written on a check yet. Quality lists them on each failed check.</p> : (
          <ul className="q-list">
            {s.top.map((t) => (
              <li key={t.defect}>
                <span className="grow min-w-0"><b>{t.defect}</b><small className="muted num">{qty(t.pieces)} pcs · {t.checks} {t.checks === 1 ? "check" : "checks"}{t.critical ? ` · ${qty(t.critical)} critical` : ""}</small></span>
                <span className="q-hbar" aria-hidden><i style={{ width: `${Math.round((t.pieces / maxTop) * 100)}%` }} className={t.critical ? "bad" : ""} /></span>
              </li>
            ))}
          </ul>
        )}
        {s.kinds.length > 0 && (
          <p className="q-kinds num">
            {s.kinds.map((k) => `${KIND_WORDS[k.kind] ?? k.kind}: ${k.failed} of ${k.checks} failed`).join(" · ")}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="fac-h">
        <div className="card-h"><div><h2 id="fac-h">By factory</h2><p>Most defects per 100 pieces first. Open a factory for its full record.</p></div></div>
        {ranked.length === 0 ? <p className="card-empty">No checks on record yet.</p> : (
          <ul className="q-list">
            {ranked.map((f) => (
              <li key={f.factory_id}>
                <span className="grow min-w-0">
                  <Link href={`/factories/${f.factory_id}`} className="link font-semibold">{f.name}</Link>
                  <small className="muted">{f.top.length ? f.top.map((t) => `${t.defect} ${qty(t.pieces)}`).join(" · ") : "No defects listed"}</small>
                </span>
                <span className="text-right num">
                  <b className={f.rate != null && f.rate >= 5 ? "text-warn" : ""}>{f.rate == null ? "–" : `${f.rate} per 100`}</b>
                  <small className="block muted">{f.failed} of {f.checks} {f.checks === 1 ? "check" : "checks"} failed</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="ratings" className="card scroll-mt-20" aria-labelledby="rate-h">
        <div className="card-h"><div><h2 id="rate-h">What buyers said</h2><p>Private to us. A rating of 3 or less waits on Home until someone reads it.</p></div></div>
        {ratings.length === 0 ? <p className="card-empty">No ratings yet. Buyers rate each order on their page once its goods have left.</p> : (
          <ul className="q-list">
            {ratings.map((r) => {
              const no = (Array.isArray(r.orders) ? r.orders[0] : r.orders)?.order_no ?? "";
              return (
                <li key={r.id}>
                  <span className="grow min-w-0">
                    <span className="row gap-2"><span className={`stars ${r.score <= 3 ? "low" : ""}`} aria-label={`${r.score} of 5`}>{"★".repeat(r.score)}<s>{"★".repeat(5 - r.score)}</s></span>
                      <Link href={`/orders/${r.order_id}`} className="link code">{no}</Link><span className="muted">{buyerOf.get(r.buyer_id) ?? ""}</span></span>
                    {r.comment && <span className="block">“{r.comment}”</span>}
                    <small className="muted">{[(factoriesOf.get(r.order_id) ?? []).join(", "), dayAtNear(r.created_at, today)].filter(Boolean).join(" · ")}</small>
                  </span>
                  {r.score <= 3 && !r.seen_at && <SeenButton id={r.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="howto">
        <summary>How these are worked out</summary>
        <p>First time: for each style, whether its first Final check passed, by the month of that check. A check saved for a whole order counts for every factory on it. Cancelled checks and cancelled orders don&apos;t count.</p>
        <p>Defects: the defect lists Quality writes on each check, grouped by name whatever the spelling of capitals. Per 100 pieces shows once 100 pieces are checked.</p>
        <p>Ratings: the buyer gives 1 to 5 stars and a comment on its page once goods have left, and may change it for 30 days. Factories never see a single rating, only their average once three buyers have rated.</p>
      </details>
    </>
  );
}
