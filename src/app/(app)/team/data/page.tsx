import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getMe } from "@/lib/auth";
import { dayAtNear, nowMs } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { TeamTabs } from "../team-tabs";
import { EXPORTS } from "./exports";
import "@/components/ops.css";

// The company's data: Excel downloads for anyone with the Download data switch, and for the owner the activity log
// and what keeps the system safe.
export default async function DataPage() {
  const me = await getMe();
  if (!me?.companyId || !can(me, "export")) redirect("/");
  const owner = me.role === "owner";
  const list = EXPORTS.filter((e) => (!e.money || can(me, "money")) && (!e.buyers || can(me, "buyers")));
  const backups = owner ? await loadBackups() : [];
  const lastGood = backups.find((b) => b.file && !b.error);
  const fresh = !!lastGood && nowMs() - Date.parse(lastGood.started_at) < 30 * 3600e3;
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
        <section className="card">
          <div className="data-head">
            <div className="grow">
              <h2>Nightly backups</h2>
              <p>Every night at 2:20 am a full copy of the database is saved. The last 14 nights are kept.</p>
            </div>
          </div>
          {backups.length ? (
            <ul className="data-list">
              {backups.slice(0, 7).map((b) => (
                <li key={b.id}>
                  <span className="grow min-w-0">
                    <b>{dayAtNear(b.started_at)}</b>
                    <small className={b.error ? "text-bad" : undefined}>
                      {b.error ? "Didn't finish. The next night tries again." : b.file ? `${size(b.bytes)} · ${b.tables} lists · ${(b.rows ?? 0).toLocaleString("en-IN")} rows` : "Cleared after 14 nights"}
                    </small>
                  </span>
                  {b.file && !b.error && <a className="btn sm" href={`/team/data/backup/${b.id}`} aria-label={`Download the backup from ${dayAtNear(b.started_at)}`}>Download</a>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm muted">The first copy is saved tonight at 2:20 am.</p>
          )}
        </section>
      )}
      {owner && (
        <section className="panel">
          <h2 className="text-base font-semibold">Keeping it safe</h2>
          <ul className="data-checks mt-3">
            <li><span>Every hour a check opens the app, the website, sign-in and the database. If one stops answering, GitHub emails you within the hour.</span></li>
            <li><span>The same check watches the Tally reader, the Gmail PO pickup and the free-plan storage limits.</span></li>
            <li className={fresh ? undefined : "off"}><span>{fresh ? "Last night's backup was saved." : "No backup in the last 30 hours yet."} If a night is missed, the hourly check emails you.</span></li>
            <li><span>Who can see money and download data is set per person on People.</span></li>
          </ul>
        </section>
      )}
    </>
  );
}

type Backup = { id: number; started_at: string; file: string | null; bytes: number | null; tables: number | null; rows: number | null; error: string | null };

async function loadBackups(): Promise<Backup[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("backup_list");
  return (data ?? []) as Backup[];
}

const size = (b: number | null) => (b == null ? "" : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
