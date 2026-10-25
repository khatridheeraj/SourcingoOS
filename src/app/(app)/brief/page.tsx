import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { briefText, buildBrief, teamCopy, type BriefData } from "@/lib/brief";
import { createClient } from "@/lib/supabase/server";
import { BriefShare } from "./brief-share";
import { PageTabs } from "@/components/page-tabs";
import { REPORT_TABS } from "@/lib/page-groups";

// The morning brief: what is at risk, late or waiting today, in one screen and one message to send.
// The same brief arrives by email at 9 am from the Gmail script.
export default async function BriefPage() {
  const me = await getMe();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("brief_data");
  if (error || !data) {
    return <div className="errbox">The brief couldn&apos;t be made: {error?.message ?? "no data"}. Reload the page.</div>;
  }
  const d = data as BriefData;
  const b = buildBrief(d);
  const first = (me?.fullName ?? me?.email.split("@")[0] ?? "").split(" ")[0];

  return (
    <>
      {canEditOrders(me?.role) && <PageTabs tabs={REPORT_TABS} label="Reports" />}
      <div className="head">
        <div className="grow">
          <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Morning brief · {b.title}</p>
          <h1>{first ? `${first}, ` : ""}{b.headline.charAt(0).toLowerCase() + b.headline.slice(1)}</h1>
        </div>
        <div className="head-acts"><BriefShare text={briefText(teamCopy(b), d.company)} /></div>
      </div>
      {b.sections.length === 0 ? (
        <section className="card"><p className="card-empty">Nothing is late, at risk or waiting on you.</p></section>
      ) : b.sections.map((s) => (
        <section key={s.key} className="card" aria-labelledby={`b-${s.key}`}>
          <header className="card-h"><div className="min-w-0"><h2 id={`b-${s.key}`}>{s.title}</h2></div><span className={`chip ${s.tone}`}>{s.items.length}</span></header>
          <ul className="brief-list">
            {s.items.map((i, n) => (
              <li key={n}>
                <Link href={i.href}>
                  <span className={`sev ${s.tone}`} aria-hidden />
                  <span className="min-w-0">
                    <b>{i.text}</b>
                    {i.sub && <small>{i.sub}</small>}
                  </span>
                  <span className="brief-go" aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="muted text-[12.5px]">
        Late steps push back the steps after them, so &quot;at risk&quot; means a style will likely be ready after its ship date unless the factory catches up.
        The same brief comes by email at 9 am to mailboxes where the Sourcingo Gmail script runs.
      </p>
    </>
  );
}
