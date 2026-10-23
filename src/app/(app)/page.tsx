import { NO_COMPANY } from "@/lib/names";
import Link from "next/link";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { day, daysBetween, dueDate, money, qty, SHIP_QC, stageReached, STATUS, todayIST } from "@/lib/format";
import { type LinePrice, marginCls, pct, planMargin } from "@/lib/margin";
import { fetchAll } from "@/lib/fetch-all";
import { styleProgress } from "@/lib/progress";
import { loadShipProgress, orderShip } from "@/lib/shipments";
import { ProgressCell } from "@/components/progress";
import { createClient } from "@/lib/supabase/server";
import { journey, STAGES, type StageKey } from "@/lib/journey";

const TABS = [
  { key: "open", label: "Open" },
  { key: "late", label: "Late" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type Line = { id: string; style: string; qty: number; buyer_rate: number | null; factory_id: string | null; factory_rate: number | null };

export default async function OrdersPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? String(sp.status) : "open";
  const stage = STAGES.some((x) => x.key === sp.stage) ? (String(sp.stage) as StageKey) : null;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  // Orders are read page by page, so a long list is never cut short at the 1,000 rows one read returns.
  const page = (a: number, z: number) => {
    let query = supabase
      .from("orders")
      .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, delay_reason, stage, status, closed_short_at, order_lines(id, style, qty, factory_id)")
      .eq("company_id", companyId)
      .is("order_lines.removed_at", null)
      .order("ship_date", { ascending: true, nullsFirst: false })
      .order("order_no")
      .order("id");
    if (status !== "all") query = query.eq("status", status === "late" ? "open" : status);
    return query.range(a, z);
  };
  const [{ data, error }, buyers, factories, counts, { data: qc, error: qcError }] = await Promise.all([
    fetchAll(page),
    loadBuyers(),
    loadFactories(),
    fetchAll((a, z) => supabase.from("orders").select("status, ship_date, revised_ship_date").eq("company_id", companyId).order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("qc_checks").select("line_id, result").eq("company_id", companyId).in("kind", SHIP_QC).is("cancelled_at", null)
      .order("checked_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(a, z)),
  ]);
  // TNA steps of the open orders listed, for each style's progress and whether the order is on plan.
  const openIds = (data ?? []).filter((o) => o.status === "open").map((o) => o.id);
  const none = { data: [], error: null };
  const [{ data: steps, error: stepsError }, { data: shipRows, error: shipError }, { data: fpos }, { data: disp }, { data: smp }, { data: ups }] = await Promise.all([
    openIds.length
      ? fetchAll((a, z) => supabase.from("line_stages").select("order_id, line_id, stage, planned_on, done_on, not_needed").in("order_id", openIds).eq("not_needed", false).order("id").range(a, z))
      : none,
    // Pieces shipped so far, for orders sent in parts.
    loadShipProgress(supabase, openIds),
    // What each order's next step is: its factory POs, dispatches, samples and factory updates waiting.
    openIds.length ? fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id, released_at, lock_requested_at").in("order_id", openIds).order("id").range(a, z)) : none,
    openIds.length && canEditOrders(me?.role)
      ? fetchAll((a, z) => supabase.from("dispatches").select("order_id, invoiced_at, shipped_at").in("order_id", openIds).is("cancelled_at", null).order("id").range(a, z)) : none,
    openIds.length ? fetchAll((a, z) => supabase.from("sample_rounds").select("order_id").in("order_id", openIds).eq("status", "with_team").order("id").range(a, z)) : none,
    openIds.length ? fetchAll((a, z) => supabase.from("step_updates").select("order_id").in("order_id", openIds).eq("status", "pending").order("id").range(a, z)) : none,
  ]);
  // Each style's latest final QC result (rows come newest first).
  const finalQc = new Map<string, string>();
  for (const c of qc ?? []) if (!finalQc.has(c.line_id)) finalQc.set(c.line_id, c.result);

  const buyerById = new Map(buyers.map((b) => [b.id, b]));
  const factoryById = new Map(factories.map((f) => [f.id, f]));
  const today = todayIST();
  const isLate = (o: { status: string; ship_date: string | null; revised_ship_date: string | null }) => {
    const due = dueDate(o);
    return o.status === "open" && !!due && due < today;
  };
  const prices = canEditOrders(me?.role);
  // Rates come separately: the database gives them only to the orders team and Accounts.
  const { data: rates, error: ratesError } = prices && data.length
    ? await fetchAll<LinePrice>((a, z) => supabase.rpc("line_prices", { p_orders: data.map((o) => o.id) }).order("id").range(a, z))
    : { data: [], error: null };
  const rateOf = new Map(rates.map((r) => [r.id, r]));
  // Open orders whose buyer PO is on file, to point out the ones still missing it.
  const { data: withPo } = prices && openIds.length ? await supabase.rpc("orders_with_po_file", { p_orders: openIds }) : { data: null };
  const hasPo = new Set((withPo ?? []) as string[]);
  const withRates = (o: { order_lines: { id: string; style: string; qty: number; factory_id: string | null }[] | null }): Line[] =>
    (o.order_lines ?? []).map((l) => ({ ...l, buyer_rate: rateOf.get(l.id)?.buyer_rate ?? null, factory_rate: rateOf.get(l.id)?.factory_rate ?? null }));

  // Progress of an open order: where its slowest styles are, and whether any step is past its target.
  const progressOf = (o: { order_lines: { id: string }[] | null; ship_date: string | null; revised_ship_date: string | null }) =>
    styleProgress((o.order_lines ?? []).map((l) => l.id), steps ?? [], dueDate(o), today);
  const journeyOf = (o: { id: string; status: string; stage: string | null; closed_short_at: string | null }, lines: Line[]) => {
    const ids = new Set(lines.map((l) => l.id));
    const fs = [...new Set(lines.map((l) => l.factory_id))];
    const ds = (disp as { order_id: string; invoiced_at: string | null; shipped_at: string | null }[]).filter((d) => d.order_id === o.id);
    const st = (steps ?? []).filter((r) => r.order_id === o.id && ids.has(r.line_id));
    return journey({
      status: o.status, role: me?.role,
      lines: lines.map((l) => ({ factoryId: l.factory_id, hasRate: l.factory_rate != null })),
      groups: fs.map((f) => {
        const po = (fpos as { order_id: string; factory_id: string; released_at: string | null; lock_requested_at: string | null }[]).find((p) => p.order_id === o.id && p.factory_id === f);
        return { factoryId: f, released: !!po?.released_at, lockRequested: !!po?.lock_requested_at };
      }),
      hasBuyerPo: prices && withPo != null ? hasPo.has(o.id) : null,
      steps: st.map((r) => ({ stage: r.stage, planned: r.planned_on, done: r.done_on })),
      packedAll: stageReached(o.stage, "packed") || (lines.length > 0 && lines.every((l) => st.some((r) => r.line_id === l.id && r.stage === "packed" && r.done_on))),
      finalPassed: lines.length > 0 && lines.every((l) => finalQc.get(l.id) === "pass"),
      samplesToAct: (smp as { order_id: string }[]).filter((x) => x.order_id === o.id).length,
      pendingUpdates: (ups as { order_id: string }[]).filter((x) => x.order_id === o.id).length,
      dispatch: prices ? {
        count: ds.length, uninvoiced: ds.filter((d) => !d.invoiced_at).length, unshipped: ds.filter((d) => !d.shipped_at).length,
        billedAll: !!o.closed_short_at || lines.every((l) => (shipRows.find((r) => r.line_id === l.id)?.billed ?? 0) >= l.qty),
      } : null,
      today,
    });
  };
  const built = (data ?? []).map((o) => {
    const lines = withRates(o);
    const b = buyerById.get(o.buyer_id);
    const factoryNames = [...new Set(lines.map((l) => (l.factory_id ? factoryById.get(l.factory_id)?.name : null)).filter(Boolean))] as string[];
    const missingFactory = lines.some((l) => !l.factory_id);
    return {
      noPo: prices && o.status === "open" && withPo != null && !hasPo.has(o.id),
      ...o,
      lines,
      buyer: b ? buyerName(b) : "",
      styles: lines.map((l) => l.style),
      pieces: lines.reduce((s, l) => s + l.qty, 0),
      value: prices && lines.every((l) => l.buyer_rate != null) ? lines.reduce((s, l) => s + l.qty * (l.buyer_rate ?? 0), 0) : null,
      margin: prices ? planMargin(lines) : null,
      factoryNames,
      missingFactory,
      due: dueDate(o),
      needsQc: o.status === "open" && stageReached(o.stage, "packed") && lines.some((l) => finalQc.get(l.id) !== "pass"),
      late: isLate(o),
      lateBy: isLate(o) ? daysBetween(dueDate(o)!, today) : 0,
      progress: o.status === "open" ? progressOf(o) : null,
      ship: o.status === "open" ? orderShip(shipRows, o.id) : null,
      journey: o.status === "open" ? journeyOf(o, lines) : null,
      // Shipped long ago but never closed: 30+ days past the ship date and packed or further.
      looksShipped: o.status === "open" && !!dueDate(o) && daysBetween(dueDate(o)!, today) > 30 && stageReached(o.stage, "packed"),
    };
  });
  const rows = built
    .filter((r) => status !== "late" || r.late)
    .filter((r) => !stage || r.journey?.stage === stage)
    .filter((r) => !q || [r.order_no, r.buyer, r.buyer_po, ...r.styles, ...r.factoryNames].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.order_no.localeCompare(b.order_no));

  const all = counts.data ?? [];
  // A list that failed to load must not look like "no orders" or "on plan".
  const loadError = [error, counts.error, qcError, stepsError, ratesError, shipError].find(Boolean);
  const openCount = all.filter((o) => o.status === "open").length;
  // Tiles count every open order, whatever is typed in the search box.
  const open = built.filter((r) => r.status === "open");
  const late = all.filter(isLate).length;
  const noFactory = open.filter((r) => r.missingFactory).length;
  const openMargin = prices ? planMargin(open.flatMap((r) => r.lines)) : null;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Orders</h1>
          <p className="hide-phone">Every buyer PO, earliest ship date first. A new ship date replaces the buyer&apos;s when an order slips.</p>
        </div>
        {prices && <Link href="/orders/new" className="btn primary hide-phone">New order</Link>}
      </div>

      {status === "open" && openCount > 0 && (
        <div className="kpis hide-phone" style={{ gridTemplateColumns: `repeat(${openMargin && openMargin.sale > 0 ? 5 : 4}, minmax(0, 1fr))` }}>
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Open orders</span><b>{openCount}</b><small>{qty(open.reduce((s, r) => s + r.styles.length, 0))} styles</small></div>
          <div className="kpi"><span className="kpi-label"><i aria-hidden />Pieces</span><b>{qty(open.reduce((s, r) => s + r.pieces, 0))}</b><small>On open orders</small></div>
          <Link href="/?status=late" className={`kpi ${late ? "bad" : "ok"}`}><span className="kpi-label"><i aria-hidden />Late</span><b>{late}</b><small>Past their ship date</small></Link>
          <div className={`kpi ${noFactory ? "warn" : "ok"}`}><span className="kpi-label"><i aria-hidden />Need a factory</span><b>{noFactory}</b><small>{noFactory ? "Choose one on the order" : "Every style has one"}</small></div>
          {openMargin && openMargin.sale > 0 && (
            <div className="kpi"><span className="kpi-label"><i aria-hidden />Margin</span><b className={marginCls(openMargin.pct)}>{money(openMargin.margin)}</b><small>{pct(openMargin.pct)} of {money(openMargin.sale)}</small></div>
          )}
        </div>
      )}

      {status === "open" && open.length > 0 && (
        <nav className="opipe" aria-label="Orders by stage">
          <Link href="/" aria-current={!stage ? "page" : undefined} className="pipe-all"><b>{open.length}</b><span>All open</span></Link>
          {STAGES.map((x) => {
            const n = open.filter((r) => r.journey?.stage === x.key).length;
            return (
              <Link key={x.key} href={`/?stage=${x.key}`} aria-current={stage === x.key ? "page" : undefined} title={x.hint} data-empty={!n || undefined}>
                <b>{n}</b><span>{x.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <nav className="seg" aria-label="Show">
          {TABS.map((t) => (
            <Link key={t.key} href={t.key === "open" ? "/" : `/?status=${t.key}`} aria-current={status === t.key ? "page" : undefined}>
              {t.label} <span>{t.key === "all" ? all.length : t.key === "late" ? late : all.filter((o) => o.status === t.key).length}</span>
            </Link>
          ))}
        </nav>
        <form className="ml-auto w-full sm:w-72">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          {stage && <input type="hidden" name="stage" value={stage} />}
          <input className="inp" type="search" name="q" defaultValue={q} placeholder="Search PO, style, buyer, factory" aria-label="Search orders"
            autoFocus={sp.find === "1"} enterKeyHint="search" />
        </form>
      </div>

      {loadError && <div className="errbox">Couldn&apos;t load everything, so this list may be incomplete. Reload to try again. ({loadError.message})</div>}

      {rows.length === 0 ? (
        <div className="empty">
          <b>{loadError ? "Couldn't load the orders" : q ? "Nothing matches that search" : all.length === 0 ? "No orders yet" : status === "late" ? "Nothing is late" : "No orders here"}</b>
          {all.length === 0 && !loadError && "Add the first one with New order, or send the confirmed sheet and Claude will load it."}
        </div>
      ) : (
        <div className={`olist ${prices ? "" : "noprice"}`} role="table" aria-label="Orders">
          <div className="olist-h" role="row">
            <span role="columnheader">Order</span><span role="columnheader">Ship date</span><span role="columnheader" className="r">Pieces</span>
            {prices && <><span role="columnheader" className="r">Value</span><span role="columnheader" className="r">Margin</span></>}
            <span role="columnheader">Progress</span>
          </div>
          {rows.map((r) => (
            <Link key={r.id} href={`/orders/${r.id}`} className="olist-r" role="row">
              <span className="o-main" role="cell">
                <span className="o-title"><span className="code">{r.order_no}</span>{r.buyer}</span>
                <span className="o-sub">
                  PO {r.buyer_po} · {r.styles.length <= 2 ? r.styles.join(", ") : `${r.styles.slice(0, 2).join(", ")} +${r.styles.length - 2}`}
                  {r.factoryNames.length > 0 && ` · ${r.factoryNames.join(", ")}`}
                </span>
                {r.journey && r.journey.stage !== "done" && (
                  <span className={`o-next tone-${r.journey.next.tone}`}>
                    <b>{STAGES.find((x) => x.key === r.journey!.stage)?.label}</b>
                    <span>{r.journey.next.action.kind === "none" ? `Waiting: ${r.journey.next.title.replace(/^Waiting (for|on) /, "")}` : r.journey.next.title}</span>
                  </span>
                )}
              </span>
              <span className="o-date" role="cell">
                {r.due ? day(r.due) : <span className="muted">No ship date</span>}
                {r.late ? <small className="text-bad">{r.lateBy} {r.lateBy === 1 ? "day" : "days"} late</small>
                  : r.revised_ship_date && r.ship_date && r.revised_ship_date !== r.ship_date ? <small title={r.delay_reason ?? undefined}>Buyer date {day(r.ship_date)}</small> : null}
              </span>
              <span className="r num" role="cell"><span className="o-k">Pieces </span>{qty(r.pieces)}</span>
              {prices && <span className="r num" role="cell"><span className="o-k">Value </span>{money(r.value)}</span>}
              {prices && (
                <span className="r num" role="cell">
                  {r.margin && r.margin.sale > 0 ? <><span className="o-k">Margin </span>{money(r.margin.margin)}<small className={marginCls(r.margin.pct)}>{pct(r.margin.pct)}{r.margin.missing > 0 && " · rate missing"}</small></> : <span className="muted">–</span>}
                </span>
              )}
              <span className="o-prog" role="cell">
                {r.progress ? (
                  <ProgressCell p={r.progress} looksShipped={r.looksShipped} ship={r.ship} />
                ) : <span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
