import Link from "next/link";
import { redirect } from "next/navigation";
import { PageTabs } from "@/components/page-tabs";
import { canEditOrders, getMe } from "@/lib/auth";
import { fetchAll } from "@/lib/fetch-all";
import { day, nowMs, todayIST } from "@/lib/format";
import { REPLY_HOURS } from "@/lib/inquiries";
import { buildFunnel, hoursText, type LeadRow } from "@/lib/leads";
import { reportTabs } from "@/lib/page-groups";
import { addDays } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

const LEAD_RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "1 year", days: 365 },
];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

// Leads: how many buyers asked, how fast we answered, how many got a price, a sample and an order, from where, and
// why the rest were lost. Every lead is an inquiry; nothing here is typed in separately.
export default async function LeadsPage({ searchParams }: PageProps<"/reports/leads">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const range = LEAD_RANGES.find((r) => r.key === sp.range) ?? LEAD_RANGES[1];
  const today = todayIST();
  const from = addDays(today, -range.days);
  const supabase = await createClient();
  const { data, error } = await fetchAll<LeadRow>((a, z) => supabase.from("inquiries")
    .select("id, inquiry_no, status, source, from_site, asked_on_page, country, created_at, first_reply_at, quoted_price, sample_sent_on, sample_in_on, lost_reason, next_follow_up")
    .eq("company_id", me.companyId!).gte("created_at", `${from}T00:00:00+05:30`).order("created_at").order("id").range(a, z));
  const rows = data ?? [];
  const f = buildFunnel(rows, nowMs(), today);
  const top = f.steps[0].n;

  const kpis = [
    { key: "leads", label: "Leads", value: String(top), sub: `${f.open} still open` },
    { key: "reply", label: `Replied within ${REPLY_HOURS} hours`, value: pct(f.replyInDay, f.replyCounted),
      sub: f.replyCounted ? `${f.replyInDay} of ${f.replyCounted}${f.replyMedianHours != null ? ` · usually ${hoursText(f.replyMedianHours)}` : ""}` : "Counted from 28 Nov",
      cls: !f.replyCounted ? "" : f.replyInDay / f.replyCounted >= 0.9 ? "text-ok" : f.replyInDay / f.replyCounted >= 0.7 ? "text-warn" : "text-bad" },
    { key: "won", label: "Won", value: String(f.won), sub: f.winRate != null ? `${f.winRate}% of ${f.won + f.lost} decided` : "None decided yet" },
    { key: "late", label: "Follow-ups late", value: String(f.followLate), sub: f.followLate ? "Past their follow-up date" : "Nothing late", cls: f.followLate ? "text-bad" : "" },
  ];

  return (
    <>
      <PageTabs tabs={reportTabs(me.role)} label="Reports" />
      <div className="head">
        <div className="grow">
          <h1>Leads</h1>
          <p>Every buyer who asked since {day(from)}: how fast we answered, and how far each got.</p>
        </div>
        <nav className="seg" aria-label="Range">
          {LEAD_RANGES.map((x) => <Link key={x.key} href={`/reports/leads?range=${x.key}`} aria-current={x.key === range.key ? "page" : undefined} scroll={false}>{x.label}</Link>)}
        </nav>
      </div>
      {error && <div className="errbox" role="alert">Couldn&apos;t load every lead just now. Refresh in a minute.</div>}

      {f.waiting.length > 0 && (
        <section className="card" aria-labelledby="wait-h">
          <header className="card-h"><div className="min-w-0"><h2 id="wait-h">Waiting for a first reply</h2><p>Every lead hears back within {REPLY_HOURS} hours. Open one and mark how you replied.</p></div></header>
          <ul className="lead-wait">
            {f.waiting.map((l) => {
              const h = Math.floor((nowMs() - Date.parse(l.created_at)) / 3_600_000);
              return (
                <li key={l.id}>
                  <Link href={`/inquiries/${l.id}`} className="link code">{l.inquiry_no}</Link>
                  <span className="grow muted">{l.from_site ? `Website${l.country ? ` · ${l.country}` : ""}` : l.asked_on_page ? "Buyer page" : "Logged by the team"}</span>
                  <span className={`chip ${h >= REPLY_HOURS ? "bad" : "warn"}`}>{h >= REPLY_HOURS ? `No reply in ${hoursText(h)}` : `${hoursText(h)} so far`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.key} className="kpi">
            <span className="kpi-label"><i aria-hidden />{k.label}</span>
            <b className={`num ${k.cls ?? ""}`}>{k.value}</b>
            <small>{k.sub}</small>
          </div>
        ))}
      </div>

      <section className="card" aria-labelledby="fun-h">
        <header className="card-h"><div className="min-w-0"><h2 id="fun-h">How far leads get</h2><p>Each bar is a share of every lead in this range. A lead that got a price had heard back, even if no reply was marked.</p></div></header>
        {top === 0 ? <p className="card-empty">No leads in this range yet.</p> : (
          <ul className="bars lead-funnel">
            {f.steps.map((s) => (
              <li key={s.key}>
                <span>{s.label}</span>
                <i aria-hidden><b style={{ width: `${Math.max(2, Math.round((s.n / top) * 100))}%`, background: s.key === "order" ? "var(--ok)" : "var(--accent)" }} /></i>
                <span className="num">{s.n}</span>
                <small className="muted num">{pct(s.n, top)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="ch-h">
          <header className="card-h"><div className="min-w-0"><h2 id="ch-h">Where leads came from</h2><p>Leads, how many got a price, and how many became orders.</p></div></header>
          {f.channels.length === 0 ? <p className="card-empty">No leads in this range yet.</p> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Came by</th><th className="num">Leads</th><th className="num">Priced</th><th className="num">Won</th></tr></thead>
                <tbody>
                  {f.channels.map((c) => (
                    <tr key={c.key}><td className="font-semibold">{c.label}</td><td className="num">{c.n}</td><td className="num">{c.priced}</td><td className={`num ${c.won ? "text-ok" : ""}`}>{c.won || "–"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card" aria-labelledby="lost-h">
          <header className="card-h"><div className="min-w-0"><h2 id="lost-h">Why leads were lost</h2><p>The reason picked when each was marked lost.</p></div></header>
          {f.lostReasons.length === 0 ? <p className="card-empty">None lost in this range.</p> : (
            <ul className="lead-reasons">
              {f.lostReasons.map((r) => <li key={r.reason}><span className="grow">{r.reason}</span><b className="num">{r.n}</b></li>)}
            </ul>
          )}
        </section>
      </div>

      {f.countries.length > 0 && (
        <section className="card" aria-labelledby="ctry-h">
          <header className="card-h"><div className="min-w-0"><h2 id="ctry-h">Website leads by country</h2><p>As the buyer gave it on the costing form.</p></div></header>
          <ul className="lead-reasons">
            {f.countries.map((c) => <li key={c.country}><span className="grow">{c.country}</span><b className="num">{c.n}</b></li>)}
          </ul>
        </section>
      )}

      <details className="howto">
        <summary>How leads are counted</summary>
        <p>A lead is any inquiry: logged by the team, asked on a buyer&apos;s page or sent from the website&apos;s costing form. It counts in the range it was asked in.</p>
        <p>Heard back means someone marked the first reply on the inquiry, or sent a price or a sample. Reply speed is kept from 28 Nov 2026; a lead counts once it was answered or a day has passed without an answer.</p>
        <p>Won means it became an order. The win rate is out of leads already decided, won or lost, so open ones don&apos;t pull it down.</p>
      </details>
    </>
  );
}
