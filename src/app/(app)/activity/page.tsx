import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivityList } from "@/components/activity-list";
import { Empty, Head, Tile } from "@/components/bits";
import { ACTIONS, AREAS, type Entry } from "@/lib/activity";
import { loadWorld } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { addDays, nf } from "@/lib/model";
import { roleLabel, type Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { filterQuery, queryActivity, readFilters } from "./query";

export const metadata = { title: "Activity log · Sourcingo OS" };
const PAGE = 100;

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const { world: w, me } = await loadWorld();
  if (!me) redirect("/login");
  if (me.role !== "owner") redirect("/");
  const sp = await searchParams;
  const f = readFilters(sp);
  const before = Number(sp.before) || 0;
  const supabase = await createClient();

  let q = queryActivity(supabase, f);
  if (before) q = q.lt("id", before);
  const today = todayIST();
  const since = (d: string) => supabase.from("audit_log").select("id", { count: "exact", head: true }).gte("at", `${d}T00:00:00+05:30`);
  const [{ data, error }, t, wk, all, people] = await Promise.all([
    q.limit(PAGE),
    since(today),
    since(addDays(today, -6)),
    supabase.from("audit_log").select("id", { count: "estimated", head: true }),
    supabase.from("audit_log").select("actor").gte("at", `${today}T00:00:00+05:30`).not("actor", "is", null).limit(1000),
  ]);
  const entries = (data ?? []) as unknown as Entry[];
  const activeToday = new Set((people.data ?? []).map((r) => r.actor as string)).size;
  const filtered = Object.values(f).some(Boolean);
  const qs = filterQuery(f);
  const older = entries.length === PAGE ? `/activity?${qs ? qs + "&" : ""}before=${entries[entries.length - 1].id}` : null;
  const staff = [...w.people].filter((p) => p.role).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

  return (
    <>
      <Head crumbs="Reports › Activity log" title="Activity log"
        sub="Every change anyone makes, in the app, through imports, email pickup or Tally, kept forever. Nobody can edit or delete these entries, including you.">
        <a className="btn" href={`/activity/export${qs ? `?${qs}` : ""}`}>Download CSV</a>
      </Head>
      <div className="tiles">
        <Tile tone="blue" label="Changes today" value={nf(t.count ?? 0)} note={`${activeToday} ${activeToday === 1 ? "person" : "people"} active`} />
        <Tile tone="green" label="Last 7 days" value={nf(wk.count ?? 0)} />
        <Tile tone="yellow" label="Recorded in all" value={nf(all.count ?? 0)} note="Kept forever" />
      </div>
      <form className="panel acts-filters" method="get">
        <label className="field"><span>Who</span>
          <select className="inp" name="who" defaultValue={f.who}>
            <option value="">Everyone</option>
            {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email} · {roleLabel(p.role as Role)}</option>)}
            <option value="database">Imports and admin work</option>
            <option value="api">Tally bridge / API key</option>
            <option value="server">Automatic jobs</option>
          </select>
        </label>
        <label className="field"><span>Area</span>
          <select className="inp" name="area" defaultValue={f.area}>
            <option value="">All areas</option>
            {Object.entries(AREAS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
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
        <label className="field"><span>Record no.</span><input className="inp" name="q" defaultValue={f.q} placeholder="SO-000012, GRN-…" /></label>
        <div className="row">
          <button className="btn primary" type="submit">Show</button>
          {filtered && <Link className="btn" href="/activity">Clear</Link>}
        </div>
      </form>
      {error && <p className="errbox">Couldn&apos;t load the activity log: {error.message}</p>}
      {entries.length ? (
        <section className="panel">
          <ActivityList entries={entries} w={w} linkRecords byDay />
          <div className="row mt-3">
            {before > 0 && <Link className="btn" href={`/activity${qs ? `?${qs}` : ""}`}>← Newest</Link>}
            {older && <Link className="btn" href={older}>Older →</Link>}
          </div>
        </section>
      ) : (
        <Empty title={filtered || before ? "Nothing matches" : "Nothing recorded yet"}>
          {filtered ? "Try a wider date range or another person." : "Changes appear here as soon as anyone saves something."}
        </Empty>
      )}
    </>
  );
}
