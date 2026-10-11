import Link from "next/link";
import { redirect } from "next/navigation";
import { AREAS, describe, type Entry, hrefFor, OTHER_AREA, sourceLabel, when, who } from "@/lib/activity";
import { getMe, type Role, roleLabel } from "@/lib/auth";
import { loadTeam, personName } from "@/lib/data";
import { nowMs, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { filterQuery, loadNames, queryActivity, readFilters } from "./query";

const PAGE = 100;
const SHOWN = 6;
const ACTIONS = { insert: "Added", update: "Changed", delete: "Deleted" };

// Every change anyone has made, for the owner. Entries are permanent: nobody can edit or delete them.
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) redirect("/");
  const company = me.companyId;
  const sp = await searchParams;
  const f = readFilters(sp);
  const before = Number(sp.before) || 0;
  const supabase = await createClient();
  const today = todayIST();
  const count = (since: string) => supabase.from("history").select("id", { count: "exact", head: true }).eq("company_id", company).gte("at", `${since}T00:00:00+05:30`);
  const weekAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(nowMs() - 6 * 86_400_000));

  let q = queryActivity(supabase, company, f);
  if (before) q = q.lt("id", before);
  const [{ data, error }, names, team, t, wk, all] = await Promise.all([
    q.limit(PAGE), loadNames(company), loadTeam(), count(today), count(weekAgo),
    supabase.from("history").select("id", { count: "exact", head: true }).eq("company_id", company),
  ]);
  const entries = (data ?? []) as Entry[];
  const qs = filterQuery(f);
  const filtered = Boolean(qs);
  const older = entries.length === PAGE ? `/activity?${qs ? `${qs}&` : ""}before=${entries[entries.length - 1].id}` : null;
  const days = entries.map((e) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(e.at)));

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Activity log</h1>
          <p>Every change anyone makes, in the app, by PO pickup, the Tally reader or an import, kept forever. Nobody can edit or delete these entries, including you.</p>
        </div>
        <a className="btn" href={`/activity/export${qs ? `?${qs}` : ""}`}>Download CSV</a>
      </div>
      <div className="tiles">
        <div className="tile"><span>Changes today</span><b>{t.count ?? 0}</b></div>
        <div className="tile"><span>Last 7 days</span><b>{wk.count ?? 0}</b></div>
        <div className="tile"><span>Recorded in all</span><b>{all.count ?? 0}</b></div>
      </div>
      <form className="panel fgrid" method="get">
        <label className="field"><span>Who</span>
          <select className="inp" name="who" defaultValue={f.who}>
            <option value="">Everyone</option>
            {team.map((m) => <option key={m.user_id} value={m.user_id}>{personName(m)} · {roleLabel(m.role as Role)}</option>)}
            <option value="key">Tally reader and PO pickup</option>
            <option value="server">Automatic jobs</option>
            <option value="database">Admin and imports</option>
          </select>
        </label>
        <label className="field"><span>Area</span>
          <select className="inp" name="area" defaultValue={f.area}>
            <option value="">All areas</option>
            {Object.entries(AREAS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
            <option value={OTHER_AREA.key}>{OTHER_AREA.label}</option>
          </select>
        </label>
        <label className="field"><span>What</span>
          <select className="inp" name="action" defaultValue={f.action}>
            <option value="">Anything</option>
            {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field"><span>From</span><input className="inp" type="date" name="from" defaultValue={f.from} max={today} /></label>
        <label className="field"><span>To</span><input className="inp" type="date" name="to" defaultValue={f.to} max={today} /></label>
        <div className="row self-end">
          <button className="btn primary">Show</button>
          {filtered && <Link className="btn" href="/activity">Clear</Link>}
        </div>
      </form>
      {error && <p className="errbox">Couldn&apos;t load the activity log: {error.message}</p>}
      {entries.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
            <tbody>
              {entries.map((e, i) => {
                const d = describe(e, names);
                const href = hrefFor(e);
                const src = e.actor ? sourceLabel(e) : null;
                return [
                  days[i] !== days[i - 1] && <tr key={`d${e.id}`}><td colSpan={3} className="bg-surface-2 text-xs font-bold">{days[i]}</td></tr>,
                  <tr key={e.id}>
                    <td className="whitespace-nowrap muted text-xs">{when(e.at)}</td>
                    <td className="whitespace-nowrap">{who(e, names)}{src && <div className="text-xs muted">{src}</div>}</td>
                    <td>
                      {href ? <Link className="link" href={href}>{d.text}</Link> : <b>{d.text}</b>}
                      {d.changes.length > 0 && (
                        <ul className="mt-1 text-[13px]">
                          {d.changes.slice(0, SHOWN).map((c) => <li key={c.field}><span className="muted">{c.label}:</span> {c.from} → <b>{c.to}</b></li>)}
                        </ul>
                      )}
                      {(d.fields.length > 0 || d.changes.length > SHOWN) && (
                        <details className="mt-1 text-[13px]">
                          <summary className="cursor-pointer muted">{d.changes.length > SHOWN ? `${d.changes.length - SHOWN} more changes` : e.action === "delete" ? "What was deleted" : "Details"}</summary>
                          <ul>
                            {d.changes.slice(SHOWN).map((c) => <li key={c.field}><span className="muted">{c.label}:</span> {c.from} → <b>{c.to}</b></li>)}
                            {d.fields.map((x) => <li key={x.label}><span className="muted">{x.label}:</span> {x.value}</li>)}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty"><b>{filtered || before ? "Nothing matches" : "Nothing recorded yet"}</b>{filtered ? "Try a wider date range or someone else." : "Changes appear here as soon as anyone saves something."}</div>
      )}
      {(before > 0 || older) && (
        <div className="row">
          {before > 0 && <Link className="btn" href={`/activity${qs ? `?${qs}` : ""}`}>← Newest</Link>}
          {older && <Link className="btn" href={older}>Older →</Link>}
        </div>
      )}
    </>
  );
}
