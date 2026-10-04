import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip, Empty, Head, Tile } from "@/components/bits";
import { AutoForm, ClickRow } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { addDays, allCheckpoints, fmtDay, isoIST, isLocked, type Order, overdue } from "@/lib/model";
import { isOps } from "@/lib/roles";

export const metadata = { title: "TNA dashboard · Sourcingo OS" };

const PRESETS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["thisWeek", "This week"], ["lastWeek", "Last week"], ["thisMonth", "This month"],
  ["lastMonth", "Last month"], ["thisQuarter", "This quarter"], ["lastQuarter", "Last quarter"], ["custom", "Custom"],
] as const;

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
function rangeFor(preset: string, today: string, from: string, to: string): [string, string] {
  const t = new Date(today + "T00:00:00Z");
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), q = Math.floor(m / 3);
  const mon = addDays(today, -((t.getUTCDay() + 6) % 7));
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "thisWeek": return [mon, addDays(mon, 6)];
    case "lastWeek": return [addDays(mon, -7), addDays(mon, -1)];
    case "lastMonth": return [ymd(y, m - 1, 1), ymd(y, m, 0)];
    case "thisQuarter": return [ymd(y, q * 3, 1), ymd(y, q * 3 + 3, 0)];
    case "lastQuarter": return [ymd(y, q * 3 - 3, 1), ymd(y, q * 3, 0)];
    case "custom": return [from || today, to || from || today];
    default: return [ymd(y, m, 1), ymd(y, m + 1, 0)];
  }
}

export default async function TnaDashboard({ searchParams }: PageProps<"/tna">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const sp = await searchParams;
  const p = (k: string) => String(sp[k] ?? "");
  const preset = PRESETS.some(([k]) => k === p("preset")) ? p("preset") : p("from") || p("to") ? "custom" : "thisMonth";
  const { world: w } = await loadWorld();
  const [from, to] = rangeFor(preset, w.today, p("from"), p("to"));
  const f = { merch: p("merch"), factory: p("factory"), buyer: p("buyer") };
  const match = (o: Order) => (!f.merch || o.merchandiser_id === f.merch) && (!f.factory || o.factory_id === f.factory) && (!f.buyer || o.buyer_id === f.buyer);

  const list = w.orders.filter((o) => o.status === "locked" || o.status === "shipped").filter(match).flatMap((o) =>
    allCheckpoints(o)
      .filter(({ cp }) => cp.due_date && cp.due_date >= from && cp.due_date <= to)
      .map(({ style, cp }) => ({
        o, style, cp,
        ontime: cp.status === "completed" && !!cp.status_updated_at && isoIST(cp.status_updated_at) <= cp.due_date!,
        late: overdue(cp, w.today),
      })),
  );
  const lockedIn = w.orders.filter((o) => isLocked(o) && match(o) && o.locked_at && isoIST(o.locked_at) >= from && isoIST(o.locked_at) <= to);
  const pending = w.orders.filter((o) => !isLocked(o) && match(o)).length;
  const inc = list.filter((x) => x.cp.status !== "completed").sort((a, b) => a.cp.due_date!.localeCompare(b.cp.due_date!));
  const comp = list.filter((x) => x.cp.status === "completed");
  const ot = comp.filter((x) => x.ontime).length;
  const byF = new Map<string, { due: number; done: number; ot: number; late: number }>();
  for (const x of list) {
    const k = x.o.factory_id ?? "";
    const r = byF.get(k) ?? { due: 0, done: 0, ot: 0, late: 0 };
    r.due++;
    if (x.cp.status === "completed") r.done++;
    if (x.ontime) r.ot++;
    if (x.late) r.late++;
    byF.set(k, r);
  }
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...extra });
    return `/tna?${q.toString()}`;
  };
  const merchs = w.people.filter((x) => x.active && ["merchandiser", "manager", "owner"].includes(x.role ?? ""));

  return (
    <>
      <Head crumbs="Manufacturing › TNA dashboard" title="TNA dashboard" sub="Monitor TNA metrics and activities." />
      <section className="panel">
        <div className="stack">
          <span className="sub">Date range</span>
          <nav className="filters" aria-label="Date range">
            {PRESETS.filter(([k]) => k !== "custom").map(([k, l]) => (
              <Link key={k} href={keep({ preset: k })} className="pill" aria-current={preset === k ? "page" : undefined}>{l}</Link>
            ))}
            <span className="pill" aria-current={preset === "custom" ? "page" : undefined}>Custom</span>
          </nav>
          <AutoForm key={`${from}${to}`} className="fgrid">
            <input type="hidden" name="preset" value={preset} />
            <label className="field"><span>Start date</span><input type="date" name="from" className="inp" defaultValue={from} data-clears="preset" /></label>
            <label className="field"><span>End date</span><input type="date" name="to" className="inp" defaultValue={to} data-clears="preset" /></label>
            <label className="field"><span>Point of contact</span>
              <select name="merch" className="inp" defaultValue={f.merch}>
                <option value="">All merchandisers</option>
                {merchs.map((x) => <option key={x.id} value={x.id}>{x.full_name || x.email}</option>)}
              </select>
            </label>
            <label className="field"><span>Factory</span>
              <select name="factory" className="inp" defaultValue={f.factory}>
                <option value="">All factories</option>
                {w.factories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Buyer</span>
              <select name="buyer" className="inp" defaultValue={f.buyer}>
                <option value="">All buyers</option>
                {w.buyers.map((b) => <option key={b.id} value={b.id}>{b.real_name ? `${b.code} · ${b.real_name}` : b.code}</option>)}
              </select>
            </label>
          </AutoForm>
        </div>
      </section>
      <div className="tiles">
        <Tile tone="blue" label="SO styles (confirmed)" value={lockedIn.reduce((a, o) => a + o.styles.length, 0)} note={`In TNAs locked ${fmtDay(from)} – ${fmtDay(to)}`} />
        <Tile tone="green" label="TNA locked" value={lockedIn.length} note="Sales orders locked in range" />
        <Tile tone="yellow" label="TNA pending lock" value={pending} note="Draft or in review now" href="/orders?status=tna_review" />
        <Tile alarm={inc.some((x) => x.late)} label="Incomplete activities" value={inc.length} note={`${inc.filter((x) => x.late).length} overdue · ${inc.filter((x) => x.cp.status === "delayed").length} delayed`} />
        <Tile tone="pink" label="On-time completion" value={`${comp.length ? Math.round((ot / comp.length) * 100) : 0}%`} note={`${ot} of ${comp.length} completed on time`} />
      </div>
      <div className="two">
        <section className="panel">
          <h2>Incomplete activities</h2>
          <p className="-mt-1.5 mb-3 text-xs text-muted">Targeted to be completed in the selected date range</p>
          {inc.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Due</th><th>Activity</th><th>Style</th><th>SO</th><th>Factory</th><th>POC</th><th>Status</th></tr></thead>
                <tbody>
                  {inc.map((x) => (
                    <ClickRow key={x.cp.id} href={`/orders/${x.o.id}`}>
                      <td className="num whitespace-nowrap">{fmtDay(x.cp.due_date)}{x.late && <><br /><Chip status="overdue" /></>}</td>
                      <td><b>{x.cp.name}</b></td>
                      <td>{x.style.name}<br /><span className="text-xs text-muted">{x.style.colour}</span></td>
                      <td className="code"><Link href={`/orders/${x.o.id}`} className="text-accent">{x.o.id}</Link><br /><span className="text-muted">{w.buyerCode(x.o.buyer_id)}</span></td>
                      <td>{w.factoryName(x.o.factory_id)}</td>
                      <td>{w.personName(x.o.merchandiser_id)}</td>
                      <td><Chip status={x.cp.status} /></td>
                    </ClickRow>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No incomplete activities">Nothing due in this range for the selected filters.</Empty>
          )}
        </section>
        <section className="panel">
          <h2>Factory performance</h2>
          <p className="-mt-1.5 mb-3 text-xs text-muted">Activities due in the range, by factory</p>
          {byF.size ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Factory</th><th>Due</th><th>Done</th><th>On time</th><th>Overdue</th></tr></thead>
                <tbody>
                  {[...byF].map(([k, r]) => (
                    <tr key={k}>
                      <td>{w.factoryName(k)}</td>
                      <td className="num">{r.due}</td>
                      <td className="num">{r.done}</td>
                      <td className="num">{r.done ? Math.round((r.ot / r.done) * 100) : 0}%</td>
                      <td className="num" style={r.late ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{r.late}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No activities in this range.</p>
          )}
        </section>
      </div>
    </>
  );
}
