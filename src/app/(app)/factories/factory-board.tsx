import { NO_COMPANY } from "@/lib/names";
import Link from "next/link";
import { getMe } from "@/lib/auth";
import { buyerName, loadBuyers, type Factory } from "@/lib/data";
import { day, dayAt, daysBetween, dueDate, nowMs, planDueAt, qty, qtyTotal, stageReached, todayIST } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { type StepRow, styleProgress } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";
import { ProgressCell } from "@/components/progress";

type Qty = { qty: number; product: string };

type Po = { order_id: string; factory_id: string; released_at: string | null; plan_requested_at: string | null; plan_requested_on: string | null; factory_sent_at: string | null };

const plural = (n: number, w: string) => `${qty(n)} ${n === 1 ? w : `${w}s`}`;

// Every open order split by factory: which POs each factory has (released or not yet), for which buyers,
// with styles, pieces and progress. No prices, so it reads the same for everyone on the orders team.
export async function FactoryBoard({ factories }: { factories: Factory[] }) {
  const [me, supabase] = await Promise.all([getMe(), createClient()]);
  const companyId = me?.companyId ?? NO_COMPANY;
  const [{ data: orders, error }, buyers] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, stage, order_lines(id, style, qty, factory_id, product)")
      .eq("company_id", companyId).eq("status", "open").is("order_lines.removed_at", null).order("id").range(a, z)),
    loadBuyers(),
  ]);
  const ids = orders.map((o) => o.id);
  const [{ data: pos, error: posError }, { data: steps, error: stepsError }] = ids.length
    ? await Promise.all([
      fetchAll<Po>((a, z) => supabase.from("factory_pos").select("order_id, factory_id, released_at, plan_requested_at, plan_requested_on, factory_sent_at").in("order_id", ids).order("id").range(a, z)),
      fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, planned_on, done_on").in("order_id", ids).eq("not_needed", false).order("id").range(a, z)),
    ])
    : [{ data: [] as Po[], error: null }, { data: [], error: null }];

  const today = todayIST();
  const board = buildBoard({ factories, orders, pos, steps, buyers: new Map(buyers.map((b) => [b.id, buyerName(b)])), today, now: nowMs() });
  return <BoardView board={board} today={today} loadError={[error, posError, stepsError].find(Boolean)?.message} />;
}

type BoardInput = {
  factories: Factory[];
  orders: { id: string; order_no: string; buyer_id: string; buyer_po: string; ship_date: string | null; revised_ship_date: string | null; stage: string | null;
    order_lines: { id: string; style: string; qty: number; factory_id: string | null; product: string }[] | null }[];
  pos: Po[];
  steps: StepRow[];
  buyers: Map<string, string>;
  today: string;
  now: number;
};
type Board = ReturnType<typeof buildBoard>;

// Splits the open orders by factory, busiest factory first.
export function buildBoard({ factories, orders, pos, steps, buyers: buyerById, today, now }: BoardInput) {
  const poOf = new Map(pos.map((p) => [`${p.order_id}:${p.factory_id}`, p]));

  // One row per order and factory: that factory's styles on the order.
  type Row = {
    key: string; orderId: string; orderNo: string; buyerId: string; buyer: string; buyerPo: string; due: string | null;
    // items: qty and product of each style, so fabric metres are never added to garment pieces.
    styles: string[]; pieces: number; items: Qty[]; released: string | null; state: { text: string; cls: string } | null;
    progress: ReturnType<typeof styleProgress>; looksShipped: boolean;
  };
  const byFactory = new Map<string, Row[]>();
  let noFactory = 0;
  for (const o of orders) {
    const lines = o.order_lines ?? [];
    noFactory += lines.filter((l) => !l.factory_id).length;
    const due = dueDate(o);
    for (const f of new Set(lines.map((l) => l.factory_id).filter((x): x is string => !!x))) {
      const mine = lines.filter((l) => l.factory_id === f);
      const po = poOf.get(`${o.id}:${f}`);
      const released = po?.released_at ?? null;
      // Where an unreleased PO stands, in the words the order page uses.
      const dueAt = po?.plan_requested_at ? planDueAt(po.plan_requested_at) : null;
      const sent = !!po?.factory_sent_at && (!po.plan_requested_at || po.factory_sent_at >= po.plan_requested_at);
      const state = released ? null
        : sent ? { text: "TNA in, ready to check and release", cls: "info" }
        : dueAt && dueAt.getTime() < now ? { text: "No TNA from the factory in 24 hours", cls: "bad" }
        : dueAt || po?.plan_requested_on ? { text: "Waiting for the factory's TNA", cls: "warn" }
        : { text: "Factory not asked for its TNA yet", cls: "warn" };
      const row: Row = {
        key: `${o.id}:${f}`, orderId: o.id, orderNo: o.order_no, buyerId: o.buyer_id, buyer: buyerById.get(o.buyer_id) ?? "", buyerPo: o.buyer_po, due,
        styles: mine.map((l) => l.style), pieces: mine.reduce((s, l) => s + l.qty, 0), items: mine, released, state,
        progress: styleProgress(mine.map((l) => l.id), steps, due, today),
        looksShipped: !!due && daysBetween(due, today) > 30 && stageReached(o.stage, "packed"),
      };
      byFactory.set(f, [...(byFactory.get(f) ?? []), row]);
    }
  }

  const cards = factories.filter((f) => byFactory.has(f.id)).map((f) => {
    const rows = byFactory.get(f.id)!
      // Not released first (they need the team), then earliest ship date.
      .sort((a, b) => Number(!!a.released) - Number(!!b.released) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.orderNo.localeCompare(b.orderNo));
    const released = rows.filter((r) => r.released);
    const buyerList = [...new Set(rows.map((r) => r.buyerId))].map((id) => {
      const mine = rows.filter((r) => r.buyerId === id);
      return { id, name: buyerById.get(id) ?? "", pos: mine.length, pieces: mine.reduce((s, r) => s + r.pieces, 0), items: mine.flatMap((r) => r.items) };
    }).sort((a, b) => b.pieces - a.pieces);
    return {
      f, rows, buyerList,
      released: released.length, waiting: rows.length - released.length,
      pieces: released.reduce((s, r) => s + r.pieces, 0),
      items: released.flatMap((r) => r.items),
      styles: released.reduce((s, r) => s + r.styles.length, 0),
      atRisk: released.filter((r) => r.progress.riskDays > 0 || r.progress.behind).length,
    };
  }).sort((a, b) => b.pieces - a.pieces || a.f.name.localeCompare(b.f.name));

  const total = {
    released: cards.reduce((s, c) => s + c.released, 0),
    waiting: cards.reduce((s, c) => s + c.waiting, 0),
    pieces: cards.reduce((s, c) => s + c.pieces, 0),
    items: cards.flatMap((c) => c.items),
  };
  return { cards, total, noFactory };
}

// The board itself: totals, a jump bar, then one card per factory.
export function BoardView({ board: { cards, total, noFactory }, today, loadError }: { board: Board; today: string; loadError?: string }) {

  return (
    <div className="stack">
      {loadError && <div className="errbox">Couldn&apos;t load everything, so this board may be incomplete. Reload to try again. ({loadError})</div>}

      {cards.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Factories working</span><b>{cards.length}</b><small>On open orders</small></div>
          <div className="kpi ok"><span className="kpi-label"><i aria-hidden />POs released</span><b>{total.released}</b><small>{qtyTotal(total.items)} in work</small></div>
          <div className={`kpi ${total.waiting ? "warn" : "ok"}`}><span className="kpi-label"><i aria-hidden />Not released</span><b>{total.waiting}</b><small>{total.waiting ? "Waiting on the TNA" : "Every PO is out"}</small></div>
          <div className={`kpi ${noFactory ? "warn" : "ok"}`}><span className="kpi-label"><i aria-hidden />Styles without a factory</span><b>{noFactory}</b><small>{noFactory ? "Choose one on the order" : "Every style has one"}</small></div>
        </div>
      )}

      {cards.length > 1 && (
        <nav className="jump" aria-label="Factories">
          {cards.map((c) => <a key={c.f.id} href={`#f-${c.f.id}`}>{c.f.name}<span className="jump-n">{c.released + c.waiting}</span></a>)}
        </nav>
      )}

      {cards.length === 0 && !loadError ? (
        <div className="empty"><b>No factory has open work</b>Choose a factory for each style on an order and it shows up here.</div>
      ) : cards.map((c) => (
        <section key={c.f.id} id={`f-${c.f.id}`} className="card fac-card">
          <div className="card-h">
            <div>
              <h2>{c.f.name}</h2>
              <p>
                {[c.f.city, `${plural(c.released, "PO")} released`, `${plural(c.styles, "style")}`, qtyTotal(c.items)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="row">
              {c.waiting > 0 && <span className="chip warn">{c.waiting} not released</span>}
              {c.atRisk > 0 && <span className="chip bad">{c.atRisk} behind</span>}
              {c.f.phone && <a className="btn sm" href={`tel:${c.f.phone}`}>Call</a>}
            </div>
          </div>
          <div className="fac-buyers" aria-label="Buyers">
            {c.buyerList.map((b) => (
              <span key={b.id} className="fac-buyer"><b>{b.name}</b>{plural(b.pos, "PO")} · {qtyTotal(b.items)}</span>
            ))}
          </div>
          {[{ label: "Not released", rows: c.rows.filter((r) => !r.released) }, { label: "Released", rows: c.rows.filter((r) => r.released) }]
            .filter((g) => g.rows.length).map((g) => (
              <div key={g.label} className="fac-group-rows">
                <h3 className="fac-sub">{g.label}<span>{g.rows.length}</span></h3>
                {g.rows.map((r) => (
                  <Link key={r.key} href={`/orders/${r.orderId}`} className="frow">
                    <span className="frow-t"><span className="code">{r.orderNo}</span>{r.buyer}</span>
                    <span className="frow-d">
                      {r.due ? day(r.due) : <span className="muted">No ship date</span>}
                      {r.due && r.due < today && <small className="text-bad">{plural(daysBetween(r.due, today), "day")} late</small>}
                    </span>
                    <span className="frow-s">
                      PO {r.buyerPo} · {r.styles.length <= 2 ? r.styles.join(", ") : `${r.styles.slice(0, 2).join(", ")} +${r.styles.length - 2}`} · <b>{qtyTotal(r.items)}</b>
                      {r.released && <> · released {dayAt(r.released).slice(0, -5)}</>}
                    </span>
                    <span className="frow-g o-prog">
                      {r.state ? <span className={`chip ${r.state.cls}`}>{r.state.text}</span> : <ProgressCell p={r.progress} looksShipped={r.looksShipped} />}
                    </span>
                  </Link>
                ))}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
