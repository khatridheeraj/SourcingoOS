import Link from "next/link";
import { redirect } from "next/navigation";
import { loadNotes, type TeamNote } from "@/components/help/actions";
import { getMe } from "@/lib/auth";
import { topicById } from "@/lib/help-guide";
import { createClient } from "@/lib/supabase/server";
import { NoteDecide } from "./note-decide";

const TABS = [
  { key: "new", label: "Waiting", has: (n: TeamNote) => n.status === "new" },
  { key: "planned", label: "Going ahead", has: (n: TeamNote) => n.status === "planned" },
  { key: "later", label: "Later", has: (n: TeamNote) => n.status === "later" },
  { key: "closed", label: "Closed", has: (n: TeamNote) => n.status === "done" || n.status === "declined" },
  { key: "asked", label: "Questions asked", has: () => false },
];

type Ask = { id: string; question: string; page: string | null; topic: string | null; helpful: boolean | null; created_at: string; sender: string };

const at = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// What the team, factories and buyers tell the owner through Help, and what they asked it. The owner decides on each note
// and the sender sees the answer in Help. Claude reads new notes every morning and writes a suggested fix on each.
export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  const me = await getMe();
  if (me?.role !== "owner") redirect("/today");
  const sp = await searchParams;
  const show = TABS.some((t) => t.key === sp.show) ? String(sp.show) : "new";
  const supabase = await createClient();
  const [{ notes, error }, { data: askData }] = await Promise.all([loadNotes(), supabase.rpc("help_asks_list")]);
  const asks = (askData ?? []) as Ask[];
  const unanswered = asks.filter((a) => !a.topic || a.helpful === false);
  const tab = TABS.find((t) => t.key === show)!;
  const list = notes.filter(tab.has);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Team notes</h1>
          <p>Problems, wrong data and ideas sent from Help by the team, factories and buyers. Decide on each one; the sender sees your answer in Help.</p>
        </div>
      </div>

      <section className="kpis" aria-label="Summary">
        <Link href="/feedback" className={`kpi${notes.some((n) => n.status === "new") ? " warn" : ""}`}>
          <span className="kpi-label"><i />Waiting for you</span><b>{notes.filter((n) => n.status === "new").length}</b><small>Not decided yet</small>
        </Link>
        <Link href="/feedback?show=planned" className="kpi">
          <span className="kpi-label"><i />Going ahead</span><b>{notes.filter((n) => n.status === "planned").length}</b><small>Claude builds these</small>
        </Link>
        <Link href="/feedback?show=asked" className={`kpi${unanswered.length ? " warn" : ""}`}>
          <span className="kpi-label"><i />Not answered by Help</span><b>{unanswered.length}</b><small>Last 30 days, of {asks.length} asked</small>
        </Link>
        <Link href="/feedback?show=closed" className="kpi">
          <span className="kpi-label"><i />Closed</span><b>{notes.filter((n) => n.status === "done" || n.status === "declined").length}</b><small>Done or not doing</small>
        </Link>
      </section>

      <nav className="seg" aria-label="Show">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "new" ? "/feedback" : `/feedback?show=${t.key}`} aria-current={show === t.key ? "page" : undefined}>
            {t.label} <span>{t.key === "asked" ? asks.length : notes.filter(t.has).length}</span>
          </Link>
        ))}
      </nav>

      {error && <div className="errbox">Couldn&apos;t load the notes: {error}</div>}

      {show === "asked" ? (
        <section className="card" aria-labelledby="asked-h">
          <header className="card-h">
            <div>
              <h2 id="asked-h">What people asked Help</h2>
              <p>Questions Help had no answer for, or whose answer didn&apos;t help, come first. Claude adds the missing answers to the guide.</p>
            </div>
          </header>
          {asks.length === 0 ? <p className="card-empty">Nobody has asked Help anything yet.</p> : (
            <ul className="rows">
              {[...unanswered, ...asks.filter((a) => !unanswered.includes(a))].map((a) => {
                const t = a.topic ? topicById(a.topic) : null;
                const bad = !a.topic || a.helpful === false;
                return (
                  <li key={a.id} className="tidy-row">
                    <div className="min-w-0">
                      <div className="font-medium">{a.question}</div>
                      <div className="text-[12.5px] text-muted">
                        {a.sender} · {at.format(new Date(a.created_at))}{a.page ? ` · ${a.page}` : ""}
                        {t ? ` · answered with "${t.q}"` : ""}
                      </div>
                    </div>
                    <span className={`chip ${bad ? "warn" : a.helpful ? "ok" : ""}`}>
                      {!a.topic ? "No answer" : a.helpful === false ? "Didn't help" : a.helpful ? "Helped" : "Answered"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : list.length === 0 ? (
        <section className="card"><p className="card-empty">{show === "new" ? "Nothing waiting. Every note has your answer." : "No notes here."}</p></section>
      ) : (
        <div className="notes-grid">
          {list.map((n) => <NoteDecide key={n.id} n={n} />)}
        </div>
      )}
    </>
  );
}
