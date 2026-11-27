import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getMe } from "@/lib/auth";
import { TeamTabs } from "../team-tabs";
import { EXPORTS } from "./exports";
import "@/components/ops.css";

// The company's data: Excel downloads for anyone with the Download data switch, and for the owner the activity log
// and what keeps the system safe.
export default async function DataPage() {
  const me = await getMe();
  if (!me?.companyId || !can(me, "export")) redirect("/");
  const owner = me.role === "owner";
  const list = EXPORTS.filter((e) => !e.money || can(me, "money"));
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{owner ? "Team" : "Download data"}</h1>
          <p>Your data is always yours. Every download is a real Excel file with what you are allowed to see today.</p>
        </div>
      </div>
      {owner && <TeamTabs at="data" />}
      <section className="card">
        <div className="data-head">
          <div className="grow">
            <h2>Download to Excel</h2>
            <p>One file with a sheet for each list below, or one list at a time.</p>
          </div>
          <a className="btn primary" href="/team/data/download" download>Download everything</a>
        </div>
        <ul className="data-list">
          {list.map((e) => (
            <li key={e.key}>
              <span className="grow min-w-0"><b>{e.label}</b><small>{e.hint}</small></span>
              <a className="btn sm" href={`/team/data/download?what=${e.key}`} download aria-label={`Download ${e.label} to Excel`}>Excel</a>
            </li>
          ))}
          {owner && (
            <li>
              <span className="grow min-w-0"><b>Activity log</b><small>Every change anyone made, kept forever. Pick dates and people first, then download.</small></span>
              <Link className="btn sm" href="/activity">Open</Link>
            </li>
          )}
        </ul>
      </section>
      {owner && (
        <section className="panel">
          <h2 className="text-base font-semibold">Keeping it safe</h2>
          <ul className="data-checks mt-3">
            <li><span>Every hour a check opens the app, the website, sign-in and the database. If one stops answering, GitHub emails you within the hour.</span></li>
            <li><span>The same check watches the Tally reader, the Gmail PO pickup and the free-plan storage limits.</span></li>
            <li><span>Who can see money and download data is set per person on People.</span></li>
          </ul>
        </section>
      )}
    </>
  );
}
