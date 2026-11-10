import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { day, dayAt, money, todayIST } from "@/lib/format";
import { bySupplier, dueOf, isMsme45, lakh, MSME_DAYS, MSME_LABEL, supplierName, totals } from "@/lib/payables";
import { dm } from "@/lib/quick";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "../payments/load";
import { BillList, type BillRow } from "./bill-list";
import { loadClaims, loadPayables } from "./load";
import { billKey, CLAIM_REASON, openByBill } from "@/lib/claims";
import { TermsForm } from "./terms-form";
import { PageTabs } from "@/components/page-tabs";
import { MONEY_TABS } from "@/lib/page-groups";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const VIEWS = [{ key: "due", label: "By due date" }, { key: "suppliers", label: "By supplier" }, { key: "claims", label: "Claims" }];
const WHO = [{ key: "all", label: "All" }, { key: "factories", label: "Factories" }, { key: "others", label: "Other suppliers" }];

// Bills to pay: every supplier bill in Tally with money left on it, when it falls due, and the MSME 45-day limit.
// Read from Tally only. Paying happens in the bank and is booked in Tally as always; this page follows it.
export default async function PayablesPage({ searchParams }: PageProps<"/payables">) {
  const me = await getMe();
  if (!isFinance(me?.role)) redirect("/");
  const sp = await searchParams;
  const p = (k: string) => String(sp[k] ?? "").trim();
  const view = VIEWS.some((v) => v.key === p("view")) ? p("view") : "due";
  const who = WHO.some((w) => w.key === p("who")) ? p("who") : "all";
  const one = p("s");
  const today = todayIST();
  const supabase = await createClient();
  const [{ bills, error, readAt, tallyOn }, { claims }] = await Promise.all([loadPayables(supabase), loadClaims(supabase)]);
  const claimOn = openByBill(claims);

  const shown = bills
    .filter((b) => who === "all" || (who === "factories") === !!b.factory_id)
    .filter((b) => !one || b.ledger === one);
  const t = totals(shown, today);
  const link = (extra: Record<string, string>) => `/payables?${new URLSearchParams(Object.entries({ view, who, s: one, ...extra }).filter(([, v]) => v && v !== "all" && v !== "due"))}`;
  const rows: BillRow[] = shown
    .map((b) => {
      const c = b.bill ? claimOn.get(billKey(b.ledger, b.bill)) : undefined;
      return { ...b, key: `${b.ledger}|${b.bill ?? ""}`, name: supplierName(b), due: dueOf(b, today), claimed: c?.amount ?? 0, claims: (c?.claims ?? []).map((x) => ({ claim_no: x.claim_no, amount: Number(x.amount) })) };
    })
    .sort((a, z) => (a.due_on ?? "9").localeCompare(z.due_on ?? "9") || z.open - a.open);
  const suppliers = bySupplier(shown, today);
  // Name who the late MSME bills are owed to, so the banner says whom to pay first without hunting the list.
  const msmeWho = [...new Set(rows.filter((r) => isMsme45(r.msme) && r.due_on && r.due_on < today).map((r) => r.name))];
  const oneName = one ? suppliers[0]?.name ?? one : "";
  // No bills and Tally never read: there is nothing to count yet, so "₹0" and "every bill is paid" would mislead.
  const unread = !bills.length && !error && (!tallyOn || !readAt);

  return (
    <>
      <PageTabs tabs={MONEY_TABS} label="Money" />
      <div className="head">
        <div className="grow">
          <h1>{oneName ? oneName : "Bills to pay"}</h1>
          <p>
            Factory and supplier bills from Tally with money left on them, and when each falls due.
            {readAt ? ` Tally read ${dayAt(readAt)} ${new Date(readAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}.` : ""}
          </p>
        </div>
        {one && <Link className="btn" href={`/payables?${new URLSearchParams(Object.entries({ view, who }).filter(([, v]) => v !== "all" && v !== "due"))}`}>All suppliers</Link>}
      </div>

      {error && <div className="errbox">Couldn&apos;t load the bills: {error.message}. Reload to try again.</div>}
      {unread && (
        <div className="warnbox">
          {tallyOn ? "Bills come from Tally, and Tally hasn't been read yet. They show here after the first read." : "Bills come from Tally, and Tally isn't being read yet."}{" "}
          See the <Link className="link" href="/tally">Tally</Link> page.
        </div>
      )}

      {!unread && (
        <>
          <div className="kpis bills-kpis">
            <Link href={link({ view: "due" })} className={`kpi ${t.overdue ? "bad" : "ok"}`}>
              <span className="kpi-label"><i aria-hidden />Overdue</span><b className="num">{lakh(t.overdue)}</b>
              <small>{t.overdueBills ? `${t.overdueBills} ${t.overdueBills === 1 ? "bill" : "bills"} past due` : "Nothing late"}</small>
            </Link>
            <Link href={link({ view: "due" })} className={`kpi ${t.week ? "warn" : ""}`}>
              <span className="kpi-label"><i aria-hidden />Due in 7 days</span><b className="num">{lakh(t.week)}</b>
              <small>{t.weekBills ? `${t.weekBills} ${t.weekBills === 1 ? "bill" : "bills"}` : "Nothing this week"}</small>
            </Link>
            <div className="kpi"><span className="kpi-label"><i aria-hidden />To pay in 30 days</span><b className="num">{lakh(t.month)}</b><small>{!t.overdue ? "Nothing overdue" : t.overdue >= t.month ? "All of it overdue" : `${lakh(t.overdue)} of it overdue`}</small></div>
            <div className="kpi"><span className="kpi-label"><i aria-hidden />Total to pay</span><b className="num">{lakh(t.owed)}</b><small>{plural(new Set(shown.map((b) => b.ledger)).size, "supplier")}</small></div>
          </div>

          {t.msmeLate > 0 && (
            <div className="latebox" role="status">
              <b>{t.msmeLate} MSME {t.msmeLate === 1 ? "bill" : "bills"} past {MSME_DAYS} days, {money(Math.round(t.msmeLateAmount))}</b>
              {msmeWho.length ? `, owed to ${msmeWho.length > 3 ? `${msmeWho.slice(0, 3).join(", ")} and ${msmeWho.length - 3} more` : msmeWho.join(", ")}` : ""}.{" "}
              Pay {t.msmeLate === 1 ? "it" : "them"} first: the law sets interest on late MSME bills.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <nav className="seg" aria-label="View">
              {VIEWS.map((v) => <Link key={v.key} href={link({ view: v.key })} aria-current={view === v.key ? "page" : undefined}>{v.label}</Link>)}
            </nav>
            {!one && (
              <nav className="seg" aria-label="Suppliers">
                {WHO.map((w) => <Link key={w.key} href={link({ who: w.key })} aria-current={who === w.key ? "page" : undefined}>{w.label}</Link>)}
              </nav>
            )}
          </div>

          {!shown.length ? (
            <div className="empty"><b>{error ? "Couldn't load the bills" : bills.length ? "No bills here" : "Nothing to pay"}</b>{bills.length ? "Try All." : "Every bill in Tally is paid."}</div>
          ) : view === "claims" ? (
            <ClaimsList claims={claims.filter((c) => !one || c.ledger === one)} today={today} />
          ) : view === "suppliers" ? (
            <section className="card" aria-label="Suppliers">
              <ul className="suppliers">
                {suppliers.map((s) => (
                  <li key={s.ledger}>
                    <div className="sup-top">
                      <div className="min-w-0">
                        <Link className="sup-name" href={`/payables?s=${encodeURIComponent(s.ledger)}`}>{s.name}</Link>
                        <div className="sup-sub dots">
                          <span>
                            <span>{s.bills.filter((b) => b.bill).length} {s.bills.filter((b) => b.bill).length === 1 ? "bill" : "bills"}</span>
                            {s.nextDue && <span>{s.nextDue < today ? "oldest due" : "next due"} {dm(s.nextDue)}</span>}
                            {!s.factoryId && <span>not a factory in the app</span>}
                          </span>
                        </div>
                        <div className="bill-tags">
                          {!isMsme45(s.msme) && <span className="chip">{s.days} days</span>}
                          {s.msme && <span className={`chip ${isMsme45(s.msme) ? "warn" : ""}`}>{MSME_LABEL[s.msme]}{isMsme45(s.msme) ? ` · ${MSME_DAYS} days by law` : ""}</span>}
                          {!s.msme && <span className="chip">MSME not known</span>}
                        </div>
                      </div>
                      <div className="sup-amt">
                        <b className="num">{money(Math.round(s.owed))}</b>
                        {s.overdue > 0 ? <span className="chip bad">{lakh(s.overdue)} overdue</span> : <span className={`chip ${s.worst.tone}`}>{s.worst.text}</span>}
                      </div>
                    </div>
                    <details className="sup-terms">
                      <summary>Terms</summary>
                      <TermsForm ledger={s.ledger} days={s.days} msme={s.msme} udyam={s.udyam} />
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <BillList rows={rows} today={today} />
          )}
        </>
      )}

      <details className="howto">
        <summary>How bills are counted</summary>
        <p>
          A bill is paid when Tally has a payment or debit note against it. Payments made on account, with no bill named, are set against the oldest bills first,
          so the total always matches the supplier&apos;s balance in Tally. Due dates count from the date the bill is booked in Tally:
          the supplier&apos;s payment days (60 unless set), or {MSME_DAYS} days for a micro or small enterprise. Nothing here changes Tally.
        </p>
        <p>
          By law (MSMED Act) micro and small enterprises are paid within {MSME_DAYS} days. Late, interest runs at three times the bank rate,
          and the amount can&apos;t be claimed as an expense until it is paid (income tax 43B(h)).
        </p>
      </details>
    </>
  );
}

type ClaimView = Awaited<ReturnType<typeof loadClaims>>["claims"][number];
// Every claim raised, newest first: open ones (not in Tally yet) on top, then booked, then cancelled.
function ClaimsList({ claims, today }: { claims: ClaimView[]; today: string }) {
  const order = { open: 0, booked: 1, cancelled: 2 } as const;
  const list = [...claims].sort((a, z) => order[a.state] - order[z.state] || z.claim_date.localeCompare(a.claim_date));
  const open = list.filter((c) => c.state === "open");
  if (!list.length) {
    return <div className="empty"><b>No claims yet</b>Open a bill under By due date and tap Raise a claim when goods come short, fail QC or arrive late.</div>;
  }
  return (
    <section className="card" aria-labelledby="claims-h">
      <header className="card-h">
        <div className="min-w-0">
          <h2 id="claims-h">Factory claims</h2>
          <p>{open.length ? <><b className="text-warn">{open.length} not in Tally yet</b>, {money(Math.round(open.reduce((a, c) => a + Number(c.amount), 0)))} kept back from payments</> : "Every claim is booked in Tally"}</p>
        </div>
      </header>
      <ul className="rows">
        {list.map((c) => (
          <li key={c.id} className="claim-row">
            <Link href={`/payables/claims/${encodeURIComponent(c.claim_no)}`} className="min-w-0">
              <b><span className="code">{c.claim_no}</span>{supplierName({ factory: null, ledger: c.ledger })}</b>
              <small className="dots"><span>
                <span>{CLAIM_REASON[c.reason]}</span>
                {c.bill && <span>bill {c.bill}</span>}
                {c.order_no && <span>{c.order_no}</span>}
                <span>{dm(c.claim_date)}{c.claim_date.slice(0, 4) !== today.slice(0, 4) ? ` ${c.claim_date.slice(0, 4)}` : ""}</span>
              </span></small>
            </Link>
            <span className="claim-amt">
              <b className={`num ${c.state === "cancelled" ? "muted line-through" : ""}`}>{money(Math.round(Number(c.amount)))}</b>
              {c.state === "open" ? <span className="chip warn">Not in Tally yet</span>
                : c.state === "booked" ? <span className="text-xs text-ok">In Tally {c.booked?.number ? `${c.booked.number}, ` : ""}{day(c.booked!.on)}</span>
                : <span className="text-xs muted">Cancelled</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
