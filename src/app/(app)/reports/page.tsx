import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { loadBuyers, loadFactories } from "@/lib/data";
import { day, PLAN_HOURS, qty, todayIST } from "@/lib/format";
import { addDays } from "@/lib/payments";
import { buildReport, percent, RANGES, type FactoryScore } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { PageTabs } from "@/components/page-tabs";
import { REPORT_TABS } from "@/lib/page-groups";

// Below 80% on time or passed is a problem worth a call; below 90% is worth watching.
const tone = (a: number, b: number) => (!b ? "" : a / b >= 0.9 ? "text-ok" : a / b >= 0.8 ? "text-warn" : "text-bad");

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[1];
  const today = todayIST();
  const supabase = await createClient();
  const [buyers, factories] = await Promise.all([loadBuyers(), loadFactories()]);
  const r = await buildReport(supabase, me.companyId, addDays(today, -range.days), today, buyers, factories);
  const t = r.total;
  const avgLate = (f: FactoryScore) => (f.steps.done - f.steps.onTime ? (f.steps.lateDays / (f.steps.done - f.steps.onTime)).toFixed(1) : "–");

  const kpis = [
    { key: "steps", label: "TNA steps on time", value: percent(t.steps.onTime, t.steps.done), sub: `${qty(t.steps.onTime)} of ${qty(t.steps.done)} done by their target`, cls: tone(t.steps.onTime, t.steps.done) },
    { key: "qc", label: "Final QC passed", value: percent(t.qc.passed, t.qc.checked), sub: `${t.qc.passed} of ${t.qc.checked} final checks`, cls: tone(t.qc.passed, t.qc.checked) },
    { key: "plans", label: `Plans within ${PLAN_HOURS} hours`, value: percent(t.plans.inTime, t.plans.asked), sub: `${t.plans.inTime} of ${t.plans.asked} factory TNAs asked for`, cls: tone(t.plans.inTime, t.plans.asked) },
    { key: "ship", label: "Lots shipped on time", value: percent(t.lots.onTime, t.lots.shipped), sub: `${t.lots.onTime} of ${t.lots.shipped} lots · ${qty(t.lots.pcs)} pcs`, cls: tone(t.lots.onTime, t.lots.shipped) },
  ];

  return (
    <>
      <PageTabs tabs={REPORT_TABS} label="Reports" />
      <div className="head">
        <div className="grow">
          <h1>Reports</h1>
          <p>How factories keep to the TNA, pass QC, send plans and ship on time, since {day(r.from)}. {t.openLate ? <b className="text-bad">{qty(t.openLate)} steps overdue right now.</b> : null}</p>
        </div>
        <nav className="seg" aria-label="Range">
          {RANGES.map((x) => <Link key={x.key} href={`/reports?range=${x.key}`} aria-current={x.key === range.key ? "page" : undefined} scroll={false}>{x.label}</Link>)}
        </nav>
        <a href={`/reports/csv?range=${range.key}`} className="btn">Download CSV</a>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.key} className="kpi">
            <span className="kpi-label"><i aria-hidden />{k.label}</span>
            <b className={`num ${k.cls}`}>{k.value}</b>
            <small>{k.sub}</small>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="fac-h">
        <header className="card-h"><div className="min-w-0"><h2 id="fac-h">Factory scorecard</h2><p>Green at 90% or more, amber from 80%, red below. Steps count when they are done, against their target date.</p></div></header>
        {r.factories.length === 0 ? <p className="card-empty">Nothing done, checked or shipped in this range yet.</p> : (
          <>
          {/* On a phone: one block per factory with its four numbers. */}
          <ul className="score-list show-phone">
            {r.factories.map((f) => (
              <li key={f.id}>
                <b>{f.name}{f.openLate ? <span className="chip bad ml-2">{f.openLate} overdue</span> : null}</b>
                <dl>
                  <div><dt>Steps on time</dt><dd className={tone(f.steps.onTime, f.steps.done)}>{percent(f.steps.onTime, f.steps.done)}</dd></div>
                  <div><dt>Final QC passed</dt><dd className={tone(f.qc.passed, f.qc.checked)}>{percent(f.qc.passed, f.qc.checked)}</dd></div>
                  <div><dt>Plans in {PLAN_HOURS}h</dt><dd className={tone(f.plans.inTime, f.plans.asked)}>{percent(f.plans.inTime, f.plans.asked)}</dd></div>
                  <div><dt>Shipped on time</dt><dd className={tone(f.lots.onTime, f.lots.shipped)}>{percent(f.lots.onTime, f.lots.shipped)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="table-wrap hide-phone">
            <table className="tbl report-tbl">
              <thead><tr><th>Factory</th><th className="num">Steps on time</th><th className="num" title="Average over the steps that finished late">Avg days late</th><th className="num">Overdue now</th><th className="num">Final QC passed</th><th className="num">Plans in {PLAN_HOURS}h</th><th className="num">Shipped on time</th><th className="num">Pieces</th></tr></thead>
              <tbody>
                {r.factories.map((f) => (
                  <tr key={f.id}>
                    <td><Link href={`/factories`} className="font-semibold">{f.name}</Link></td>
                    <td className={`num ${tone(f.steps.onTime, f.steps.done)}`}>{percent(f.steps.onTime, f.steps.done)} <small className="muted">{f.steps.onTime}/{f.steps.done}</small></td>
                    <td className="num">{avgLate(f)}</td>
                    <td className={`num ${f.openLate ? "text-bad" : ""}`}>{f.openLate || "–"}</td>
                    <td className={`num ${tone(f.qc.passed, f.qc.checked)}`}>{percent(f.qc.passed, f.qc.checked)} <small className="muted">{f.qc.passed}/{f.qc.checked}</small></td>
                    <td className={`num ${tone(f.plans.inTime, f.plans.asked)}`}>{percent(f.plans.inTime, f.plans.asked)} <small className="muted">{f.plans.inTime}/{f.plans.asked}</small></td>
                    <td className={`num ${tone(f.lots.onTime, f.lots.shipped)}`}>{percent(f.lots.onTime, f.lots.shipped)} <small className="muted">{f.lots.onTime}/{f.lots.shipped}</small></td>
                    <td className="num">{f.lots.pcs ? qty(f.lots.pcs) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="step-h">
          <header className="card-h"><div className="min-w-0"><h2 id="step-h">Steps on time, by step</h2><p>How many of each TNA step were done by their target, across all styles, in this range.</p></div></header>
          {r.steps.length === 0 ? <p className="card-empty">No steps done in this range yet.</p> : (
            <ul className="bars">
              {r.steps.map((s) => (
                <li key={s.key}>
                  <span>{s.label}</span>
                  <i aria-hidden><b style={{ width: `${Math.round((s.onTime / s.done) * 100)}%`, background: `var(--${tone(s.onTime, s.done).replace("text-", "") || "faint"})` }} /></i>
                  <span className={`num ${tone(s.onTime, s.done)}`}>{percent(s.onTime, s.done)}</span>
                  <small className="muted num">{s.done - s.onTime ? `${s.done - s.onTime} late` : "all on time"}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="buy-h">
          <header className="card-h"><div className="min-w-0"><h2 id="buy-h">Buyers</h2><p>Lots shipped in this range, against the order&apos;s ship date.</p></div></header>
          {r.buyers.length === 0 ? <p className="card-empty">Nothing shipped in this range yet.</p> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Buyer</th><th className="num">Lots</th><th className="num">On time</th><th className="num">Pieces</th><th className="num">GRN late</th></tr></thead>
                <tbody>
                  {r.buyers.map((b) => (
                    <tr key={b.id}>
                      <td className="font-semibold">{b.name}</td>
                      <td className="num">{b.lots}</td>
                      <td className={`num ${tone(b.onTime, b.lots)}`}>{percent(b.onTime, b.lots)}</td>
                      <td className="num">{qty(b.pcs)}</td>
                      <td className={`num ${b.grnLate ? "text-bad" : ""}`}>{b.grnLate || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
