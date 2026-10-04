import Link from "next/link";
import { AlertList, Head, Pills, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks, loadWorld } from "@/lib/data";
import { addDays, alertsFor, allCheckpoints, computeAlerts, isOpenSample, isoIST, money, nf, orderValue, overdue, sampleOnTime, sumByCur } from "@/lib/model";
import { FINANCE_ACTIONS, isLive, QUICK_ACTIONS } from "@/lib/nav";
import { paymentAlerts } from "@/lib/payments";
import { isFinance, isInternal, isOps } from "@/lib/roles";

export const metadata = { title: "My day · Sourcingo OS" };

const INQ = [["new", "New"], ["quoted", "Quoted"], ["converted", "Converted"], ["lost", "Lost"]] as const;

// One home for everyone: what needs me today, then the shape of the business.
export default async function MyDay({ searchParams }: PageProps<"/">) {
  const me = await getMe();
  if (!me?.role || !isInternal(me.role)) {
    return (
      <section className="warnbox">
        <h2 className="text-lg font-bold">Waiting for approval</h2>
        <p>Your account is set up. The owner needs to give you a role before you can see any orders.</p>
      </section>
    );
  }
  const sp = await searchParams;
  const { world: w, error } = await loadWorld();
  const ops = isOps(me.role);
  const finance = isFinance(me.role);
  const lead = me.role === "owner" || me.role === "manager";
  const books = finance ? (await loadBooks()).books : null;
  const payAlerts = books ? paymentAlerts(books, (id) => w.buyerCode(id)) : [];
  const all = computeAlerts(w);
  const rank = { bad: 0, warn: 1, info: 2, note: 3 };
  const roleAlerts = [...(ops ? all : all.filter((a) => /^\/(grn|dc|samples)/.test(a.href))), ...payAlerts]
    .filter((a) => isLive(a.href))
    .sort((a, z) => rank[a.sev] - rank[z.sev]);
  const scope = sp.who === "all" || sp.who === "mine" ? String(sp.who) : me.role === "owner" ? "all" : "mine";
  const mine = alertsFor(roleAlerts, me.id);
  const shown = scope === "all" ? roleAlerts : mine;

  const t = w.today;
  const running = w.orders.filter((o) => o.status === "locked");
  const myOrders = (o: (typeof running)[number]) => scope === "all" || o.merchandiser_id === me.id || o.manager_id === me.id;
  const cps = running.filter(myOrders).flatMap((o) => allCheckpoints(o).map((x) => x.cp));
  const dueToday = cps.filter((cp) => cp.due_date === t && cp.status !== "completed").length;
  const overdueN = cps.filter((cp) => overdue(cp, t)).length;
  const held = w.lateGrns().length;
  const openSamples = w.samples.filter(isOpenSample);
  const samplesSoon = openSamples.filter((s) => s.due_date && s.due_date >= t && s.due_date <= addDays(t, 3)).length;
  const samplesLate = openSamples.filter((s) => s.due_date && s.due_date < t).length;
  const poWaiting = w.fpos.filter((p) => p.status === "issued").length;
  const poDeclined = w.fpos.filter((p) => p.status === "declined").length;
  const grnToday = w.grns.filter((g) => isoIST(g.received_at) === t);
  const dcToday = w.dcs.filter((d) => d.status === "dispatched" && d.dispatched_at && isoIST(d.dispatched_at) === t);
  const waiting = me.role === "owner" ? w.people.filter((p) => !p.active).length : 0;
  const actions = [...(ops ? QUICK_ACTIONS : []), ...(finance ? FINANCE_ACTIONS : [])];
  const day = new Date(w.now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  const hour = Number(new Date(w.now).toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = (me.fullName || me.email).split(/[ @]/)[0];

  return (
    <>
      <Head title={`${hello}, ${name}`} sub={`${day}. ${mine.filter((a) => a.sev === "bad").length ? `${mine.filter((a) => a.sev === "bad").length} urgent thing${mine.filter((a) => a.sev === "bad").length === 1 ? "" : "s"} need you.` : "Nothing urgent on your plate."}`} />
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      {waiting > 0 && (
        <Link href="/team" className="warnbox font-semibold">
          {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting for you to approve them →
        </Link>
      )}
      <div className="tiles">
        {ops && isLive("/tna") && <Tile alarm={overdueN > 0} label="Overdue TNA steps" value={overdueN} note={`${dueToday} due today`} href="/tna?preset=today" />}
        {isLive("/samples") && <Tile alarm={samplesLate > 0} label="Samples due in 3 days" value={samplesSoon} note={samplesLate ? `${samplesLate} late` : `${openSamples.length} open`} href={samplesLate ? "/samples?show=late" : "/samples?show=week"} />}
        {ops && isLive("/fpos") && <Tile tone="yellow" alarm={poDeclined > 0} label="Factory POs waiting" value={poWaiting} note={poDeclined ? `${poDeclined} declined` : "Not yet accepted"} href="/fpos?status=open" />}
        {isLive("/grn") && <Tile alarm={held > 0} label="Goods held over 24h" value={held} note="Must be zero" href="/grn?status=held" />}
        {isLive("/grn") && <Tile tone="green" label="Received today" value={grnToday.length} note={sumByCur(grnToday.map((g) => [w.grnValue(g), w.currencyOf(g.so_id)]))} href="/grn" />}
        {isLive("/dc") && <Tile tone="pink" label="Dispatched today" value={dcToday.length} note={sumByCur(dcToday.map((d) => [w.dcValue(d), w.currencyOf(d.so_id)]))} href="/dc?status=dispatched" />}
        {books && <Tile tone="blue" label="Cheques to deposit" value={books.toDeposit.length} note={money(books.toDeposit.reduce((a, c) => a + c.amount, 0))} href="/payments?tab=cheques&status=deposit" />}
        {lead && <Tile tone="blue" money label="Running order book" value={sumByCur(running.map((o) => [orderValue(o), o.currency]))} note={`${running.length} running orders`} href="/orders?status=locked" />}
      </div>
      <div className="two">
        <section className="panel">
          <div className="row mb-3">
            <h2 className="flex-1 text-[19px] font-bold">Needs attention</h2>
            <Pills current={scope} items={[
              { key: "mine", label: `Mine (${mine.length})`, href: "/?who=mine" },
              { key: "all", label: `Everyone (${roleAlerts.length})`, href: "/?who=all" },
            ]} />
          </div>
          <AlertList alerts={shown} limit={40} more={isLive("/tna") ? "below the fold. Filter by order on TNA." : "below the fold."} />
        </section>
        <div className="stack">
          {actions.length > 0 && (
            <section className="panel">
              <h3>Quick actions</h3>
              <div className="actions" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {actions.map((a) => (
                  <Link key={a.href} href={a.href} className="action">
                    <i className={a.tone}>{a.icon}</i>
                    <span><b>{a.label}</b><small>{a.sub}</small></span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {lead && <Pulse w={w} />}
        </div>
      </div>
    </>
  );
}

// Inquiry funnel, sample flow and TNA health: for the owner and managers.
function Pulse({ w }: { w: Awaited<ReturnType<typeof loadWorld>>["world"] }) {
  const counts = INQ.map(([k, l]) => [l, w.inquiries.filter((i) => i.status === k).length] as const);
  const maxc = Math.max(1, ...counts.map((c) => c[1]));
  const stageCounts = ([["At Sourcingo", "received"], ["With vendor", "with_vendor"], ["Ready to send", "ready"], ["With buyer", "dispatched"]] as const)
    .map(([l, k]) => [l, w.samples.filter((s) => s.status === k).length] as const);
  const maxStage = Math.max(1, ...stageCounts.map((c) => c[1]));
  const sent = w.samples.filter((s) => s.dispatched_on && s.dispatched_on >= addDays(w.today, -60) && sampleOnTime(s) !== null);
  const sentOnTime = sent.filter((s) => sampleOnTime(s)).length;
  let onTrack = 0, late = 0, delayed = 0, done = 0;
  for (const o of w.orders.filter((x) => x.status === "locked")) {
    for (const { cp } of allCheckpoints(o)) {
      if (cp.status === "completed") done++;
      else if (overdue(cp, w.today)) late++;
      else if (cp.status === "delayed") delayed++;
      else onTrack++;
    }
  }
  const tot = onTrack + late + delayed + done;
  const bar = (label: string, n: number, of: number, color?: string) => (
    <div key={label} className="bar-row">
      <span>{label}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / of) * 100}%`, ...(color ? { background: color } : {}) }} /></div>
      <span className="num code">{nf(n)}</span>
    </div>
  );
  return (
    <section className="panel">
      <h3>Business pulse</h3>
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="sub mb-2">TNA health (running orders)</div>
          {tot ? (
            <div className="bars">
              {bar("Done", done, tot, "var(--ok)")}
              {bar("On track", onTrack, tot, "var(--accent)")}
              {bar("Delayed", delayed, tot, "var(--warn)")}
              {bar("Overdue", late, tot, "var(--bad)")}
            </div>
          ) : <p className="text-sm text-muted">Shows once running orders have a TNA.{isLive("/cleanup") && <> <Link className="link" href="/cleanup#tna">Add TNAs</Link></>}</p>}
        </div>
        {isLive("/inquiries") && (
          <div>
            <div className="sub mb-2">Inquiries</div>
            <div className="bars">{counts.map(([l, n]) => bar(l, n, maxc, l === "Lost" ? "var(--muted)" : l === "Converted" ? "var(--ok)" : undefined))}</div>
          </div>
        )}
        <div>
          <div className="sub mb-2">Samples</div>
          <div className="bars">{stageCounts.map(([l, n]) => bar(l, n, maxStage, l === "Ready to send" ? "var(--ok)" : undefined))}</div>
          <p className="mt-2 text-xs text-muted">
            {sent.length ? `${Math.round((sentOnTime / sent.length) * 100)}% sent on time in the last 60 days (${sentOnTime} of ${sent.length}).` : "On-time rate shows once samples with due dates are sent."}
          </p>
        </div>
      </div>
    </section>
  );
}
