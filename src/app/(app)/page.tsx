import { NO_COMPANY } from "@/lib/names";
import Link from "next/link";
import { getMe } from "@/lib/auth";
import { loadBuyers, loadFactories } from "@/lib/data";
import { day, daysBetween, dueDate, money, qty, stageLabel, STATUS, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { key: "open", label: "Open" },
  { key: "late", label: "Late" },
  { key: "shipped", label: "Shipped" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

type Line = { style: string; qty: number; buyer_rate: number | null; factory_id: string | null };

export default async function OrdersPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? String(sp.status) : "open";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, delay_reason, stage, status, order_lines(style, qty, buyer_rate, factory_id)")
    .eq("company_id", companyId)
    .is("order_lines.removed_at", null)
    .order("ship_date", { ascending: true, nullsFirst: false })
    .order("order_no");
  if (status !== "all") query = query.eq("status", status === "late" ? "open" : status);
  const [{ data, error }, buyers, factories, counts, { data: qc }] = await Promise.all([
    query,
    loadBuyers(),
    loadFactories(),
    supabase.from("orders").select("status, ship_date, revised_ship_date").eq("company_id", companyId),
    supabase.from("qc_checks").select("order_id, result").eq("company_id", companyId).eq("kind", "final").is("cancelled_at", null)
      .order("checked_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  // Each order's latest final QC result (rows come newest first).
  const finalQc = new Map<string, string>();
  for (const c of qc ?? []) if (!finalQc.has(c.order_id)) finalQc.set(c.order_id, c.result);

  const buyerById = new Map(buyers.map((b) => [b.id, b]));
  const factoryById = new Map(factories.map((f) => [f.id, f]));
  const today = todayIST();
  const isLate = (o: { status: string; ship_date: string | null; revised_ship_date: string | null }) => {
    const due = dueDate(o);
    return o.status === "open" && !!due && due < today;
  };
  const owner = me?.role === "owner";

  const rows = (data ?? []).map((o) => {
    const lines = (o.order_lines ?? []) as Line[];
    const b = buyerById.get(o.buyer_id);
    const factoryNames = [...new Set(lines.map((l) => (l.factory_id ? factoryById.get(l.factory_id)?.name : null)).filter(Boolean))] as string[];
    const missingFactory = lines.some((l) => !l.factory_id);
    return {
      ...o,
      buyer: b ? (owner && b.realName ? `${b.code} · ${b.realName}` : b.code) : "",
      styles: lines.map((l) => l.style),
      pieces: lines.reduce((s, l) => s + l.qty, 0),
      value: lines.every((l) => l.buyer_rate != null) ? lines.reduce((s, l) => s + l.qty * (l.buyer_rate ?? 0), 0) : null,
      factoryNames,
      missingFactory,
      due: dueDate(o),
      needsQc: o.status === "open" && o.stage === "packed" && finalQc.get(o.id) !== "pass",
      late: isLate(o),
      lateBy: isLate(o) ? daysBetween(dueDate(o)!, today) : 0,
    };
  })
    .filter((r) => status !== "late" || r.late)
    .filter((r) => !q || [r.order_no, r.buyer, r.buyer_po, ...r.styles, ...r.factoryNames].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.order_no.localeCompare(b.order_no));

  const all = counts.data ?? [];
  const openCount = all.filter((o) => o.status === "open").length;
  const open = rows.filter((r) => r.status === "open");
  const late = all.filter(isLate).length;
  const noFactory = open.filter((r) => r.missingFactory).length;

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Orders</h1>
          <p>One line per buyer PO. Sorted by ship date, earliest first. A new ship date replaces the buyer&apos;s date when an order slips.</p>
        </div>
        <Link href="/orders/new" className="btn primary">New order</Link>
      </div>

      {status === "open" && openCount > 0 && (
        <div className="tiles">
          <div className="tile"><span>Open orders</span><b>{openCount}</b></div>
          <div className="tile"><span>Pieces on open orders</span><b>{qty(open.reduce((s, r) => s + r.pieces, 0))}</b></div>
          <Link href="/?status=late" className={`tile ${late ? "alarm" : ""}`}><span>Late, past ship date</span><b>{late}</b></Link>
          <div className={`tile ${noFactory ? "alarm" : ""}`}><span>Styles without a factory</span><b>{noFactory}</b></div>
        </div>
      )}

      <div className="row">
        <div className="filters">
          {TABS.map((t) => (
            <Link key={t.key} className="pill" href={t.key === "open" ? "/" : `/?status=${t.key}`} aria-current={status === t.key ? "page" : undefined}>
              {t.label} {t.key === "all" ? all.length : t.key === "late" ? late : all.filter((o) => o.status === t.key).length}
            </Link>
          ))}
        </div>
        <form className="ml-auto w-full sm:w-64">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          <input className="inp" name="q" defaultValue={q} placeholder="Search PO, style, buyer, factory" aria-label="Search orders" />
        </form>
      </div>

      {error && <div className="errbox">{error.message}</div>}

      {rows.length === 0 ? (
        <div className="empty">
          <b>{q ? "Nothing matches that search" : all.length === 0 ? "No orders yet" : status === "late" ? "Nothing is late" : "No orders here"}</b>
          {all.length === 0 && "Add the first one with New order, or send the confirmed sheet and Claude will load it."}
        </div>
      ) : (
        <>
        <ul className="flex flex-col gap-2 sm:hidden">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/orders/${r.id}`} className="panel flex flex-col gap-1 !p-3.5">
                <div className="row justify-between">
                  <b className="code text-accent">{r.order_no}</b>
                  <span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</span>
                </div>
                <div className="font-semibold">{r.buyer_po} <span className="code muted font-normal">{r.buyer}</span></div>
                <div className="muted text-[13px]">{r.styles.length} {r.styles.length === 1 ? "style" : "styles"} · {qty(r.pieces)} pcs{r.value != null && ` · ${money(r.value)}`}</div>
                <div className="row text-[13px]">
                  {r.due ? <span>Ships {day(r.due)}</span> : <span className="muted">No ship date</span>}
                  {r.status === "open" && <span className="chip">{stageLabel(r.stage)}</span>}
                  {r.late && <span className="chip bad">Late {r.lateBy}d</span>}
                  {r.needsQc && <span className="chip warn">Needs final QC</span>}
                  {r.missingFactory && <span className="chip warn">Needs factory</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="table-wrap hidden sm:block">
          <table className="tbl">
            <thead>
              <tr>
                <th>Order</th><th>Buyer</th><th>Buyer PO</th><th>Styles</th><th className="r">Pieces</th>
                <th className="r">Value</th><th>Factory</th><th>Ship date</th><th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click">
                  <td><Link href={`/orders/${r.id}`} className="link code">{r.order_no}</Link></td>
                  <td className="code whitespace-nowrap">{r.buyer}</td>
                  <td className="whitespace-nowrap">{r.buyer_po}</td>
                  <td>{r.styles.length <= 2 ? r.styles.join(", ") : `${r.styles.slice(0, 2).join(", ")} +${r.styles.length - 2}`}</td>
                  <td className="r num">{qty(r.pieces)}</td>
                  <td className="r num">{money(r.value)}</td>
                  <td>
                    {r.factoryNames.join(", ")}
                    {r.missingFactory && <span className="chip warn ml-1">Needs factory</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {day(r.due)}
                    {r.late && <span className="chip bad ml-1">Late {r.lateBy}d</span>}
                    {r.revised_ship_date && r.ship_date && r.revised_ship_date !== r.ship_date && (
                      <div className="muted text-xs" title={r.delay_reason ?? undefined}>Buyer date {day(r.ship_date)}</div>
                    )}
                  </td>
                  <td>
                    {r.status === "open"
                      ? <>
                          <span className={r.stage === "packed" ? "chip ok" : r.stage ? "chip info" : "chip"}>{stageLabel(r.stage)}</span>
                          {r.needsQc && <span className="chip warn ml-1">Needs final QC</span>}
                        </>
                      : <span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}
