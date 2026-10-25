import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { loadSampleThreads, type SampleThread } from "@/lib/samples-server";
import { SampleThreadCard } from "./sample-thread";

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
// Samples not sent yet show once their target is two weeks away (or passed), so the list is what to chase now.
const CHASE_DAYS = 14;

const TABS = [
  { key: "check", label: "To check", hint: "Factories sent these. Check the photos, then send each to the buyer with its AWB, or send it back." },
  { key: "buyer", label: "With buyer", hint: "Waiting for the buyer to approve or ask for changes. Longest waiting first." },
  { key: "changes", label: "Changes", hint: "The buyer or the team asked for changes. The factory sends the next round from its panel." },
  { key: "chase", label: "Not sent", hint: `Samples due in the next ${CHASE_DAYS} days or late, that the factory hasn't sent yet.` },
  { key: "approved", label: "Approved", hint: "Approved in the last 30 days. Each approval closed its TNA step." },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Fit, strike off, PP and size-set samples across the open orders: what to check, what the buyer has, what to chase.
export default async function SamplesPage({ searchParams }: PageProps<"/samples">) {
  const sp = await searchParams;
  const me = await getMe();
  const today = todayIST();
  const { threads, error } = await loadSampleThreads();
  const last = (t: SampleThread) => t.rounds[t.rounds.length - 1];
  const since = (t: SampleThread) => last(t)?.dispatched_on ?? last(t)?.forwarded_at ?? last(t)?.sent_at ?? "";
  const lists: Record<Tab, SampleThread[]> = {
    check: threads.filter((t) => t.state === "with_team").sort((a, b) => since(a).localeCompare(since(b))),
    buyer: threads.filter((t) => t.state === "with_buyer").sort((a, b) => since(a).localeCompare(since(b))),
    changes: threads.filter((t) => t.state === "changes" || t.state === "returned").sort((a, b) => (last(a)?.answered_at ?? "").localeCompare(last(b)?.answered_at ?? "")),
    chase: threads.filter((t) => t.state === "not_sent" && !!t.target && t.target <= addDays(today, CHASE_DAYS)).sort((a, b) => a.target!.localeCompare(b.target!)),
    approved: threads.filter((t) => t.state === "approved" && (last(t)?.approved_on ?? "") >= addDays(today, -30))
      .sort((a, b) => (last(b)?.approved_on ?? "").localeCompare(last(a)?.approved_on ?? "")),
  };
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab)
    : (TABS.find((t) => lists[t.key].length)?.key ?? "check");
  const lateChase = lists.chase.filter((t) => t.target! < today).length;
  const oldBuyer = lists.buyer.filter((t) => since(t) && Date.parse(today) - Date.parse(since(t).slice(0, 10)) >= 5 * 86_400_000).length;
  const team = canEditOrders(me?.role);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Samples</h1>
          {(lateChase > 0 || oldBuyer > 0) && (
            <p>
              {lateChase > 0 && <b className="text-bad">{lateChase} past target and not sent.</b>}
              {lateChase > 0 && oldBuyer > 0 && " "}
              {oldBuyer > 0 && <b className="text-warn">{oldBuyer} with the buyer 5+ days.</b>}
            </p>
          )}
        </div>
      </div>

      {error && <div className="errbox">Couldn&apos;t load every sample, so this list may be incomplete. Reload to try again. ({error})</div>}

      <section className="card" aria-labelledby="smp-h">
        <header className="card-h">
          <h2 id="smp-h" className="min-w-0">{TABS.find((t) => t.key === tab)?.label}</h2>
          <nav className="seg" aria-label="Show">
            {TABS.map((t) => (
              <Link key={t.key} href={`/samples?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} scroll={false}>{t.label} <span>{lists[t.key].length}</span></Link>
            ))}
          </nav>
        </header>
        {lists[tab].length === 0 ? (
          <p className="card-empty">
            {tab === "check" ? "No samples waiting to be checked." : tab === "buyer" ? "No samples with buyers right now." : tab === "changes" ? "No changes waiting on factories."
              : tab === "chase" ? `No samples due in the next ${CHASE_DAYS} days that haven't been sent.` : "Nothing approved in the last 30 days."}
          </p>
        ) : (
          <div className="smp-list">
            {lists[tab].map((t) => <SampleThreadCard key={t.key} t={t} today={today} readOnly={!team} />)}
          </div>
        )}
        <details className="howto border-t border-line px-4 py-3">
          <summary>How samples work</summary>
          <p>Factories send samples from their panel. You check the photos and courier each one, then the buyer approves or asks for changes in the app. An approval closes its TNA step.</p>
          {TABS.map((t) => <p key={t.key}><b>{t.label}:</b> {t.hint}</p>)}
        </details>
      </section>
    </>
  );
}
